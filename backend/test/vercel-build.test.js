const assert = require("node:assert/strict");
const test = require("node:test");
const packageJson = require("../package.json");
const { runVercelBuild } = require("../scripts/vercel-build");

function logger() {
  const messages = [];
  return { messages, log(message) { messages.push(message); } };
}

test("Vercel Preview skips migrations and reports the skip", async () => {
  let migrationCalls = 0;
  const output = logger();
  await runVercelBuild({
    env: { VERCEL: "1", CI: "1", VERCEL_ENV: "preview", VERCEL_TARGET_ENV: "preview" },
    runMigrations: async () => { migrationCalls += 1; },
    logger: output,
  });

  assert.equal(packageJson.scripts["vercel-build"], "node scripts/vercel-build.js");
  assert.equal(migrationCalls, 0);
  assert.deepEqual(output.messages, ["Vercel Preview build: database migrations were skipped."]);
});

test("Vercel Production invokes the existing migration path", async () => {
  const env = { VERCEL: "1", CI: "1", VERCEL_ENV: "production", VERCEL_TARGET_ENV: "production" };
  let migrationCalls = 0;
  let received;
  await runVercelBuild({
    env,
    runMigrations: async (options) => { migrationCalls += 1; received = options; },
    logger: logger(),
  });

  assert.equal(migrationCalls, 1);
  assert.equal(received.env, env);
});

test("Vercel Production migration failures propagate", async () => {
  const failure = new Error("migration failed");
  await assert.rejects(
    runVercelBuild({
      env: { VERCEL_ENV: "production" },
      runMigrations: async () => { throw failure; },
      logger: logger(),
    }),
    (error) => error === failure
  );
});

test("unknown, missing, or conflicting Vercel environments fail safely", async () => {
  for (const env of [
    {},
    { VERCEL_ENV: "development" },
    { VERCEL_TARGET_ENV: "staging" },
    { VERCEL_ENV: "preview", VERCEL_TARGET_ENV: "production" },
  ]) {
    let migrationCalls = 0;
    await assert.rejects(
      runVercelBuild({ env, runMigrations: async () => { migrationCalls += 1; }, logger: logger() }),
      /must identify|unsupported Vercel environment|disagree/
    );
    assert.equal(migrationCalls, 0);
  }
});
