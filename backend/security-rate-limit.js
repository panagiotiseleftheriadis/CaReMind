const crypto = require('node:crypto');
const { isIP } = require('node:net');
const ipaddr = require('ipaddr.js');
const express = require('express');
const { createUpstashStore, createMemoryStore } = require('./rate-limit-store');

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
// A shared group has the same limit/window at every entry point.
const POLICIES = {
  '/login': { group: 'login', ip: 60, windowMs: 15 * MINUTE, field: 'username', identity: 10 },
  '/register': { group: 'register', ip: 20, windowMs: HOUR, field: 'email', identity: 5, identityGroup: 'mail' },
  '/resend-verification': { group: 'resend', ip: 30, windowMs: HOUR, field: 'email', identity: 5, identityGroup: 'mail' },
  '/forgot-password': { group: 'forgot', ip: 30, windowMs: HOUR, field: 'email', identity: 5, identityGroup: 'mail' },
  '/verify-email': { group: 'code', ip: 120, windowMs: 15 * MINUTE, field: 'email', identity: 10 },
  '/verify-reset-code': { group: 'code', ip: 120, windowMs: 15 * MINUTE, field: 'email', identity: 10 },
  // Redemption requires a signed purpose-specific token; never key on its raw value or unverified claims.
  '/reset-password': { group: 'reset', ip: 60, windowMs: 15 * MINUTE },
  '/refresh': { group: 'refresh', ip: 300, windowMs: 5 * MINUTE, emergencyFallback: true },
  '/interest': { group: 'interest', ip: 5, windowMs: HOUR },
  '/account/send-code': { group: 'account-send', ip: 30, windowMs: HOUR, user: 5 },
  '/account/verify-code': { group: 'account-redeem', ip: 120, windowMs: 15 * MINUTE, user: 20 },
  '/account/update': { group: 'account-redeem', ip: 120, windowMs: 15 * MINUTE, user: 20 },
};

function clientIp(req, vercel) {
  // Only the actual Vercel runtime may trust this platform-owned header.
  // Missing/multi-valued/malformed ingress identity fails closed, never use XFF as fallback.
  const value = vercel ? req.headers['x-vercel-forwarded-for'] : req.socket.remoteAddress;
  if (typeof value !== 'string' || !isIP(value)) throw new Error('Invalid client IP');
  let address = ipaddr.parse(value);
  if (address.kind() === 'ipv6' && address.isIPv4MappedAddress()) address = address.toIPv4Address();
  if (address.kind() === 'ipv4') return address.toString();
  // Group rotating IPv6 interface addresses, retaining the previous /56 policy.
  const bytes = address.toByteArray();
  bytes.fill(0, 7);
  return `${ipaddr.fromByteArray(bytes).toString()}/56`;
}

function createSecurityRateLimits({
  env = process.env, store, refreshFallbackStore, logger = console, timeoutMs = 1000,
} = {}) {
  const vercel = env.VERCEL === '1';
  const production = vercel || env.NODE_ENV === 'production';
  let secret = env.RATE_LIMIT_KEY_SECRET;
  let unavailable = false;
  let distributedStore = false;
  if (!store) {
    // Ordinary tests never use real provider credentials, even if dotenv loaded them.
    if (env.NODE_ENV === 'test' && !production) {
      store = createMemoryStore();
      secret = 'test-only-rate-limit-secret-at-least-32-characters';
    } else if (env.UPSTASH_REDIS_REST_URL || env.UPSTASH_REDIS_REST_TOKEN || production) {
      try {
        if (!env.UPSTASH_REDIS_REST_URL || !env.UPSTASH_REDIS_REST_TOKEN || !secret || secret.length < 32) {
          throw new Error('Missing configuration');
        }
        store = createUpstashStore({ url: env.UPSTASH_REDIS_REST_URL, token: env.UPSTASH_REDIS_REST_TOKEN });
        distributedStore = true;
      } catch {
        unavailable = true;
        logger.error('Security rate limiter configuration unavailable; protected requests return 503.');
      }
    } else {
      store = createMemoryStore();
      secret = secret || crypto.randomBytes(32).toString('hex');
      logger.warn('Security rate limiter uses local memory for development only.');
    }
  }
  if (store && (!secret || secret.length < 32)) throw new Error('Rate-limit key secret must have at least 32 characters');
  // Refresh alone may preserve session continuity during a provider outage. This
  // process-local ceiling is best-effort across serverless instances, never a
  // substitute for the normally required distributed store.
  const emergencyRefreshStore = refreshFallbackStore ||
    (distributedStore ? createMemoryStore({ maxEntries: 10000 }) : null);
  const publicRouter = express.Router();
  const accountRouter = express.Router();
  let lastFailureLog = -Infinity;
  let lastFallbackLog = -Infinity;
  function key(group, kind, value) {
    const digest = crypto.createHmac('sha256', secret).update(`${kind}:${value}`).digest('hex');
    return `caremind:rl:v1:${group}:${kind}:${digest}`;
  }
  function middleware(policy, userOnly = false) {
    return async (req, res, next) => {
      let timer;
      const controller = new AbortController();
      try {
        if (unavailable) throw new Error('Configuration unavailable');
        const buckets = [];
        if (userOnly) {
          if (!req.user?.id) throw new Error('Authenticated user required');
          buckets.push({ key: key(policy.group, 'user', String(req.user.id)), limit: policy.user, windowMs: policy.windowMs });
        } else {
          buckets.push({ key: key(policy.group, 'ip', clientIp(req, vercel)), limit: policy.ip, windowMs: policy.windowMs });
          if (policy.field) {
            const input = req.body?.[policy.field];
            // No DB lookup or existence-dependent key. Invalid/missing inputs still consume IP quota.
            if (typeof input === 'string' && input.trim()) {
              buckets.push({ key: key(policy.identityGroup || policy.group, 'identifier', input.trim().toLowerCase()),
                limit: policy.identity, windowMs: policy.windowMs });
            }
          }
        }
        const deadline = new Promise((resolve, reject) => {
          timer = setTimeout(() => { controller.abort(); reject(new Error('Rate-limit timeout')); }, timeoutMs);
        });
        let result;
        try {
          result = await Promise.race([store.consume(buckets, { signal: controller.signal }), deadline]);
        } catch (error) {
          if (!policy.emergencyFallback || !emergencyRefreshStore) throw error;
          clearTimeout(timer);
          result = await emergencyRefreshStore.consume(buckets);
          if (Date.now() - lastFallbackLog >= 30000) {
            lastFallbackLog = Date.now();
            logger.warn('Distributed refresh rate limiter unavailable; bounded per-instance fallback active.');
          }
        }
        if (!result || typeof result.allowed !== 'boolean' || !Number.isFinite(result.retryMs) || result.retryMs < 0) {
          throw new Error('Invalid rate-limit result');
        }
        if (!result.allowed) {
          res.set('Retry-After', String(Math.max(1, Math.ceil(result.retryMs / 1000))));
          res.set('Cache-Control', 'no-store');
          return res.status(429).json({ error: 'Πάρα πολλές προσπάθειες. Δοκιμάστε ξανά αργότερα.' });
        }
        return next();
      } catch {
        // Do not log request identifiers, provider errors/URLs, headers or credentials.
        if (!unavailable && Date.now() - lastFailureLog >= 30000) {
          lastFailureLog = Date.now();
          logger.error('Security rate limiter unavailable; request denied temporarily.');
        }
        res.set('Retry-After', '30');
        res.set('Cache-Control', 'no-store');
        return res.status(503).json({ error: 'Η υπηρεσία είναι προσωρινά μη διαθέσιμη. Δοκιμάστε ξανά σε λίγο.' });
      } finally {
        clearTimeout(timer);
      }
    };
  }
  for (const [path, policy] of Object.entries(POLICIES)) {
    publicRouter.post(`/api${path}`, middleware(policy));
    if (policy.user) accountRouter.post(path.slice('/account'.length), middleware(policy, true));
  }
  return { publicRouter, accountRouter, store };
}

module.exports = { createSecurityRateLimits, clientIp, POLICIES };
