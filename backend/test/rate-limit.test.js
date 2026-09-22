const assert = require('node:assert/strict');
const test = require('node:test');
const express = require('express');
const { createSecurityRateLimits, clientIp, POLICIES } = require('../security-rate-limit');
const { createMemoryStore, createUpstashStore, CONSUME_SCRIPT } = require('../rate-limit-store');

const env = { NODE_ENV: 'test', RATE_LIMIT_KEY_SECRET: 'a-test-only-secret-with-at-least-32-characters' };
const quiet = { error() {}, warn() {} };
async function application(t, options = {}, user = { id: 7 }) {
  const app = express();
  app.set('trust proxy', false);
  app.use(express.json());
  const limits = createSecurityRateLimits({ env, logger: quiet, ...options });
  app.use(limits.publicRouter);
  app.use('/api/account', (req, res, next) => { req.user = user; next(); }, limits.accountRouter);
  app.use((req, res) => res.json({ ok: true }));
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return async (path, body = {}, headers = {}, method = 'POST') => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
      method, headers: { 'Content-Type': 'application/json', ...headers },
      body: method === 'GET' ? undefined : JSON.stringify(body),
    });
    const bodyText = await response.text();
    return { status: response.status, headers: response.headers,
      body: response.headers.get('content-type')?.includes('application/json') ? JSON.parse(bodyText) : bodyText };
  };
}

test('under limit succeeds; shared instances enforce 429, Retry-After, and reset without extending a block', async (t) => {
  let now = 0;
  const store = createMemoryStore({ now: () => now });
  const a = await application(t, { store });
  const b = await application(t, { store });
  for (let i = 0; i < 10; i++) assert.equal((await (i % 2 ? a : b)('/api/login', { username: 'alice' })).status, 200);
  now = 1001;
  const blocked = await b('/api/login', { username: 'alice' });
  assert.equal(blocked.status, 429);
  assert.equal(blocked.headers.get('retry-after'), '899');
  assert.equal(blocked.headers.get('cache-control'), 'no-store');
  assert.deepEqual(Object.keys(blocked.body), ['error']);
  assert.equal((await a('/api/login', { username: 'bob' })).status, 200);
  now = 900000;
  assert.equal((await b('/api/login', { username: 'alice' })).status, 200);
});

test('concurrent clients cannot exceed shared quota', async (t) => {
  const store = createMemoryStore();
  const a = await application(t, { store });
  const b = await application(t, { store });
  const results = await Promise.all(Array.from({ length: 30 }, (_, i) =>
    (i % 2 ? a : b)('/api/login', { username: 'same-account' })));
  assert.equal(results.filter((r) => r.status === 200).length, 10);
  assert.equal(results.filter((r) => r.status === 429).length, 20);
});

test('identifier normalization, route case/trailing slash and email endpoint variants share quotas', async (t) => {
  const request = await application(t);
  for (let i = 0; i < 5; i++) {
    const path = ['/api/register', '/api/resend-verification', '/api/forgot-password'][i % 3];
    assert.equal((await request(path, { email: ' Person@Example.com ' })).status, 200);
  }
  assert.equal((await request('/API/FORGOT-PASSWORD/', { email: 'person@example.com' })).status, 429);
  assert.equal((await request('/api/forgot-password', { email: 'other@example.com' })).status, 200);
  for (let i = 0; i < 10; i++) {
    assert.equal((await request(i % 2 ? '/api/verify-email' : '/api/verify-reset-code', { email: 'person@example.com' })).status, 200);
  }
  assert.equal((await request('/api/verify-reset-code', { email: 'person@example.com' })).status, 429);
});

test('authenticated identity comes from req.user, and verify/update share a redemption quota', async (t) => {
  const store = createMemoryStore();
  const a = await application(t, { store });
  const b = await application(t, { store }, { id: 8 });
  for (let i = 0; i < 20; i++) {
    assert.equal((await a(i % 2 ? '/api/account/update' : '/api/account/verify-code', { user_id: i })).status, 200);
  }
  assert.equal((await a('/api/account/update', { user_id: 8 })).status, 429);
  assert.equal((await b('/api/account/update')).status, 200);
  for (let i = 0; i < 5; i++) assert.equal((await a('/api/account/send-code')).status, 200);
  assert.equal((await a('/api/account/send-code')).status, 429);
});

test('every configured security endpoint has an IP ceiling, including malformed requests', async (t) => {
  for (const [path, policy] of Object.entries(POLICIES)) {
    // Preload just the IP quota to avoid hundreds of HTTP requests.
    const memory = createMemoryStore();
    const store = { async consume(buckets) {
      const ip = buckets.find((bucket) => bucket.key.includes(':ip:'));
      if (ip) {
        assert.equal(ip.limit, policy.ip);
        assert.equal(ip.windowMs, policy.windowMs);
        for (let i = 0; i < policy.ip; i++) await memory.consume([ip]);
      }
      return memory.consume(buckets);
    } };
    const request = await application(t, { store });
    assert.equal((await request(`/api${path}`, { email: [], username: null })).status, 429, path);
  }
});

test('CRUD, health, cron and preflight are not limited by these policies', async (t) => {
  const request = await application(t, { store: { consume() { assert.fail('Unexpected limiter'); } } });
  for (const path of ['/api/logout', '/api/vehicles', '/api/costs', '/api/maintenances', '/api/health', '/api/cron/maintenance', '/api/account/recipients']) {
    assert.equal((await request(path)).status, 200);
  }
  assert.equal((await request('/api/login', {}, {}, 'OPTIONS')).status, 200);
});

test('direct connections ignore all spoofable forwarding headers', async (t) => {
  const request = await application(t);
  for (let i = 0; i < 8; i++) {
    const result = await request('/api/interest', {}, {
      'X-Forwarded-For': `203.0.113.${i + 1}`,
      'X-Vercel-Forwarded-For': `198.51.100.${i + 1}`,
      'X-Real-IP': `192.0.2.${i + 1}`, Forwarded: `for=192.0.2.${i + 1}`,
    });
    assert.equal(result.status, i < 5 ? 200 : 429);
  }
});

test('Vercel uses only platform IP; changing XFF does not bypass it; missing/malformed platform IP fails closed', async (t) => {
  const request = await application(t, { env: { ...env, VERCEL: '1' }, store: createMemoryStore() });
  for (let i = 0; i < 6; i++) {
    assert.equal((await request('/api/interest', {}, {
      'x-vercel-forwarded-for': '203.0.113.5', 'x-forwarded-for': `192.0.2.${i + 1}`,
    })).status, i < 5 ? 200 : 429);
  }
  assert.equal((await request('/api/interest', {}, { 'x-vercel-forwarded-for': '203.0.113.6' })).status, 200);
  for (const value of ['', '203.0.113.1, 192.0.2.1', '127.1', 'not-an-ip']) {
    assert.equal((await request('/api/login', {}, { 'x-vercel-forwarded-for': value })).status, 503);
  }
});

test('IPv4-mapped and equivalent IPv6 addresses normalize; IPv6 privacy addresses share /56', () => {
  const ip = (value) => clientIp({ socket: { remoteAddress: value } }, false);
  assert.equal(ip('::ffff:192.0.2.1'), ip('192.0.2.1'));
  assert.equal(ip('2001:db8:abcd:1200::1'), ip('2001:0db8:abcd:12ff:ffff::2'));
  assert.notEqual(ip('2001:db8:abcd:1200::1'), ip('2001:db8:abcd:1300::1'));
});

test('keys contain HMACs, never raw personal data, passwords, JWTs, codes or IPs', async (t) => {
  const keys = [];
  const request = await application(t, { store: { async consume(buckets) {
    keys.push(...buckets.map((b) => b.key)); return { allowed: true, retryMs: 0 };
  } } });
  await request('/api/login', { username: 'private@example.com', password: 'password-secret' });
  await request('/api/verify-email', { email: 'private@example.com', code: '123456' });
  await request('/api/reset-password', { resetToken: 'jwt-secret', newPassword: 'password-secret' });
  await request('/api/account/update', { accountToken: 'jwt-secret', user_id: 'untrusted' });
  assert.ok(keys.length > 5);
  for (const key of keys) {
    assert.match(key, /^caremind:rl:v1:[a-z-]+:(ip|identifier|user):[a-f0-9]{64}$/);
    assert.doesNotMatch(key, /private|example|password|jwt-secret|123456|127\.0|untrusted/);
  }
});

test('provider rejection fails closed with temporary 503; logs contain no provider details; recovery works', async (t) => {
  let fail = true;
  const logs = [];
  const request = await application(t, {
    logger: { error: (message) => logs.push(message) },
    store: { async consume() { if (fail) throw new Error('token-and-email-must-not-leak'); return { allowed: true, retryMs: 0 }; } },
  });
  for (let i = 0; i < 3; i++) {
    const response = await request('/api/login');
    assert.equal(response.status, 503);
    assert.equal(response.headers.get('retry-after'), '30');
    assert.doesNotMatch(JSON.stringify(response.body), /token-and-email/);
  }
  assert.equal(logs.length, 1);
  assert.doesNotMatch(logs.join(), /token-and-email/);
  fail = false;
  assert.equal((await request('/api/login')).status, 200);
});

test('refresh uses a bounded per-instance fallback only after a distributed-store failure', async (t) => {
  const fallbackBuckets = [];
  let fallbackAllowed = true;
  const logs = [];
  const request = await application(t, {
    store: { async consume() { throw new Error('provider detail must not leak'); } },
    refreshFallbackStore: { async consume(buckets) {
      fallbackBuckets.push(buckets);
      return { allowed: fallbackAllowed, retryMs: fallbackAllowed ? 0 : 1234 };
    } },
    logger: { error: (message) => logs.push(message), warn: (message) => logs.push(message) },
  });
  assert.equal((await request('/api/refresh')).status, 200);
  assert.equal(fallbackBuckets.length, 1);
  assert.equal(fallbackBuckets[0].length, 1);
  assert.equal(fallbackBuckets[0][0].limit, POLICIES['/refresh'].ip);
  assert.equal(fallbackBuckets[0][0].windowMs, POLICIES['/refresh'].windowMs);
  fallbackAllowed = false;
  const blocked = await request('/api/refresh');
  assert.equal(blocked.status, 429);
  assert.equal(blocked.headers.get('retry-after'), '2');
  assert.equal(logs.length, 1);
  assert.doesNotMatch(logs[0], /provider detail/);
  assert.equal((await request('/api/login')).status, 503);
});

test('refresh fails closed for configuration, client-IP, or emergency-fallback failure', async (t) => {
  const missingConfig = await application(t, { env: { NODE_ENV: 'production' } });
  assert.equal((await missingConfig('/api/refresh')).status, 503);

  const invalidIp = await application(t, {
    env: { ...env, VERCEL: '1' },
    store: { async consume() { assert.fail('Invalid IP must not reach the store'); } },
    refreshFallbackStore: { async consume() { assert.fail('Invalid IP must not use fallback'); } },
  });
  assert.equal((await invalidIp('/api/refresh', {}, { 'x-vercel-forwarded-for': 'invalid' })).status, 503);

  const failedFallback = await application(t, {
    store: { async consume() { throw new Error('provider failure'); } },
    refreshFallbackStore: { async consume() { throw new Error('fallback capacity failure'); } },
  });
  assert.equal((await failedFallback('/api/refresh')).status, 503);
});

test('deadline bounds a stalled store and aborts its HTTP signal', async (t) => {
  let signal;
  const request = await application(t, { timeoutMs: 20, store: { consume(buckets, options) {
    signal = options.signal; return new Promise(() => {});
  } } });
  const start = Date.now();
  assert.equal((await request('/api/login')).status, 503);
  assert.ok(Date.now() - start < 1000);
  assert.equal(signal.aborted, true);
});

test('missing or partial production/Vercel configuration never falls back to memory', async (t) => {
  for (const config of [{ NODE_ENV: 'production' }, { VERCEL: '1' },
    { NODE_ENV: 'production', UPSTASH_REDIS_REST_URL: 'https://test.invalid' },
    { NODE_ENV: 'production', UPSTASH_REDIS_REST_URL: 'http://test.invalid', UPSTASH_REDIS_REST_TOKEN: 'fake', RATE_LIMIT_KEY_SECRET: env.RATE_LIMIT_KEY_SECRET }]) {
    const request = await application(t, { env: config });
    assert.equal((await request('/api/login')).status, 503);
    assert.equal((await request('/api/vehicles')).status, 200);
  }
});

test('development memory is explicit and test mode ignores provider credentials', async (t) => {
  const warnings = [];
  const request = await application(t, { env: { NODE_ENV: 'development' }, logger: { warn: (m) => warnings.push(m) } });
  assert.equal((await request('/api/login')).status, 200);
  assert.equal(warnings.length, 1);
  const testRequest = await application(t, { env: { NODE_ENV: 'test', UPSTASH_REDIS_REST_URL: 'https://never-contact.invalid', UPSTASH_REDIS_REST_TOKEN: 'fake' } });
  assert.equal((await testRequest('/api/login')).status, 200);
});

test('local memory bounds capacity without evicting active quotas and expires unused keys', async () => {
  let now = 0;
  const store = createMemoryStore({ maxEntries: 1, now: () => now });
  const bucket = (key) => [{ key, limit: 1, windowMs: 10 }];
  await store.consume(bucket('a'));
  await assert.rejects(store.consume(bucket('b')), /capacity/);
  assert.equal((await store.consume(bucket('a'))).allowed, false);
  now = 10;
  assert.equal((await store.consume(bucket('b'))).allowed, true);
});

test('Upstash REST adapter sends one atomic EVAL, bearer auth, deadline signal and disables redirects', async () => {
  const controller = new AbortController();
  const buckets = [{ key: 'opaque-one', limit: 5, windowMs: 60000 }, { key: 'opaque-two', limit: 10, windowMs: 30000 }];
  let count = 0;
  const store = createUpstashStore({ url: 'https://test.invalid', token: 'fake-only', async fetchImpl(url, options) {
    count++;
    assert.equal(url, 'https://test.invalid/');
    assert.equal(options.method, 'POST');
    assert.equal(options.redirect, 'error');
    assert.equal(options.headers.Authorization, 'Bearer fake-only');
    assert.equal(options.signal, controller.signal);
    assert.deepEqual(JSON.parse(options.body), ['EVAL', CONSUME_SCRIPT, 2, 'opaque-one', 'opaque-two', 5, 60000, 10, 30000]);
    return { ok: true, async json() { return { result: count === 1 ? [1, 0] : [0, 1234] }; } };
  } });
  assert.deepEqual(await store.consume(buckets, { signal: controller.signal }), { allowed: true, retryMs: 0 });
  assert.deepEqual(await store.consume(buckets, { signal: controller.signal }), { allowed: false, retryMs: 1234 });
  assert.equal(count, 2);
});

test('Upstash HTTP errors, Redis errors and malformed results cannot allow requests or trigger retries', async () => {
  for (const response of [{ ok: false }, { ok: true, json: async () => ({ error: 'fake-provider-detail' }) },
    { ok: true, json: async () => ({ result: [0, 0] }) }, { ok: true, json: async () => ({ result: [2, 20] }) },
    { ok: true, json: async () => { throw new Error('bad JSON'); } }]) {
    let calls = 0;
    const store = createUpstashStore({ url: 'https://test.invalid', token: 'fake', async fetchImpl() { calls++; return response; } });
    await assert.rejects(store.consume([{ key: 'test', limit: 1, windowMs: 10 }]));
    assert.equal(calls, 1);
  }
});
