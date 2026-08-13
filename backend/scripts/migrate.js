require("dotenv").config();

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");

const migrationsDirectory = path.join(__dirname, "..", "migrations");

function databaseConfig(includeDatabase = true) {
  const database = process.env.DB_NAME || "caremind";
  return {
    host: process.env.DB_HOST || "localhost",
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASS || "",
    ...(includeDatabase ? { database } : {}),
    charset: "utf8mb4",
  };
}

async function ensureDatabase() {
  const database = process.env.DB_NAME || "caremind";
  if (!/^[a-zA-Z0-9_]+$/.test(database)) {
    throw new Error("DB_NAME may only contain letters, numbers and underscores");
  }

  const connection = await mysql.createConnection(databaseConfig(false));
  try {
    await connection.query(
      `CREATE DATABASE IF NOT EXISTS \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
    );
  } finally {
    await connection.end();
  }
}

async function migrate() {
  await ensureDatabase();
  const connection = await mysql.createConnection(databaseConfig(true));

  try {
    await connection.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        name VARCHAR(255) NOT NULL,
        checksum CHAR(64) NOT NULL,
        executed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uq_schema_migrations_name (name)
      ) ENGINE=InnoDB
    `);

    const files = fs
      .readdirSync(migrationsDirectory)
      .filter((file) => /^\d+.*\.js$/.test(file))
      .sort();

    for (const file of files) {
      const fullPath = path.join(migrationsDirectory, file);
      const checksum = crypto
        .createHash("sha256")
        .update(fs.readFileSync(fullPath))
        .digest("hex");
      const [rows] = await connection.query(
        "SELECT checksum FROM schema_migrations WHERE name = ? LIMIT 1",
        [file]
      );

      if (rows.length) {
        if (rows[0].checksum !== checksum) {
          throw new Error(`Applied migration was modified: ${file}`);
        }
        console.log(`skip ${file}`);
        continue;
      }

      const migration = require(fullPath);
      if (typeof migration.up !== "function") {
        throw new Error(`Migration ${file} does not export an up() function`);
      }

      console.log(`run  ${file}`);
      await migration.up(connection);
      await connection.query(
        "INSERT INTO schema_migrations (name, checksum) VALUES (?, ?)",
        [file, checksum]
      );
    }

    console.log("Database migrations are up to date.");
  } finally {
    await connection.end();
  }
}

migrate().catch((error) => {
  console.error("Migration failed:", error.message);
  process.exitCode = 1;
});
