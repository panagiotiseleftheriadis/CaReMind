// Upstash Redis REST boundary. No TCP pool, SDK retries or fail-open timeout.
const CONSUME_SCRIPT = `
local retry = 0
for i, key in ipairs(KEYS) do
  local count = tonumber(redis.call('GET', key) or '0')
  local ttl = redis.call('PTTL', key)
  if count >= tonumber(ARGV[(i-1)*2+1]) then
    if ttl < 0 then return redis.error_reply('Invalid limiter TTL') end
    retry = math.max(retry, ttl, 1)
  end
end
if retry > 0 then return {0, retry} end
for i, key in ipairs(KEYS) do
  local count = redis.call('INCR', key)
  if count == 1 then redis.call('PEXPIRE', key, ARGV[(i-1)*2+2]) end
end
return {1, 0}
`;

function createUpstashStore({ url, token, fetchImpl = fetch }) {
  let endpoint;
  try { endpoint = new URL(url); } catch { throw new Error('Invalid rate-limit Redis URL'); }
  if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password ||
      endpoint.search || endpoint.hash || endpoint.pathname !== '/') {
    throw new Error('Rate-limit Redis URL must be an HTTPS origin');
  }
  return {
    async consume(buckets, { signal } = {}) {
      const response = await fetchImpl(endpoint.href, {
        method: 'POST', redirect: 'error', signal,
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(['EVAL', CONSUME_SCRIPT, buckets.length,
          ...buckets.map((bucket) => bucket.key),
          ...buckets.flatMap((bucket) => [bucket.limit, bucket.windowMs])]),
      });
      if (!response.ok) throw new Error('Rate-limit provider HTTP failure');
      const payload = await response.json();
      const result = payload.result;
      if (payload.error || !Array.isArray(result) || result.length !== 2 ||
          ![0, 1].includes(result[0]) || !Number.isSafeInteger(result[1]) || result[1] < 0 ||
          (result[0] === 0 && result[1] === 0)) {
        throw new Error('Invalid rate-limit provider response');
      }
      return { allowed: result[0] === 1, retryMs: result[1] };
    },
  };
}

// Development/test only. Share one store between factories to model Redis instances.
function createMemoryStore({ now = Date.now, maxEntries = 10000 } = {}) {
  const entries = new Map();
  return {
    clear() { entries.clear(); },
    async consume(buckets) {
      const time = now();
      for (const [key, value] of entries) if (value.reset <= time) entries.delete(key);
      let retryMs = 0;
      for (const bucket of buckets) {
        const value = entries.get(bucket.key);
        if (value && value.count >= bucket.limit) retryMs = Math.max(retryMs, value.reset - time);
      }
      if (retryMs) return { allowed: false, retryMs };
      const newKeys = new Set(buckets.filter((bucket) => !entries.has(bucket.key)).map((bucket) => bucket.key));
      if (entries.size + newKeys.size > maxEntries) throw new Error('Local rate-limit capacity exceeded');
      for (const bucket of buckets) {
        const value = entries.get(bucket.key) || { count: 0, reset: time + bucket.windowMs };
        value.count++;
        entries.set(bucket.key, value);
      }
      return { allowed: true, retryMs: 0 };
    },
  };
}

module.exports = { createUpstashStore, createMemoryStore, CONSUME_SCRIPT };
