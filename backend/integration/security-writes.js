// Invoked only by postgres.js after TEST_DATABASE_URL validation and migration
// of a generated disposable database. Never import server.js (loads dotenv).
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { Pool } = require("pg");
const express = require("express");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcrypt");
const { AsyncLocalStorage } = require("node:async_hooks");
const { runQuery, getConnection } = require("../postgres-query");

module.exports = async function securityWrites(t, config, observer, waitFor) {
  const pool = new Pool({ ...config, max: 4, application_name: "caremind-security-tests" });
  const dbPath = require.resolve("../db");
  const savedDb = require.cache[dbPath];
  const savedSecret = process.env.JWT_SECRET;
  const transactionContext = new AsyncLocalStorage();
  const transactions = require("../security-transaction");
  const originalTransaction = transactions.securityTransaction;
  transactions.securityTransaction = (database, work) => transactionContext.run(true, () => originalTransaction(database, work));
  process.env.JWT_SECRET = "p0b-disposable-test-secret-at-least-thirty-two-characters";
  let active = 0;
  let checkouts = 0;
  let releases = 0;
  let failure = null;
  const trace = [];
  const db = {
    query: (sql, params) => {
      assert.equal(transactionContext.getStore(), undefined, "pool query inside a security transaction");
      return runQuery(pool, sql, params);
    },
    async getConnection() {
      const connection = await getConnection(pool);
      active++; checkouts++;
      const query = connection.query;
      const release = connection.release;
      const id = checkouts;
      connection.query = async (sql, params) => {
        const [pid] = await query("SELECT pg_backend_pid() AS pid");
        trace.push({ id, pid: pid[0].pid, sql });
        if (failure && failure.test(sql)) {
          // A real PostgreSQL error aborts this transaction, not a mocked throw.
          await query("SELECT 1 / 0");
        }
        return query(sql, params);
      };
      connection.release = (error) => { active--; releases++; release(error); };
      return connection;
    },
  };
  require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: db };
  const { authenticateToken } = require("../authMiddleware");
  const app = express();
  app.use(express.json());
  app.use("/api", require("../routes/auth"));
  app.use("/api/account", authenticateToken, require("../routes/account"));
  app.use("/api/users", require("../routes/adminUsers"));
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await pool.end();
    transactions.securityTransaction = originalTransaction;
    if (savedDb) require.cache[dbPath] = savedDb;
    else delete require.cache[dbPath];
    if (savedSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = savedSecret;
  });
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const sign = (payload) => jwt.sign(payload, process.env.JWT_SECRET, { algorithm: "HS256", expiresIn: "15m" });
  async function post(path, body, userId, method = "POST") {
    const response = await fetch(base + path, {
      method, headers: { "Content-Type": "application/json",
        ...(userId ? { Authorization: `Bearer ${sign({ id: userId, purpose: "access" })}` } : {}) },
      body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  }
  let sequence = 0;
  async function fixture(kind) {
    const n = ++sequence;
    const user = (await observer.query("INSERT INTO users(username,email,password,is_active,email_verified) VALUES ($1,$2,'old-password',1,0) RETURNING *", [`p0b-user-${n}`, `p0b-${n}@example.test`])).rows[0];
    const table = kind === "reset" ? "password_reset_codes" : kind === "account" ? "verification_codes" : "email_verification_codes";
    const hash = crypto.createHash("sha256").update("123456").digest("hex");
    const code = (await observer.query(`INSERT INTO ${table}(user_id,code_hash,expires_at${kind === "account" ? ",purpose" : ""}) VALUES ($1,$2,clock_timestamp()+interval '10 minutes'${kind === "account" ? ",'account_change'" : ""}) RETURNING id`, [user.id, hash])).rows[0];
    await observer.query("INSERT INTO refresh_tokens(user_id,token_hash,expires_at) VALUES ($1,$2,clock_timestamp()+interval '1 day')", [user.id, crypto.randomBytes(32).toString("hex")]);
    const token = sign(kind === "reset" ? { userId: user.id, resetCodeId: code.id, purpose: "password_reset" } : { userId: user.id, verificationId: code.id, purpose: "account_change" });
    return { kind, table, user, code, token };
  }
  const redeem = (f, updates = { password: "new-password-123" }) => f.kind === "reset"
    ? post("/reset-password", { resetToken: f.token, newPassword: updates.password })
    : f.kind === "account" ? post("/account/update", { accountToken: f.token, updates }, f.user.id)
      : post("/verify-email", { email: f.user.email, code: "123456" });
  async function state(f) {
    return (await observer.query(`SELECT u.password,u.email,u.username,u.email_verified,u.role,u.is_active,c.used_at,r.revoked_at FROM users u JOIN ${f.table} c ON c.user_id=u.id JOIN refresh_tokens r ON r.user_id=u.id WHERE u.id=$1`, [f.user.id])).rows[0];
  }
  async function clean() {
    assert.equal(active, 0, "every checkout released");
    assert.equal(checkouts, releases);
    assert.equal(pool.totalCount, pool.idleCount);
    assert.equal((await observer.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND application_name='caremind-security-tests' AND state LIKE 'idle in transaction%' ")).rows[0].n, 0);
  }
  async function blocked(count) {
    // pg_stat_activity snapshots can be cached while the observer holds BEGIN.
    await observer.query("SELECT pg_stat_clear_snapshot()");
    return (await observer.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND application_name='caremind-security-tests' AND wait_event_type='Lock'")).rows[0].n === count;
  }

  for (const kind of ["reset", "account", "email"]) {
    await t.test(`${kind}: successful mutation and code consumption commit together`, async () => {
      const f = await fixture(kind);
      const updates = { password: "new-password-123", username: `changed-${sequence}`, email: `changed-${sequence}@example.test` };
      const result = await redeem(f, updates);
      assert.equal(result.status, 200);
      const actual = await state(f);
      assert.ok(actual.used_at);
      if (kind === "email") { assert.equal(actual.email_verified, 1); assert.equal(actual.revoked_at, null); }
      else {
        assert.equal(await bcrypt.compare(updates.password, actual.password), true);
        assert.equal(bcrypt.getRounds(actual.password), 12);
        assert.ok(actual.revoked_at);
      }
      if (kind === "account") {
        assert.equal(actual.username, updates.username); assert.equal(actual.email, updates.email);
        assert.equal(result.body.requiresLogin, true);
      }
      await clean();
    });
  }
  for (const field of ["email", "username"]) {
    await t.test(`account ${field}-only update consumes code without revoking sessions`, async () => {
      const f = await fixture("account");
      const value = field === "email" ? `only-${sequence}@example.test` : `only-${sequence}`;
      const result = await redeem(f, { [field]: value });
      assert.equal(result.status, 200); assert.equal(result.body.requiresLogin, false);
      const actual = await state(f);
      assert.equal(actual[field], value); assert.ok(actual.used_at);
      assert.equal(actual.password, "old-password"); assert.equal(actual.revoked_at, null);
      await clean();
    });
  }
  await t.test("concurrent email verification mutates once and preserves already-verified response", async () => {
    const f = await fixture("email");
    const start = trace.length;
    const results = await Promise.all([redeem(f), redeem(f)]);
    assert.deepEqual(results.map((r) => r.status), [200, 200]);
    assert.deepEqual(results.map((r) => r.body.message).sort(), ["Email already verified", "Email verified successfully"]);
    assert.equal(trace.slice(start).filter((entry) => /UPDATE users SET email_verified/.test(entry.sql)).length, 1);
    assert.ok((await state(f)).used_at);
    await clean();
  });
  for (const kind of ["reset", "account", "email"]) {
    for (const stage of ["mutation", "consumption", ...(kind === "email" ? [] : ["revocation"])]) {
      await t.test(`${kind}: PostgreSQL ${stage} failure rolls back all writes and leaves code reusable`, async () => {
        const f = await fixture(kind);
        const before = await state(f);
        failure = stage === "mutation" ? /UPDATE users SET/ : stage === "consumption" ? new RegExp(`UPDATE ${f.table} SET`) : /UPDATE refresh_tokens SET/;
        try {
          assert.equal((await redeem(f)).status, 500);
          assert.deepEqual(await state(f), before);
          await clean();
        } finally { failure = null; }
        assert.equal((await redeem(f)).status, 200, "same code must work after rollback");
        await clean();
      });
    }
  }
  for (const field of ["email", "username"]) {
    await t.test(`account ${field} uniqueness failure leaves code reusable`, async () => {
      const f = await fixture("account");
      const other = await fixture("account");
      const before = await state(f);
      // Force a real unique constraint violation *after* the route's preflight.
      const originalQuery = db.query;
      db.query = async (sql, params) => /SELECT id FROM users WHERE (email|username) =/.test(sql) ? [[], []] : originalQuery(sql, params);
      try { assert.equal((await redeem(f, { [field]: other.user[field] })).status, 500); }
      finally { db.query = originalQuery; }
      assert.deepEqual(await state(f), before);
      await clean();
      assert.equal((await redeem(f, { [field]: field === "email" ? `unique-${sequence}@example.test` : `unique-${sequence}` })).status, 200);
      await clean();
    });
  }
  for (const kind of ["reset", "account"]) {
    await t.test(`${kind}: simultaneous redemption has exactly one winner`, async () => {
      const f = await fixture(kind);
      await observer.query("BEGIN");
      await observer.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [f.user.id]);
      const pending = [redeem(f), redeem(f)];
      try {
        await waitFor(() => blocked(2), "both redemptions waiting on user lock");
      } finally { await observer.query("COMMIT"); await Promise.allSettled(pending); }
      const results = await Promise.all(pending);
      assert.deepEqual(results.map((r) => r.status).sort(), [200, 401]);
      assert.ok((await state(f)).used_at);
      await clean();
    });
    await t.test(`${kind}: code expiry is revalidated after waiting for its row lock`, async () => {
      const f = await fixture(kind);
      const before = await state(f);
      await observer.query("BEGIN");
      await observer.query(`SELECT id FROM ${f.table} WHERE id=$1 FOR UPDATE`, [f.code.id]);
      const pending = redeem(f);
      try {
        await waitFor(() => blocked(1), "redemption waiting on code lock");
        await observer.query(`UPDATE ${f.table} SET expires_at=clock_timestamp()+interval '100 milliseconds' WHERE id=$1`, [f.code.id]);
        await observer.query("SELECT pg_sleep(0.2)");
      } finally { await observer.query("COMMIT"); await Promise.allSettled([pending]); }
      assert.equal((await pending).status, 401);
      assert.deepEqual(await state(f), before);
      await clean();
    });
  }
  await t.test("account authorization is revalidated after waiting for user lock", async () => {
    const f = await fixture("account");
    const before = await state(f);
    await observer.query("BEGIN");
    await observer.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [f.user.id]);
    const pending = redeem(f);
    try {
      await waitFor(() => blocked(1), "account user lock");
      await observer.query("UPDATE users SET is_active=0 WHERE id=$1", [f.user.id]);
    } finally { await observer.query("COMMIT"); await Promise.allSettled([pending]); }
    assert.equal((await pending).status, 403);
    assert.deepEqual(await state(f), { ...before, is_active: 0 });
    await clean();
  });
  await t.test("JWT purposes, code ownership and database purpose remain isolated", async () => {
    const reset = await fixture("reset");
    const account = await fixture("account");
    for (const purpose of ["access", "account_change", undefined]) {
      reset.token = sign({ userId: reset.user.id, resetCodeId: reset.code.id, purpose });
      assert.equal((await redeem(reset)).status, 401);
    }
    for (const purpose of ["access", "password_reset", undefined]) {
      account.token = sign({ userId: account.user.id, verificationId: account.code.id, purpose });
      assert.equal((await redeem(account)).status, 401);
    }
    reset.token = sign({ userId: account.user.id, resetCodeId: reset.code.id, purpose: "password_reset" });
    assert.equal((await redeem(reset)).status, 401);
    account.token = sign({ userId: account.user.id, verificationId: account.code.id, purpose: "account_change" });
    await observer.query("UPDATE verification_codes SET purpose='other' WHERE id=$1", [account.code.id]);
    assert.equal((await redeem(account)).status, 401);
    assert.equal((await state(reset)).used_at, null); assert.equal((await state(account)).used_at, null);
    await clean();
  });
  await t.test("legacy login upgrade and session creation commit or roll back together", async () => {
    const f = await fixture("reset");
    await observer.query("UPDATE users SET email_verified=1 WHERE id=$1", [f.user.id]);
    failure = /INSERT INTO refresh_tokens/;
    try {
      assert.equal((await post("/login", { username: f.user.username, password: "old-password" })).status, 500);
      assert.equal((await state(f)).password, "old-password");
      assert.equal((await observer.query("SELECT count(*)::int AS n FROM refresh_tokens WHERE user_id=$1", [f.user.id])).rows[0].n, 1);
      await clean();
    } finally { failure = null; }
    assert.equal((await post("/login", { username: f.user.username, password: "old-password" })).status, 200);
    assert.equal(await bcrypt.compare("old-password", (await state(f)).password), true);
    assert.equal((await observer.query("SELECT count(*)::int AS n FROM refresh_tokens WHERE user_id=$1", [f.user.id])).rows[0].n, 2);
    await clean();
  });
  for (const legacy of [true, false]) {
    await t.test(`${legacy ? "legacy" : "bcrypt"} login cannot overwrite or bypass a concurrent password change`, async () => {
      const f = await fixture("reset");
      await observer.query("UPDATE users SET email_verified=1,password=$2 WHERE id=$1", [f.user.id, legacy ? "old-password" : await bcrypt.hash("old-password", 4)]);
      await observer.query("BEGIN");
      await observer.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [f.user.id]);
      const pending = post("/login", { username: f.user.username, password: "old-password" });
      try {
        await waitFor(() => blocked(1), "login awaiting final credential check");
        await observer.query("UPDATE users SET password='concurrently-changed' WHERE id=$1", [f.user.id]);
        await observer.query("UPDATE refresh_tokens SET revoked_at=clock_timestamp() WHERE user_id=$1", [f.user.id]);
      } finally { await observer.query("COMMIT"); await Promise.allSettled([pending]); }
      const result = await pending;
      assert.equal(result.status, 401); assert.equal(result.body.code, "INVALID_CREDENTIALS");
      assert.equal((await state(f)).password, "concurrently-changed");
      assert.equal((await observer.query("SELECT count(*)::int AS n FROM refresh_tokens WHERE user_id=$1 AND revoked_at IS NULL", [f.user.id])).rows[0].n, 0);
      await clean();
    });
  }
  for (const action of ["role", "toggle-active"]) {
    await t.test(`admin ${action}: revocation failure rolls back mutation; retry commits both`, async () => {
      const actor = await fixture("account");
      const target = await fixture("account");
      await observer.query("UPDATE users SET role='owner' WHERE id=$1", [actor.user.id]);
      if (action === "role") await observer.query("UPDATE users SET role='admin' WHERE id=$1", [target.user.id]);
      const before = await state(target);
      const mutate = () => post(`/users/${target.user.id}/${action}`, { role: "user" }, actor.user.id, "PATCH");
      failure = /UPDATE refresh_tokens/;
      try {
        assert.equal((await mutate()).status, 500);
        assert.deepEqual(await state(target), before);
        await clean();
      } finally { failure = null; }
      assert.equal((await mutate()).status, 200);
      const after = await state(target);
      assert.ok(after.revoked_at);
      assert.equal(action === "role" ? after.role : after.is_active, action === "role" ? "user" : 0);
      await clean();
    });
  }
  await t.test("each transaction keeps one backend PID and locks user before code before session writes", async () => {
    for (const id of new Set(trace.map((entry) => entry.id))) {
      const entries = trace.filter((entry) => entry.id === id);
      assert.equal(new Set(entries.map((entry) => entry.pid)).size, 1);
      assert.match(entries[0].sql, /FROM users .*FOR UPDATE/);
      const codeLock = entries.findIndex((entry) => /FROM .*codes .*FOR UPDATE/.test(entry.sql));
      const mutation = entries.findIndex((entry) => /UPDATE users SET/.test(entry.sql));
      if (mutation >= 0 && !/UPDATE users SET (role|is_active)/.test(entries[mutation].sql)
          && !entries.some((entry) => /INSERT INTO refresh_tokens/.test(entry.sql))) assert.ok(codeLock > 0 && codeLock < mutation);
    }
    await clean();
  });
};
