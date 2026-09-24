const assert = require("node:assert/strict");
const test = require("node:test");
const { Client } = require("pg");
const { migrationConfig, testDatabaseConfig } = require("../scripts/migration-config");

const local = "postgresql://tester:fake@127.0.0.1/caremind_test";
test("migrations prefer explicit direct configuration and require it in production/CI", () => {
  for (const context of [{ NODE_ENV: "production" }, { CI: "true" }, { VERCEL: "1" }]) {
    assert.throws(() => migrationConfig({ ...context, DATABASE_URL: local }), /MIGRATION_DATABASE_URL is required/);
    assert.equal(migrationConfig({ ...context, MIGRATION_DATABASE_URL: local }).host, "127.0.0.1");
  }
  assert.equal(migrationConfig({ DATABASE_URL: local }).database, "caremind_test");
  assert.equal(migrationConfig({ DATABASE_URL: "invalid", MIGRATION_DATABASE_URL: local }).host, "127.0.0.1");
  assert.throws(() => migrationConfig({ DATABASE_URL: "postgresql://u:p@direct.example/db" }), /required for remote/);
});

test("migration configuration rejects known poolers, ambiguous overrides and TLS downgrades", () => {
  for (const url of [
    "postgresql://u:p@ep-example-pooler.eu.neon.tech/db?sslmode=require",
    "postgresql://u:p@PGBOUNCER.example/db",
    `${local}?host=ep-example-pooler.neon.tech`,
    `${local}?database=production`,
    `${local}?options=-csearch_path=public`,
    `${local}?sslmode=disable&sslmode=require`,
    "postgresql://u:p@remote.example/db?sslmode=disable",
    "postgresql://u:p@remote.example/db?sslmode=no-verify",
    "postgresql://remote.example/db",
    `${local}?channel_binding=require`,
  ]) assert.throws(() => migrationConfig({ MIGRATION_DATABASE_URL: url }));
  const config = migrationConfig({ MIGRATION_DATABASE_URL: "postgresql://u:p@ep-example.neon.tech/db?sslmode=require&channel_binding=prefer", DB_SSL: "false", PGSSLMODE: "disable" });
  assert.deepEqual(config.ssl, { rejectUnauthorized: true });
  assert.equal(config.enableChannelBinding, true);
  assert.equal(config.connectionString, undefined);
  assert.equal(migrationConfig({ MIGRATION_DATABASE_URL: local }).ssl, false);
});

test("PostgreSQL tests never fall back to application/migration URLs or accept remote/production targets", () => {
  assert.throws(() => testDatabaseConfig({ DATABASE_URL: local, MIGRATION_DATABASE_URL: local }), /TEST_DATABASE_URL is required/);
  for (const url of [local.replace("caremind_test", "production"), local.replace("127.0.0.1", "localhost"), local.replace("127.0.0.1", "remote.example"), `${local}?host=remote.example`]) {
    assert.throws(() => testDatabaseConfig({ TEST_DATABASE_URL: url }));
  }
  assert.equal(testDatabaseConfig({ TEST_DATABASE_URL: local, DATABASE_URL: "invalid" }).database, "caremind_test");
});

test("configuration errors do not echo credentials or connection strings", () => {
  const secret = "do-not-log-this";
  for (const value of [`postgresql://u:${secret}@bad-pooler.example/db`, `bad ${secret}`, `postgresql://u:${secret}@host/db?password=${secret}`]) {
    assert.throws(() => migrationConfig({ MIGRATION_DATABASE_URL: value }), (error) => !error.message.includes(secret));
  }
});

test("dedicated client ignores ambient host/database, password, options and insecure TLS settings", async () => {
  const overrides = { PGHOST: "production.example", PGDATABASE: "production", PGPASSWORD: "ambient-secret", PGOPTIONS: "-c search_path=other", PGSSLMODE: "no-verify", PGSSLNEGOTIATION: "invalid" };
  const previous = Object.fromEntries(Object.keys(overrides).map((key) => [key, process.env[key]]));
  let client;
  try {
    Object.assign(process.env, overrides);
    client = new Client(migrationConfig({ MIGRATION_DATABASE_URL: local }));
    assert.equal(client.host, "127.0.0.1");
    assert.equal(client.database, "caremind_test");
    assert.equal(await client.password(), "fake");
    assert.equal(client.connectionParameters.options, "-c search_path=public");
    assert.equal(client.connectionParameters.ssl, false);
    assert.equal(client.connectionParameters.sslnegotiation, "postgres");
  } finally {
    await client?.end();
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
