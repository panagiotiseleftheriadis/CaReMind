const { migrate } = require("./migrate");

const SUPPORTED_ENVIRONMENTS = new Set(["preview", "production"]);

function vercelEnvironment(env = process.env) {
  const configured = ["VERCEL_ENV", "VERCEL_TARGET_ENV"]
    .map((name) => ({ name, value: String(env[name] || "").trim().toLowerCase() }))
    .filter(({ value }) => value);

  if (!configured.length) {
    throw new Error("VERCEL_ENV or VERCEL_TARGET_ENV must identify this build as preview or production");
  }

  for (const { name, value } of configured) {
    if (!SUPPORTED_ENVIRONMENTS.has(value)) {
      throw new Error(`${name} has unsupported Vercel environment: ${value}`);
    }
  }

  const environments = new Set(configured.map(({ value }) => value));
  if (environments.size !== 1) {
    throw new Error("VERCEL_ENV and VERCEL_TARGET_ENV disagree; refusing to select a migration target");
  }

  return configured[0].value;
}

async function runVercelBuild({ env = process.env, runMigrations = migrate, logger = console } = {}) {
  const environment = vercelEnvironment(env);
  if (environment === "preview") {
    logger.log("Vercel Preview build: database migrations were skipped.");
    return;
  }

  logger.log("Vercel Production build: running database migrations.");
  await runMigrations({ env, logger });
}

if (require.main === module) {
  runVercelBuild().catch((error) => {
    const message = String(error?.message || "");
    const safeMessage = /^(VERCEL_|MIGRATION_DATABASE_URL|Applied migration was modified:|Migration .* does not export)/.test(message)
      ? message
      : "Database operation failed; check direct connection configuration and migration SQL.";
    console.error("Vercel build failed:", safeMessage);
    process.exitCode = 1;
  });
}

module.exports = { runVercelBuild, vercelEnvironment };
