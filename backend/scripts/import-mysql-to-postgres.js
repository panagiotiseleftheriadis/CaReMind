require("dotenv").config();

const mysql = require("mysql2/promise");
const db = require("../db");
const { migrate } = require("./migrate");

const tables = [
  "companies",
  "users",
  "vehicles",
  "maintenances",
  "costs",
  "interest_requests",
  "refresh_tokens",
  "email_verification_codes",
  "verification_codes",
  "password_reset_codes",
  "notification_recipients",
];

function sourceConfig() {
  return {
    host: process.env.MYSQL_SOURCE_HOST || process.env.DB_HOST,
    port: Number(process.env.MYSQL_SOURCE_PORT || process.env.DB_PORT || 3306),
    user: process.env.MYSQL_SOURCE_USER || process.env.DB_USER,
    password: process.env.MYSQL_SOURCE_PASS || process.env.DB_PASS,
    database: process.env.MYSQL_SOURCE_NAME || process.env.DB_NAME,
    charset: "utf8mb4",
  };
}

function identifier(value) {
  if (!/^[a-z_][a-z0-9_]*$/.test(value)) {
    throw new Error(`Unsafe SQL identifier: ${value}`);
  }
  return `"${value}"`;
}

async function ensureEmptyTarget(connection) {
  const populated = [];
  for (const table of tables) {
    const [rows] = await connection.query(
      `SELECT COUNT(*) AS count FROM ${identifier(table)}`
    );
    if (Number(rows[0].count) > 0) populated.push(table);
  }

  if (populated.length) {
    throw new Error(
      `Neon import stopped because target tables are not empty: ${populated.join(", ")}`
    );
  }
}

async function importTable(source, target, table) {
  const [rows] = await source.query(`SELECT * FROM \`${table}\` ORDER BY id ASC`);
  if (!rows.length) return 0;

  for (const row of rows) {
    const columns = Object.keys(row);
    const columnSql = columns.map(identifier).join(", ");
    const placeholders = columns.map(() => "?").join(", ");
    await target.query(
      `INSERT INTO ${identifier(table)} (${columnSql}) VALUES (${placeholders})`,
      columns.map((column) => row[column])
    );
  }

  await target.query(
    `SELECT setval(
      pg_get_serial_sequence('${table}', 'id'),
      COALESCE((SELECT MAX(id) FROM ${identifier(table)}), 1),
      EXISTS(SELECT 1 FROM ${identifier(table)})
    )`
  );

  return rows.length;
}

async function run() {
  if (!process.env.DATABASE_URL) {
    throw new Error("Set DATABASE_URL to the Neon pooled connection string first");
  }

  await migrate();
  const source = await mysql.createConnection(sourceConfig());
  const target = await db.getConnection();

  try {
    await ensureEmptyTarget(target);
    await target.beginTransaction();

    const imported = {};
    try {
      for (const table of tables) {
        imported[table] = await importTable(source, target, table);
      }
      await target.commit();
    } catch (error) {
      await target.rollback();
      throw error;
    }

    console.log("MySQL to Neon import completed:");
    for (const [table, count] of Object.entries(imported)) {
      console.log(`  ${table}: ${count}`);
    }
  } finally {
    target.release();
    await source.end();
  }
}

run()
  .catch((error) => {
    console.error("Database import failed:", error.message);
    process.exitCode = 1;
  })
  .finally(() => db.end());
