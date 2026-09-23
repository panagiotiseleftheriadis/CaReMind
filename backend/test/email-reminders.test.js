const assert = require("node:assert/strict");
const { afterEach, beforeEach, test } = require("node:test");
const express = require("express");

process.env.NODE_ENV = "test";
process.env.RESEND_API_KEY = "test-only-resend-key";
process.env.CRON_SECRET = "test-only-cron-secret";
process.env.JWT_SECRET = "test-only-email-reminder-secret-with-32-characters";

const db = require("../db");
const sendMail = require("../emailService");
const cronRouter = require("../routes/cron");
const authRouter = require("../routes/auth");
const accountRouter = require("../routes/account");
const { NOTIFICATION_QUERY_SQL } = require("../routes/notifications");

const originalQuery = db.query;
const originalGetConnection = db.getConnection;

function setEmailSender(sender) {
  sendMail.setResendClientForTests({ emails: { send: sender } });
}

async function startCronServer() {
  const app = express();
  app.use("/api/cron", cronRouter);
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });
  return {
    server,
    async request(secret = process.env.CRON_SECRET) {
      const headers = secret === null ? {} : { "X-Cron-Secret": secret };
      const response = await fetch(
        `http://127.0.0.1:${server.address().port}/api/cron/maintenance`,
        { headers }
      );
      return { status: response.status, body: await response.json() };
    },
  };
}

async function startRouterServer(path, router, middleware = []) {
  const app = express();
  app.use(express.json());
  app.use(path, ...middleware, router);
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });
  return {
    server,
    async post(endpoint, body) {
      const response = await fetch(`http://127.0.0.1:${server.address().port}${path}${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      return { status: response.status, body: await response.json() };
    },
  };
}

afterEach(() => {
  db.query = originalQuery;
  db.getConnection = originalGetConnection;
});

beforeEach(() => {
  process.env.CRON_SECRET = "test-only-cron-secret";
});

test("email service treats Resend data with no error as submitted", async () => {
  setEmailSender(async () => ({ data: { id: "provider-message-1" }, error: null }));
  assert.deepEqual(await sendMail("person@example.test", "Subject", "<p>Body</p>"), {
    status: "submitted",
    providerMessageId: "provider-message-1",
  });
});

test("email service turns a returned Resend error into a structured failure", async () => {
  setEmailSender(async () => ({
    data: null,
    error: {
      name: "validation_error",
      message: "Invalid recipient private@example.test using re_secret-material-123456",
    },
  }));

  await assert.rejects(
    sendMail("person@example.test", "Subject", "<p>Body</p>"),
    (error) => {
      assert.equal(error.code, "EMAIL_PROVIDER_REJECTED");
      assert.equal(error.providerCategory, "validation_error");
      assert.match(error.providerMessage, /\[redacted-email\]/);
      assert.match(error.providerMessage, /\[redacted-secret\]/);
      assert.doesNotMatch(JSON.stringify(error), /private@example|secret-material/);
      return true;
    }
  );
});

test("email service wraps thrown network failures without claiming submission", async () => {
  setEmailSender(async () => {
    const error = new Error("socket unavailable");
    error.code = "ECONNRESET";
    throw error;
  });

  await assert.rejects(
    sendMail("person@example.test", "Subject", "<p>Body</p>"),
    (error) => {
      assert.equal(error.code, "EMAIL_PROVIDER_UNAVAILABLE");
      assert.equal(error.providerCategory, "Error");
      assert.equal(error.providerMessage, "socket unavailable");
      return true;
    }
  );
});

test("forgot-password removes an undelivered code and keeps responses enumeration-neutral", async (t) => {
  let deletedCodeId = null;
  db.query = async (sql, params) => {
    if (String(sql).startsWith("SELECT id, username")) {
      return [params[0] === "existing@example.test" ? [{ id: 7, username: "user" }] : []];
    }
    if (String(sql).includes("INSERT INTO password_reset_codes")) return [{ insertId: 91 }];
    if (String(sql).includes("DELETE FROM password_reset_codes")) {
      deletedCodeId = params[0];
      return [{ affectedRows: 1 }];
    }
    throw new Error("Unexpected query");
  };
  setEmailSender(async () => ({
    data: null,
    error: { name: "provider_unavailable", message: "Temporary failure" },
  }));
  const auth = await startRouterServer("/api", authRouter);
  t.after(() => new Promise((resolve) => auth.server.close(resolve)));

  const existing = await auth.post("/forgot-password", { email: "existing@example.test" });
  const missing = await auth.post("/forgot-password", { email: "missing@example.test" });

  assert.equal(deletedCodeId, 91);
  assert.equal(existing.status, 200);
  assert.deepEqual(existing, missing);
  assert.equal(existing.body.message, "If the email exists, the request was processed.");
});

test("resend-verification removes an undelivered code without exposing account existence", async (t) => {
  let deletedCodeId = null;
  db.query = async (sql, params) => {
    if (String(sql).startsWith("SELECT id, username, email")) {
      return [params[0] === "existing@example.test"
        ? [{ id: 7, username: "user", email: params[0], email_verified: 0 }]
        : []];
    }
    if (String(sql).includes("INSERT INTO email_verification_codes")) return [{ insertId: 92 }];
    if (String(sql).includes("DELETE FROM email_verification_codes")) {
      deletedCodeId = params[0];
      return [{ affectedRows: 1 }];
    }
    throw new Error("Unexpected query");
  };
  setEmailSender(async () => {
    throw new Error("network unavailable");
  });
  const auth = await startRouterServer("/api", authRouter);
  t.after(() => new Promise((resolve) => auth.server.close(resolve)));

  const existing = await auth.post("/resend-verification", { email: "existing@example.test" });
  const missing = await auth.post("/resend-verification", { email: "missing@example.test" });

  assert.equal(deletedCodeId, 92);
  assert.equal(existing.status, 200);
  assert.deepEqual(existing, missing);
  assert.equal(existing.body.message, "Αν το email είναι επιλέξιμο, το αίτημα επεξεργάστηκε.");
});

test("registration reports a committed account honestly when verification submission fails", async (t) => {
  let committed = false;
  let rolledBack = false;
  let deletedCodeId = null;
  db.query = async (sql, params) => {
    if (String(sql).includes("SELECT id, username, email FROM users")) return [[]];
    if (String(sql).includes("INSERT INTO email_verification_codes")) return [{ insertId: 94 }];
    if (String(sql).includes("DELETE FROM email_verification_codes")) {
      deletedCodeId = params[0];
      return [{ affectedRows: 1 }];
    }
    throw new Error("Unexpected query");
  };
  db.getConnection = async () => ({
    async beginTransaction() {},
    async query(sql) {
      assert.match(String(sql), /INSERT INTO users/);
      return [{ insertId: 44 }];
    },
    async commit() { committed = true; },
    async rollback() { rolledBack = true; },
    release() {},
  });
  setEmailSender(async () => ({
    data: null,
    error: { name: "provider_unavailable", message: "Temporary failure" },
  }));
  const auth = await startRouterServer("/api", authRouter);
  t.after(() => new Promise((resolve) => auth.server.close(resolve)));

  const result = await auth.post("/register", {
    username: "new-user",
    email: "new-user@example.test",
    password: "valid-password-123",
  });

  assert.equal(result.status, 503);
  assert.equal(result.body.code, "VERIFICATION_EMAIL_UNAVAILABLE");
  assert.equal(result.body.email, "new-user@example.test");
  assert.equal(committed, true);
  assert.equal(rolledBack, false);
  assert.equal(deletedCodeId, 94);
});

test("account-change email failure removes the code and returns an honest temporary failure", async (t) => {
  let deletedCodeId = null;
  db.query = async (sql, params) => {
    if (String(sql).includes("SELECT username, email")) {
      return [[{ username: "<user>", email: "owner@example.test" }]];
    }
    if (String(sql).includes("INSERT INTO verification_codes")) return [{ insertId: 93 }];
    if (String(sql).includes("DELETE FROM verification_codes")) {
      deletedCodeId = params[0];
      return [{ affectedRows: 1 }];
    }
    throw new Error("Unexpected query");
  };
  setEmailSender(async () => ({
    data: null,
    error: { name: "rate_limit", message: "Try later" },
  }));
  const account = await startRouterServer(
    "/api/account",
    accountRouter,
    [(req, _res, next) => { req.user = { id: 7 }; next(); }]
  );
  t.after(() => new Promise((resolve) => account.server.close(resolve)));

  const result = await account.post("/send-code", {});

  assert.equal(result.status, 503);
  assert.equal(result.body.code, "VERIFICATION_EMAIL_UNAVAILABLE");
  assert.equal(deletedCodeId, 93);
  assert.doesNotMatch(JSON.stringify(result.body), /owner@example|rate_limit|Try later/);
});

test("cron rejects a missing or incorrect secret before querying", async (t) => {
  db.query = async () => assert.fail("Rejected cron requests must not query the database");
  const cron = await startCronServer();
  t.after(() => new Promise((resolve) => cron.server.close(resolve)));

  assert.equal((await cron.request(null)).status, 401);
  assert.equal((await cron.request("incorrect-secret")).status, 401);
});

test("cron selects only active, noncompleted, dated reminders and preserves zero-day offsets", async (t) => {
  let candidateSql = "";
  const submittedTo = [];
  const fixtures = [
    { maintenance_id: 1, user_id: 1, status: "active", is_active: 1, notification_days: 7 },
    { maintenance_id: 2, user_id: 1, status: "active", is_active: 1, notification_days: 0 },
    { maintenance_id: 3, user_id: 2, status: "active", is_active: 0, notification_days: 7 },
    { maintenance_id: 4, user_id: 1, status: "completed", is_active: 1, notification_days: 7 },
  ].map((row) => ({
    ...row,
    vehicle_id: row.maintenance_id,
    maintenance_type: "service",
    next_date: "2026-09-22",
    email: "Primary@Example.test",
    model: "Model",
    chassis_number: `VIN-${row.maintenance_id}`,
  }));

  db.query = async (sql) => {
    const normalized = String(sql).replace(/\s+/g, " ");
    if (normalized.includes("FROM maintenances")) {
      candidateSql = normalized;
      const hasActiveFilter = normalized.includes("u.is_active = 1");
      const hasCompletedFilter = normalized.includes("m.status <> 'completed'");
      return [fixtures.filter((row) =>
        (!hasActiveFilter || row.is_active === 1) &&
        (!hasCompletedFilter || row.status !== "completed"))];
    }
    assert.match(normalized, /type = 'email' AND is_active = 1/);
    return [[
      { value: "primary@example.test" },
      { value: "Extra@Example.test" },
    ]];
  };
  setEmailSender(async ({ to }) => {
    submittedTo.push(to);
    return { data: { id: `id-${submittedTo.length}` }, error: null };
  });

  const cron = await startCronServer();
  t.after(() => new Promise((resolve) => cron.server.close(resolve)));
  const result = await cron.request();

  assert.equal(result.status, 200);
  assert.match(candidateSql, /v.id = m.vehicle_id AND v.user_id = m.user_id/);
  assert.match(candidateSql, /u.is_active = 1/);
  assert.match(candidateSql, /v.archived_at IS NULL/);
  assert.match(candidateSql, /m.status <> 'completed'/);
  assert.match(candidateSql, /m.next_date IS NOT NULL/);
  assert.match(candidateSql, /m.notification_days IS NOT NULL/);
  assert.match(candidateSql, /= CURRENT_DATE/);
  assert.deepEqual(result.body, {
    ok: true,
    candidateReminders: 2,
    recipientsAttempted: 4,
    submitted: 4,
    failed: 0,
    skippedNoRecipients: 0,
    recipientLookupFailures: 0,
  });
  assert.deepEqual(submittedTo.sort(), [
    "extra@example.test",
    "extra@example.test",
    "primary@example.test",
    "primary@example.test",
  ]);
});

test("authenticated notification projection excludes archived vehicles", () => {
  assert.match(NOTIFICATION_QUERY_SQL, /v\.id = m\.vehicle_id AND v\.user_id = m\.user_id/);
  assert.match(NOTIFICATION_QUERY_SQL, /v\.archived_at IS NULL/);
  assert.match(NOTIFICATION_QUERY_SQL, /m\.status <> 'completed'/);
});

test("cron uses bounded concurrency for an arbitrary recipient batch", async (t) => {
  const extras = Array.from({ length: 11 }, (_, index) => ({
    value: `extra-${index}@example.test`,
  }));
  let active = 0;
  let maximumActive = 0;
  db.query = async (sql) => {
    if (String(sql).includes("FROM maintenances")) {
      return [[{
        maintenance_id: 1,
        user_id: 1,
        vehicle_id: 1,
        maintenance_type: "service",
        next_date: "2026-09-22",
        notification_days: 0,
        email: "primary@example.test",
        model: "Model",
        chassis_number: "VIN",
      }]];
    }
    return [extras];
  };
  setEmailSender(async () => {
    active++;
    maximumActive = Math.max(maximumActive, active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active--;
    return { data: { id: "accepted" }, error: null };
  });

  const cron = await startCronServer();
  t.after(() => new Promise((resolve) => cron.server.close(resolve)));
  const result = await cron.request();

  assert.equal(result.body.recipientsAttempted, 12);
  assert.equal(result.body.submitted, 12);
  assert.ok(maximumActive > 1);
  assert.ok(maximumActive <= cronRouter.EMAIL_CONCURRENCY);
});

test("one reminder recipient failure is counted without aborting other recipients", async (t) => {
  const attempts = [];
  db.query = async (sql) => {
    if (String(sql).includes("FROM maintenances")) {
      return [[{
        maintenance_id: 1,
        user_id: 1,
        vehicle_id: 1,
        maintenance_type: "service",
        next_date: "2026-09-22",
        notification_days: 0,
        email: "primary@example.test",
        model: "Model",
        chassis_number: "VIN",
      }]];
    }
    return [[{ value: "extra@example.test" }]];
  };
  setEmailSender(async ({ to }) => {
    attempts.push(to);
    return to === "primary@example.test"
      ? { data: null, error: { name: "rate_limit", message: "Try later" } }
      : { data: { id: "accepted" }, error: null };
  });

  const cron = await startCronServer();
  t.after(() => new Promise((resolve) => cron.server.close(resolve)));
  const result = await cron.request();

  assert.equal(result.status, 200);
  assert.equal(result.body.ok, false);
  assert.equal(result.body.recipientsAttempted, 2);
  assert.equal(result.body.submitted, 1);
  assert.equal(result.body.failed, 1);
  assert.deepEqual(attempts.sort(), ["extra@example.test", "primary@example.test"]);
});
