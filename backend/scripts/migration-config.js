// Deliberately does not load dotenv or import the runtime database pool.
function databaseConfig(value, label) {
  if (!value || !String(value).trim()) throw new Error(`${label} is required`);
  let url;
  try {
    url = new URL(String(value).trim());
  } catch {
    throw new Error(`${label} must be a valid PostgreSQL URL (credentials omitted)`);
  }
  const fail = (message) => { throw new Error(`${label}: ${message}`); };
  if (!["postgres:", "postgresql:"].includes(url.protocol)) fail("expected PostgreSQL protocol");
  // Do not forward connectionString to pg: query parameters could override the
  // validated host/database or replace our certificate-verifying SSL options.
  for (const key of url.searchParams.keys()) {
    if (!["sslmode", "channel_binding"].includes(key)) fail("unsupported URL parameter; use only sslmode/channel_binding");
    if (url.searchParams.getAll(key).length !== 1) fail("duplicate URL parameter");
  }
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const local = ["localhost", "127.0.0.1", "::1"].includes(host);
  if (!host || /(?:^|[-.])(pooler|pgbouncer)(?:[-.]|$)/i.test(host)) {
    fail("use a direct/non-pooled PostgreSQL endpoint, not a pooler");
  }
  let user, password, database;
  try {
    user = decodeURIComponent(url.username);
    password = decodeURIComponent(url.password);
    database = decodeURIComponent(url.pathname.slice(1));
  } catch {
    fail("invalid URL encoding");
  }
  if (!user || !database || database.includes("/") || url.hash) fail("explicit user and database are required; fragments are forbidden");
  const sslmode = url.searchParams.get("sslmode");
  if (sslmode && !["disable", "require", "verify-ca", "verify-full"].includes(sslmode)) fail("unsupported sslmode");
  if (!local && sslmode === "disable") fail("remote migration connections require verified TLS");
  const binding = url.searchParams.get("channel_binding");
  if (binding && binding !== "prefer") fail("only channel_binding=prefer is supported; pg enables but does not require channel binding");
  return {
    host, port: Number(url.port || 5432), user, password: () => password, database,
    ssl: !local || (sslmode && sslmode !== "disable") ? { rejectUnauthorized: true } : false,
    enableChannelBinding: Boolean(binding),
    // Prevent ambient PGOPTIONS/PGPASSWORD/PGSSLNEGOTIATION from changing intent.
    options: "-c search_path=public",
    sslnegotiation: "postgres",
    connectionTimeoutMillis: 10_000,
    statement_timeout: 60_000,
    query_timeout: 65_000,
    application_name: "caremind-migrations",
  };
}

function migrationConfig(env = process.env) {
  if (env.MIGRATION_DATABASE_URL) return databaseConfig(env.MIGRATION_DATABASE_URL, "MIGRATION_DATABASE_URL");
  if (env.NODE_ENV === "production" || env.CI || env.VERCEL) {
    throw new Error("MIGRATION_DATABASE_URL is required in production/CI; configure the direct/non-pooled URL");
  }
  const config = databaseConfig(env.DATABASE_URL, "MIGRATION_DATABASE_URL (or local DATABASE_URL)");
  if (!["localhost", "127.0.0.1", "::1"].includes(config.host)) {
    throw new Error("MIGRATION_DATABASE_URL is required for remote migrations; configure the direct/non-pooled URL");
  }
  return config;
}

function testDatabaseConfig(env = process.env) {
  const config = databaseConfig(env.TEST_DATABASE_URL, "TEST_DATABASE_URL");
  if (!["127.0.0.1", "::1"].includes(config.host) || !/^caremind_test(?:_[a-z0-9_]+)?$/.test(config.database)) {
    throw new Error("TEST_DATABASE_URL must use loopback IP 127.0.0.1/::1 and a disposable caremind_test or caremind_test_* database");
  }
  return { ...config, application_name: "caremind-postgres-tests", statement_timeout: 10_000, query_timeout: 15_000 };
}

module.exports = { migrationConfig, testDatabaseConfig };
