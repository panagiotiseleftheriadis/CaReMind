const assert = require("node:assert/strict");
const test = require("node:test");

const db = require("../db");
const initialSchema = require("../migrations/001_initial_schema");

test("PostgreSQL adapter translates placeholders without touching quoted question marks", () => {
  const sql = db._translateSql(
    "SELECT '?' AS marker, c.name AS companyName FROM companies c WHERE c.id = ? AND c.name = ?"
  );

  assert.equal(
    sql,
    `SELECT '?' AS marker, c.name AS "companyName" FROM companies c WHERE c.id = $1 AND c.name = $2`
  );
});

test("PostgreSQL adapter preserves the MySQL-compatible insertId contract", () => {
  assert.equal(
    db._translateSql("INSERT INTO companies (name) VALUES (?)"),
    "INSERT INTO companies (name) VALUES ($1) RETURNING id"
  );
  assert.equal(
    db._translateSql("INSERT INTO companies (name) VALUES (?) RETURNING id"),
    "INSERT INTO companies (name) VALUES ($1) RETURNING id"
  );
});

test("initial schema contains PostgreSQL and Neon-safe DDL only", async () => {
  const statements = [];
  await initialSchema.up({
    query: async (sql) => {
      statements.push(sql);
      return [[], []];
    },
  });

  const ddl = statements.join("\n");
  assert.match(ddl, /BIGSERIAL/);
  assert.match(ddl, /TIMESTAMPTZ/);
  assert.match(ddl, /caremind_set_updated_at/);
  assert.doesNotMatch(ddl, /AUTO_INCREMENT|ENGINE=|TINYINT|ON UPDATE CURRENT_TIMESTAMP/);
});
