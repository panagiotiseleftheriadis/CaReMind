require("dotenv").config();

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const db = require("../db");

const migrationsDirectory = path.join(__dirname, "..", "migrations");

async function migrate() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required for PostgreSQL migrations");
  }

  const connection = await db.getConnection();

  try {
    // Prevent two serverless deployments from applying the same migration concurrently.
    await connection.query("SELECT pg_advisory_lock(hashtext('caremind_migrations'))");

    await connection.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id BIGSERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL UNIQUE,
        checksum CHAR(64) NOT NULL,
        executed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
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
      await connection.beginTransaction();
      try {
        await migration.up(connection);
        await connection.query(
          "INSERT INTO schema_migrations (name, checksum) VALUES (?, ?)",
          [file, checksum]
        );
        await connection.commit();
      } catch (error) {
        await connection.rollback();
        throw error;
      }
    }

    console.log("Database migrations are up to date.");
  } finally {
    await connection
      .query("SELECT pg_advisory_unlock(hashtext('caremind_migrations'))")
      .catch(() => {});
    connection.release();
  }
}

if (require.main === module) {
  migrate()
    .catch((error) => {
      console.error("Migration failed:", error.message);
      process.exitCode = 1;
    })
    .finally(() => db.end());
}

module.exports = { migrate };
