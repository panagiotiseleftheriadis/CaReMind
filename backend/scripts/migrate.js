const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { Client } = require("pg");
const { runQuery } = require("../postgres-query");
const { migrationConfig } = require("./migration-config");

const migrationsDirectory = path.join(__dirname, "..", "migrations");

function canonicalMigrationBytes(content) {
  const input = Buffer.isBuffer(content) ? content : Buffer.from(content);
  const output = Buffer.allocUnsafe(input.length);
  let written = 0;

  for (let index = 0; index < input.length; index++) {
    if (input[index] === 0x0d && input[index + 1] === 0x0a) index++;
    output[written++] = input[index];
  }

  return output.subarray(0, written);
}

function hashMigrationContent(content) {
  return crypto.createHash("sha256").update(canonicalMigrationBytes(content)).digest("hex");
}

async function migrate({ env = process.env, directory = migrationsDirectory, logger = console } = {}) {
  const client = new Client(migrationConfig(env));
  // Idle socket errors must flow through normal teardown instead of becoming
  // unhandled EventEmitter errors while a migration awaits non-query work.
  let sessionError;
  client.on("error", (error) => { sessionError = error; });
  const connection = {
    query: (sql, params) => runQuery(client, sql, params),
    beginTransaction: () => client.query("BEGIN"),
    commit: () => client.query("COMMIT"),
    rollback: () => client.query("ROLLBACK"),
  };
  let locked = false;

  try {
    await client.connect();
    // Prevent two serverless deployments from applying the same migration concurrently.
    await connection.query("SELECT pg_advisory_lock(hashtext('caremind_migrations'))");
    locked = true;

    await connection.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id BIGSERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL UNIQUE,
        checksum CHAR(64) NOT NULL,
        executed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    const files = fs
      .readdirSync(directory)
      .filter((file) => /^\d+.*\.js$/.test(file))
      .sort();

    for (const file of files) {
      const fullPath = path.resolve(directory, file);
      const checksum = hashMigrationContent(fs.readFileSync(fullPath));
      const [rows] = await connection.query(
        "SELECT checksum FROM schema_migrations WHERE name = ? LIMIT 1",
        [file]
      );

      if (rows.length) {
        if (rows[0].checksum !== checksum) {
          throw new Error(`Applied migration was modified: ${file}`);
        }
        logger.log(`skip ${file}`);
        continue;
      }

      const migration = require(fullPath);
      if (typeof migration.up !== "function") {
        throw new Error(`Migration ${file} does not export an up() function`);
      }

      logger.log(`run  ${file}`);
      await connection.beginTransaction();
      try {
        await migration.up(connection);
        if (sessionError) throw sessionError;
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

    logger.log("Database migrations are up to date.");
  } finally {
    try {
      if (locked) await client.query("SELECT pg_advisory_unlock(hashtext('caremind_migrations'))");
    } finally {
      // Closing the dedicated session also releases locks after any failure.
      await client.end();
    }
  }
}

if (require.main === module) {
  require("dotenv").config({ quiet: true });
  migrate()
    .catch((error) => {
      // Driver errors can contain endpoint/user details; keep CLI output sanitized.
      console.error("Migration failed:", /^(MIGRATION_DATABASE_URL|Applied migration was modified:|Migration .* does not export)/.test(error.message)
        ? error.message : "Database operation failed; check direct connection configuration and migration SQL.");
      process.exitCode = 1;
    });
}

module.exports = { migrate, canonicalMigrationBytes, hashMigrationContent };
