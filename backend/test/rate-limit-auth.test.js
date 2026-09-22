const assert = require('node:assert/strict');
const { before, after, beforeEach, test } = require('node:test');
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-only-auth-rate-limit-secret-with-32-characters';
delete process.env.VERCEL;
// Intercept email before loading handlers; these tests never send real email.
require.cache[require.resolve('../emailService')] = { exports: async () => {} };
const db = require('../db');
let handler;
db.query = (...args) => handler(...args);
const app = require('../server');
let server;
let base;
before(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', () => { base = `http://127.0.0.1:${server.address().port}`; resolve(); });
  });
});
beforeEach(() => app.locals.rateLimitStore.clear());
after(async () => { await new Promise((resolve) => server.close(resolve)); await db.end(); });
async function post(path, body) {
  const response = await fetch(`${base}/api${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json(), retry: response.headers.get('retry-after') };
}

test('login missing account and wrong password retain identical failures and rate-limit treatment', async () => {
  handler = async (sql, params) => [[params[0] === 'existing' ? { id: 1, password: 'correct-password', is_active: 1 } : null].filter(Boolean)];
  for (let i = 0; i < 10; i++) {
    const missing = await post('/login', { username: 'missing', password: 'wrong' });
    const existing = await post('/login', { username: 'existing', password: 'wrong' });
    assert.equal(missing.status, 401);
    assert.deepEqual(existing, missing);
    assert.equal(missing.body.code, 'INVALID_CREDENTIALS');
  }
  const missing = await post('/login', { username: 'missing', password: 'wrong' });
  const existing = await post('/login', { username: 'existing', password: 'wrong' });
  assert.equal(missing.status, 429);
  assert.equal(existing.status, 429);
  assert.deepEqual(existing.body, missing.body);
});

test('forgot password has identical generic success and quota for existing and absent email', async () => {
  handler = async (sql, params) => {
    if (sql.startsWith('SELECT')) return [params[0] === 'existing@example.com' ? [{ id: 1, username: 'existing' }] : []];
    assert.match(sql, /INSERT INTO password_reset_codes/);
    return [{ insertId: 1 }];
  };
  for (let i = 0; i < 5; i++) {
    const missing = await post('/forgot-password', { email: 'missing@example.com' });
    const existing = await post('/forgot-password', { email: 'existing@example.com' });
    assert.deepEqual(existing, missing);
    assert.equal(existing.status, 200);
    assert.equal(existing.body.message, 'If the email exists, the request was processed.');
  }
  const missing = await post('/forgot-password', { email: 'missing@example.com' });
  const existing = await post('/forgot-password', { email: 'existing@example.com' });
  assert.equal(existing.status, 429);
  assert.equal(missing.status, 429);
  assert.deepEqual(existing.body, missing.body);
});

test('account IP protection precedes authentication and new update redemption route is covered', async () => {
  handler = () => assert.fail('Missing bearer must not access the database');
  for (let i = 0; i < 120; i++) assert.equal((await post('/account/update', {})).status, 401);
  assert.equal((await post('/account/verify-code', {})).status, 429);
});
