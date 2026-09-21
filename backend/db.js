const { Pool, types } = require("pg");
const { runQuery, translateSql, getConnection } = require("./postgres-query");

// Keep DATE columns as YYYY-MM-DD strings, matching the existing frontend/API contract.
types.setTypeParser(1082, (value) => value);
// Application IDs fit safely in JavaScript numbers and were numbers in the MySQL API.
types.setTypeParser(20, (value) => {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : value;
});

const connectionString = String(process.env.DATABASE_URL || "").trim();
if (process.env.NODE_ENV === "production" && !connectionString) {
  throw new Error("DATABASE_URL is required in production");
}

const useSsl =
  process.env.DB_SSL === "true" ||
  /(?:neon\.tech|sslmode=require)/i.test(connectionString);

const pool = new Pool({
  ...(connectionString ? { connectionString } : {}),
  ...(useSsl ? { ssl: { rejectUnauthorized: false } } : {}),
  max: Number(process.env.DB_POOL_MAX || 5),
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
  allowExitOnIdle: true,
});

module.exports = {
  query: (sql, params) => runQuery(pool, sql, params),
  getConnection: () => getConnection(pool),
  end: () => pool.end(),
  _translateSql: translateSql,
};
