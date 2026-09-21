// Explicit command only. No dotenv, runtime pool, or DATABASE_URL fallback.
const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { Client } = require("pg");
const { migrate } = require("../scripts/migrate");
const { testDatabaseConfig } = require("../scripts/migration-config");

// Validate before constructing any client. Only the shell's explicit test URL is read.
const config = testDatabaseConfig();
const source = path.resolve(__dirname, "../migrations");
const expected = ["001_initial_schema.js", "002_align_legacy_schema.js"];
const logger = { log() {} };
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitFor(probe, description) {
  const until = Date.now() + 8_000;
  while (Date.now() < until) {
    if (await probe()) return;
    await delay(40);
  }
  throw new Error(`Timed out waiting for ${description}`);
}

test("real PostgreSQL migration guarantees", { timeout: 110_000 }, async (t) => {
  const admin = new Client(config);
  const databases = [];
  const clients = [];
  const pending = [];
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "caremind-migrations-"));
  t.after(async () => {
    try {
      // Release the concurrency gate even when an assertion fails.
      await admin.query("SELECT pg_advisory_unlock_all()").catch(() => {});
      await Promise.allSettled(pending);
      await Promise.allSettled(clients.map((client) => client.end()));
      for (const name of databases) {
        // Names are generated locally, never taken from a supplied connection URL.
        assert.match(name, /^caremind_test_run_[a-f0-9]+$/);
        await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
      }
    } finally {
      await admin.end();
      await fs.rm(temporary, { recursive: true, force: true });
    }
  });
  await admin.connect();
  const hashes = async () => Promise.all(expected.map(async (name) => crypto.createHash("sha256").update(await fs.readFile(path.join(source, name))).digest("hex")));
  const originalHashes = await hashes();
  async function database() {
    const name = `caremind_test_run_${crypto.randomBytes(10).toString("hex")}`;
    await admin.query(`CREATE DATABASE "${name}"`);
    databases.push(name);
    const client = new Client({ ...config, database: name });
    clients.push(client);
    await client.connect();
    const url = new URL(process.env.TEST_DATABASE_URL);
    url.pathname = `/${name}`;
    return { client, env: { MIGRATION_DATABASE_URL: url.toString(), CI: "true" }, name };
  }
  async function fixture(label) {
    const directory = path.join(temporary, label);
    await fs.mkdir(directory);
    for (const name of expected) await fs.copyFile(path.join(source, name), path.join(directory, name));
    return directory;
  }
  async function noRunnerSessions(name) {
    const result = await admin.query("SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname=$1 AND application_name='caremind-migrations'", [name]);
    assert.equal(result.rows[0].count, 0, "dedicated migration sessions must be closed");
  }
  const fresh = await database();
  let ledger;
  await t.test("fresh database applies exactly 001/002 and all expected tables", async () => {
    await migrate({ env: fresh.env, logger });
    ledger = (await fresh.client.query("SELECT name, checksum, executed_at FROM schema_migrations ORDER BY name")).rows;
    assert.deepEqual(ledger.map((row) => row.name), expected);
    assert.deepEqual(ledger.map((row) => row.checksum), originalHashes);
    const tables = (await fresh.client.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows.map((row) => row.tablename);
    assert.deepEqual(tables, ["companies", "costs", "email_verification_codes", "interest_requests", "maintenances", "notification_recipients", "password_reset_codes", "refresh_tokens", "schema_migrations", "users", "vehicles", "verification_codes"]);
    await fresh.client.query("INSERT INTO companies(name) VALUES ('preserve-me')");
    await noRunnerSessions(fresh.name);
  });
  await t.test("second run skips both migrations and preserves ledger/data", async () => {
    const messages = [];
    await migrate({ env: fresh.env, logger: { log: (message) => messages.push(message) } });
    assert.equal(messages.filter((message) => message.startsWith("skip ")).length, 2);
    assert.equal(messages.filter((message) => message.startsWith("run ")).length, 0);
    assert.deepEqual((await fresh.client.query("SELECT name, checksum, executed_at FROM schema_migrations ORDER BY name")).rows, ledger);
    assert.equal((await fresh.client.query("SELECT name FROM companies")).rows[0].name, "preserve-me");
  });
  await t.test("tampered copied migration fails without changing data or repository bytes", async () => {
    const directory = await fixture("checksum");
    await fs.appendFile(path.join(directory, expected[0]), "\n// deliberate test-only checksum change\n");
    await assert.rejects(migrate({ env: fresh.env, directory, logger }), /Applied migration was modified: 001/);
    assert.deepEqual(await hashes(), originalHashes);
    assert.deepEqual((await fresh.client.query("SELECT name, checksum, executed_at FROM schema_migrations ORDER BY name")).rows, ledger);
    assert.equal((await fresh.client.query("SELECT name FROM companies")).rows[0].name, "preserve-me");
    await noRunnerSessions(fresh.name);
  });
  await t.test("failed migration rolls back DDL/write/ledger, stops later files and releases session", async () => {
    const directory = await fixture("rollback");
    await fs.writeFile(path.join(directory, "900_failure.js"), `exports.up = async (db) => {
      await db.query("CREATE TABLE rollback_probe (id SERIAL PRIMARY KEY)");
      await db.query("INSERT INTO companies(name) VALUES ('must-rollback')");
      await db.query("SELECT 1/0");
    };`);
    await fs.writeFile(path.join(directory, "901_never.js"), `exports.up = async (db) => { await db.query("CREATE TABLE never_probe (id SERIAL PRIMARY KEY)"); };`);
    await assert.rejects(migrate({ env: fresh.env, directory, logger }), /division by zero/);
    assert.equal((await fresh.client.query("SELECT to_regclass('rollback_probe') AS a, to_regclass('never_probe') AS b")).rows[0].a, null);
    assert.equal((await fresh.client.query("SELECT to_regclass('never_probe') AS b")).rows[0].b, null);
    assert.deepEqual((await fresh.client.query("SELECT name FROM companies")).rows, [{ name: "preserve-me" }]);
    assert.deepEqual((await fresh.client.query("SELECT name, checksum, executed_at FROM schema_migrations ORDER BY name")).rows, ledger);
    await noRunnerSessions(fresh.name);
    await migrate({ env: fresh.env, logger });
  });
  await t.test("two real runners serialize and execute on the session owning the lock", async () => {
    const target = await database();
    const directory = await fixture("concurrency");
    await fs.writeFile(path.join(directory, "900_concurrency.js"), `exports.up = async (db) => {
      await db.query("SELECT pg_advisory_xact_lock(71920421)");
      await db.query("CREATE TABLE session_probe (id SERIAL PRIMARY KEY, pid INTEGER, owns_lock BOOLEAN)");
      await db.query("INSERT INTO session_probe(pid, owns_lock) SELECT pg_backend_pid(), EXISTS (SELECT 1 FROM pg_locks WHERE locktype='advisory' AND pid=pg_backend_pid() AND granted AND objid=hashtext('caremind_migrations')::oid)");
    };`);
    // Advisory locks are database-local, so hold the gate on the target database.
    await target.client.query("SELECT pg_advisory_lock(71920421)");
    let runA, runB;
    try {
      runA = migrate({ env: target.env, directory, logger });
      pending.push(runA);
      runA.catch(() => {});
      const locks = async () => (await target.client.query("SELECT pid, granted FROM pg_locks WHERE locktype='advisory' AND database=(SELECT oid FROM pg_database WHERE datname=current_database()) AND objid=hashtext('caremind_migrations')::oid")).rows;
      await waitFor(async () => (await locks()).some((row) => row.granted), "runner A migration lock");
      const pidA = (await locks()).find((row) => row.granted).pid;
      await waitFor(async () => (await target.client.query("SELECT 1 FROM pg_locks WHERE pid=$1 AND locktype='advisory' AND objid=71920421 AND NOT granted", [pidA])).rowCount === 1, "runner A fixture gate");
      runB = migrate({ env: target.env, directory, logger });
      pending.push(runB);
      runB.catch(() => {});
      await waitFor(async () => (await locks()).some((row) => !row.granted && row.pid !== pidA), "runner B blocked on migration lock");
      assert.equal((await target.client.query("SELECT to_regclass('session_probe') AS probe")).rows[0].probe, null);
      await target.client.query("SELECT pg_advisory_unlock(71920421)");
      await Promise.all([runA, runB]);
      assert.deepEqual((await target.client.query("SELECT pid, owns_lock FROM session_probe")).rows, [{ pid: pidA, owns_lock: true }]);
      assert.deepEqual((await target.client.query("SELECT name FROM schema_migrations ORDER BY name")).rows.map((row) => row.name), [...expected, "900_concurrency.js"]);
      assert.deepEqual(await locks(), []);
      await noRunnerSessions(target.name);
    } finally {
      await target.client.query("SELECT pg_advisory_unlock_all()");
      await Promise.allSettled([runA, runB].filter(Boolean));
    }
  });
  assert.deepEqual(await hashes(), originalHashes);
  await t.test("atomic security writes on disposable PostgreSQL", async (securityTest) => {
    await require("./security-writes")(securityTest, { ...config, database: fresh.name }, fresh.client, waitFor);
  });
});
