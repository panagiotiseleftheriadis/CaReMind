const assert = require("node:assert/strict");
const { after, before, beforeEach, test } = require("node:test");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "test-only-secret-with-at-least-thirty-two-characters";
process.env.CORS_ORIGINS = "http://localhost:4173";

const db = require("../db");
const app = require("../server");

const activeUser = {
  id: 1,
  username: "owner",
  email: "owner@example.com",
  role: "user",
  is_active: 1,
  email_verified: 1,
  company_id: null,
};

let server;
let baseUrl;
let queryHandler;

function tokenFor(user = activeUser, options = { expiresIn: "15m" }) {
  return jwt.sign(
    { id: user.id, username: user.username, role: user.role, purpose: "access" },
    process.env.JWT_SECRET,
    options
  );
}

async function request(path, { method = "GET", token, body, cookie } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (cookie) headers.Cookie = cookie;
  if (body !== undefined) headers["Content-Type"] = "application/json";

  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return {
    response,
    body: text ? JSON.parse(text) : null,
  };
}

function authenticatedHandler(resourceHandler, user = activeUser) {
  return async (sql, params = []) => {
    if (String(sql).includes("SELECT id, username, email, role, is_active")) {
      return [[user], []];
    }
    return resourceHandler(sql, params);
  };
}

before(async () => {
  db.query = (...args) => queryHandler(...args);
  db.getConnection = async () => ({
    query: (...args) => queryHandler(...args),
    beginTransaction: async () => {}, commit: async () => {},
    rollback: async () => {}, release() {},
  });
  await new Promise((resolve) => {
    server = app.listen(0, "127.0.0.1", () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
});

beforeEach(() => {
  app.locals.rateLimitStore.clear();
  queryHandler = async () => {
    throw new Error("Unexpected database query");
  };
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await db.end();
});

test("health, security headers and JSON 404 are available", async () => {
  const health = await request("/");
  assert.equal(health.response.status, 200);
  assert.equal(health.body.service, "CaReMind API");
  assert.equal(health.response.headers.get("x-content-type-options"), "nosniff");

  const missing = await request("/api/not-a-route");
  assert.equal(missing.response.status, 404);
  assert.equal(missing.body.error, "Route not found");
});

test("protected routes reject missing and expired access tokens", async () => {
  const missing = await request("/api/vehicles");
  assert.equal(missing.response.status, 401);

  const expired = tokenFor(activeUser, { expiresIn: -1 });
  const expiredResponse = await request("/api/vehicles", { token: expired });
  assert.equal(expiredResponse.response.status, 401);
});

test("inactive users are denied after token validation", async () => {
  queryHandler = async () => [[{ ...activeUser, is_active: 0 }], []];
  const result = await request("/api/vehicles", { token: tokenFor() });
  assert.equal(result.response.status, 403);
  assert.equal(result.body.error, "User inactive");
});

function scopedToken(purpose, options = {}, claims = {}) {
  return jwt.sign(
    { id: activeUser.id, userId: activeUser.id, role: "owner", resetCodeId: 21, verificationId: 31, purpose, ...claims },
    process.env.JWT_SECRET,
    { algorithm: "HS256", expiresIn: "15m", ...options }
  );
}

test("protected routes reject every non-access purpose before querying the database", async () => {
  let queries = 0;
  queryHandler = async () => { queries++; return [[activeUser], []]; };
  for (const purpose of ["password_reset", "account_change", "email_verification", "unknown", undefined]) {
    for (const path of ["/api/vehicles", "/api/maintenances", "/api/costs", "/api/notifications", "/api/account/me", "/api/users"]) {
      const result = await request(path, { token: scopedToken(purpose) });
      assert.equal(result.response.status, 401, `${path}: ${purpose || "missing purpose"}`);
    }
  }
  assert.equal(queries, 0);
});

test("bearer authentication rejects malformed, forged, unsigned and wrong-algorithm tokens", async () => {
  const tokens = [
    "not-a-jwt",
    jwt.sign({ id: 1, purpose: "access" }, "different-test-secret"),
    scopedToken("access", { algorithm: "HS384" }),
    scopedToken("access", { algorithm: "HS512" }),
    jwt.sign({ id: 1, purpose: "access" }, null, { algorithm: "none" }),
    scopedToken("access", {}, { id: undefined }),
  ];
  for (const token of tokens) {
    assert.equal((await request("/api/vehicles", { token })).response.status, 401);
  }
});

test("password reset rejects access, account-change, missing-purpose and wrong-algorithm JWTs", async () => {
  for (const resetToken of [
    scopedToken("access"), scopedToken("account_change"), scopedToken(undefined),
    scopedToken("password_reset", { algorithm: "HS384" }),
  ]) {
    const result = await request("/api/reset-password", {
      method: "POST", body: { resetToken, newPassword: "new-password-123" },
    });
    assert.equal(result.response.status, 401);
  }
});

test("account update rejects unrelated purposes and wrong algorithms with a valid access session", async () => {
  queryHandler = authenticatedHandler(async () => {
    throw new Error("Rejected account tokens must not reach account queries");
  });
  for (const accountToken of [
    scopedToken("access"), scopedToken("password_reset"), scopedToken(undefined),
    scopedToken("account_change_email"), scopedToken("account_change_password"),
    scopedToken("account_change", { algorithm: "HS512" }),
    scopedToken("account_change", { expiresIn: -1 }),
    "not-a-jwt",
  ]) {
    const result = await request("/api/account/update", {
      method: "POST", token: tokenFor(), body: { accountToken, updates: { username: "updated-user" } },
    });
    assert.equal(result.response.status, 401);
  }
  const otherUser = await request("/api/account/update", {
    method: "POST", token: tokenFor(),
    body: { accountToken: scopedToken("account_change", {}, { userId: 2 }), updates: { username: "updated-user" } },
  });
  assert.equal(otherUser.response.status, 403);
});

test("issued password-reset JWT works only in its intended flow", async () => {
  queryHandler = async (sql) => {
    if (String(sql).includes("SELECT id FROM users")) return [[{ id: 1 }], []];
    if (String(sql).includes("SELECT id FROM password_reset_codes")) return [[{ id: 21 }], []];
    throw new Error("Unexpected reset-code query");
  };
  const issued = await request("/api/verify-reset-code", {
    method: "POST", body: { email: activeUser.email, code: "123456" },
  });
  assert.equal(issued.response.status, 200);
  const resetToken = issued.body.resetToken;
  assert.equal(jwt.verify(resetToken, process.env.JWT_SECRET, { algorithms: ["HS256"] }).purpose, "password_reset");
  assert.equal((await request("/api/vehicles", { token: resetToken })).response.status, 401);
  let passwordWritten = false;
  let codeConsumed = false;
  let sessionsRevoked = false;
  queryHandler = async (sql, params) => {
    if (String(sql).includes("SELECT id FROM users WHERE id")) return [[{ id: 1 }], []];
    if (String(sql).includes("SELECT id FROM password_reset_codes")) {
      assert.deepEqual(params, [21, 1]);
      return [[{ id: 21 }], []];
    }
    if (String(sql).includes("UPDATE users SET password")) {
      assert.equal(params[1], 1);
      assert.equal(await bcrypt.compare("new-password-123", params[0]), true);
      passwordWritten = true;
    } else if (String(sql).includes("UPDATE password_reset_codes")) {
      assert.deepEqual(params, [21]);
      codeConsumed = true;
    } else if (String(sql).includes("UPDATE refresh_tokens")) {
      assert.deepEqual(params, [1]);
      sessionsRevoked = true;
    } else throw new Error("Unexpected reset query");
    return [{ affectedRows: 1 }, []];
  };
  const reset = await request("/api/reset-password", {
    method: "POST", body: { resetToken, newPassword: "new-password-123" },
  });
  assert.equal(reset.response.status, 200);
  assert.ok(passwordWritten && codeConsumed && sessionsRevoked);
});

test("issued account-change JWT requires access authentication and matching verification record", async () => {
  queryHandler = authenticatedHandler(async (sql, params) => {
    assert.match(String(sql), /purpose = 'account_change'/);
    assert.equal(params[0], 1);
    return [[{ id: 31 }], []];
  });
  const issued = await request("/api/account/verify-code", {
    method: "POST", token: tokenFor(), body: { code: "123456" },
  });
  assert.equal(issued.response.status, 200);
  const accountToken = issued.body.accountToken;
  assert.equal(jwt.verify(accountToken, process.env.JWT_SECRET, { algorithms: ["HS256"] }).purpose, "account_change");
  assert.equal((await request("/api/account/me", { token: accountToken })).response.status, 401);
  assert.equal((await request("/api/account/update", {
    method: "POST", token: accountToken, body: { accountToken, updates: { username: "updated-user" } },
  })).response.status, 401);
  let updated = false;
  let consumed = false;
  queryHandler = authenticatedHandler(async (sql, params) => {
    if (String(sql).includes("SELECT id, is_active FROM users")) return [[activeUser], []];
    if (String(sql).includes("FROM verification_codes")) {
      assert.deepEqual(params, [31, 1]);
      return [[{ id: 31 }], []];
    }
    if (String(sql).includes("SELECT id FROM users")) return [[], []];
    if (String(sql).includes("UPDATE users")) {
      assert.deepEqual(params, ["updated-user", 1]);
      updated = true;
    } else if (String(sql).includes("UPDATE verification_codes")) {
      assert.deepEqual(params, [31]);
      consumed = true;
    } else throw new Error("Unexpected account update query");
    return [{ affectedRows: 1 }, []];
  });
  const result = await request("/api/account/update", {
    method: "POST", token: tokenFor(), body: { accountToken, updates: { username: "updated-user" } },
  });
  assert.equal(result.response.status, 200);
  assert.ok(updated && consumed);
});

test("admin user directory rejects normal users and accepts administrators", async () => {
  queryHandler = authenticatedHandler(async () => {
    throw new Error("A normal user must not reach the admin query");
  });
  const denied = await request("/api/users", { token: tokenFor() });
  assert.equal(denied.response.status, 403);
  assert.equal(denied.body.code, "ADMIN_REQUIRED");

  const admin = { ...activeUser, id: 9, username: "admin", role: "admin" };
  queryHandler = authenticatedHandler(async (sql, params) => {
    assert.match(String(sql), /FROM users u/);
    assert.deepEqual(params, [admin.id, admin.id]);
    return [[{
      id: admin.id,
      username: admin.username,
      role: "admin",
      is_active: 1,
      email_verified: 1,
      vehicle_count: 3,
      maintenance_count: 4,
      cost_count: 5,
      is_self: 1,
    }], []];
  }, admin);

  const allowed = await request("/api/users", { token: tokenFor(admin) });
  assert.equal(allowed.response.status, 200);
  assert.equal(allowed.body.length, 1);
  assert.equal(allowed.body[0].is_self, 1);
  assert.equal(allowed.body[0].vehicle_count, 3);
});

test("only the owner can promote or demote administrators", async () => {
  const admin = { ...activeUser, id: 9, username: "admin", role: "admin" };
  queryHandler = authenticatedHandler(async () => {
    throw new Error("An admin must not reach owner-only role updates");
  }, admin);
  const denied = await request("/api/users/5/role", {
    method: "PATCH",
    token: tokenFor(admin),
    body: { role: "admin" },
  });
  assert.equal(denied.response.status, 403);
  assert.equal(denied.body.code, "OWNER_REQUIRED");

  const owner = { ...activeUser, id: 10, username: "panos", role: "owner" };
  queryHandler = authenticatedHandler(async (sql, params) => {
    const normalized = String(sql);
    if (normalized.includes("SELECT id, username, role FROM users")) {
      assert.equal(params[0], 5);
      return [[{ id: 5, username: "new-admin", role: "user" }], []];
    }
    if (normalized.includes("UPDATE users SET role = ?")) {
      assert.deepEqual(params, ["admin", 5]);
      return [{ affectedRows: 1 }, []];
    }
    throw new Error(`Unexpected owner role query: ${sql}`);
  }, owner);

  const promoted = await request("/api/users/5/role", {
    method: "PATCH",
    token: tokenFor(owner),
    body: { role: "admin" },
  });
  assert.equal(promoted.response.status, 200);
  assert.equal(promoted.body.role, "admin");
});

test("login issues an access token and httpOnly refresh cookie", async () => {
  const passwordHash = await bcrypt.hash("correct-password", 4);
  queryHandler = async (sql) => {
    if (String(sql).includes("SELECT * FROM users WHERE id")) {
      return [[{ ...activeUser, password: passwordHash }], []];
    }
    if (String(sql).includes("FROM users") && String(sql).includes("users.username")) {
      return [[{ ...activeUser, password: passwordHash, companyName: null }], []];
    }
    if (String(sql).includes("INSERT INTO refresh_tokens")) return [{ insertId: 10 }, []];
    throw new Error(`Unexpected login query: ${sql}`);
  };

  const result = await request("/api/login", {
    method: "POST",
    body: { username: "owner", password: "correct-password" },
  });

  assert.equal(result.response.status, 200);
  assert.ok(result.body.accessToken);
  assert.equal(jwt.verify(result.body.accessToken, process.env.JWT_SECRET, { algorithms: ["HS256"] }).purpose, "access");
  const cookie = result.response.headers.get("set-cookie");
  assert.match(cookie, /refreshToken=/);
  assert.match(cookie, /HttpOnly/i);
});

test("invalid credentials do not reveal whether an account exists", async () => {
  queryHandler = async () => [[], []];
  const result = await request("/api/login", {
    method: "POST",
    body: { username: "missing", password: "wrong-password" },
  });
  assert.equal(result.response.status, 401);
  assert.equal(result.body.code, "INVALID_CREDENTIALS");
});

test("refresh accepts an active session and logout revokes the matching refresh token", async () => {
  queryHandler = async (sql, params) => {
    const normalized = String(sql);
    if (normalized.includes("FROM refresh_tokens rt")) {
      return [[{
        user_id: 1,
        username: "owner",
        role: "user",
        company_id: null,
        companyName: null,
        is_active: 1,
        revoked_at: null,
        expires_at: new Date(Date.now() + 60_000),
      }], []];
    }
    if (normalized.includes("SELECT id, username, email, role, is_active")) {
      return [[activeUser], []];
    }
    if (normalized.includes("UPDATE refresh_tokens")) {
      assert.equal(params.length, 1);
      return [{ affectedRows: 1 }, []];
    }
    throw new Error(`Unexpected session query: ${sql}`);
  };

  const refresh = await request("/api/refresh", {
    method: "POST",
    cookie: "refreshToken=test-refresh-token",
  });
  assert.equal(refresh.response.status, 200);
  assert.ok(refresh.body.accessToken);
  assert.equal(jwt.verify(refresh.body.accessToken, process.env.JWT_SECRET, { algorithms: ["HS256"] }).purpose, "access");
  queryHandler = authenticatedHandler(async () => [[], []]);
  assert.equal((await request("/api/vehicles", { token: refresh.body.accessToken })).response.status, 200);
  queryHandler = async (sql, params) => {
    assert.match(String(sql), /UPDATE refresh_tokens/);
    assert.equal(params.length, 1);
    return [{ affectedRows: 1 }, []];
  };

  const logout = await request("/api/logout", {
    method: "POST",
    cookie: "refreshToken=test-refresh-token",
  });
  assert.equal(logout.response.status, 200);
});

test("register, verification and reset endpoints validate unsafe requests", async () => {
  const registration = await request("/api/register", {
    method: "POST",
    body: { username: "x", email: "invalid", password: "short" },
  });
  assert.equal(registration.response.status, 400);

  queryHandler = async () => [[], []];
  const verification = await request("/api/verify-email", {
    method: "POST",
    body: { email: "missing@example.com", code: "123456" },
  });
  assert.equal(verification.response.status, 404);

  const reset = await request("/api/reset-password", {
    method: "POST",
    body: { resetToken: "invalid-token", newPassword: "new-password-123" },
  });
  assert.equal(reset.response.status, 401);
});

test("vehicle CRUD remains scoped to the authenticated user", async () => {
  queryHandler = authenticatedHandler(async (sql, params) => {
    const normalized = String(sql);
    if (normalized.includes("FROM vehicles v") && normalized.includes("ORDER BY")) {
      assert.equal(params[0], 1);
      return [[{ id: 7, chassisNumber: "VIN-7" }], []];
    }
    if (normalized.includes("user_id = ? AND chassis_number = ?")) return [[], []];
    if (normalized.includes("INSERT INTO vehicles")) {
      assert.equal(params[0], 1);
      return [{ insertId: 8 }, []];
    }
    if (normalized.includes("FROM vehicles v") && normalized.includes("WHERE v.id = ?")) {
      return [[{ id: Number(params[0]), chassisNumber: "VIN-8", vehicleType: "car" }], []];
    }
    if (normalized.includes("SELECT id FROM vehicles WHERE id = ? AND user_id = ?")) {
      assert.equal(params[1], 1);
      return [[{ id: Number(params[0]) }], []];
    }
    if (normalized.includes("id <> ?")) return [[], []];
    if (normalized.includes("UPDATE vehicles")) return [{ affectedRows: 1 }, []];
    if (normalized.includes("DELETE FROM vehicles")) {
      assert.equal(params[1], 1);
      return [{ affectedRows: 1 }, []];
    }
    throw new Error(`Unexpected vehicle query: ${sql}`);
  });

  assert.equal((await request("/api/vehicles", { token: tokenFor() })).response.status, 200);

  const payload = {
    vehicleType: "car",
    chassisNumber: "VIN-8",
    model: "Demo",
    year: 2024,
    currentMileage: 12000,
  };
  assert.equal((await request("/api/vehicles", { method: "POST", token: tokenFor(), body: payload })).response.status, 201);
  assert.equal((await request("/api/vehicles/8", { method: "PUT", token: tokenFor(), body: payload })).response.status, 200);
  assert.equal((await request("/api/vehicles/8", { method: "DELETE", token: tokenFor() })).response.status, 200);
});

test("cost CRUD verifies vehicle ownership and user scope", async () => {
  queryHandler = authenticatedHandler(async (sql, params) => {
    const normalized = String(sql);
    if (normalized.includes("SELECT id FROM vehicles")) {
      assert.equal(params[1], 1);
      return [[{ id: 8 }], []];
    }
    if (normalized.includes("INSERT INTO costs")) return [{ insertId: 12 }, []];
    if (normalized.includes("FROM costs") && normalized.includes("WHERE id = ?")) {
      return [[{ id: Number(params[0]), vehicleId: 8, amount: 49.5 }], []];
    }
    if (normalized.includes("FROM costs") && normalized.includes("WHERE user_id = ?")) return [[], []];
    if (normalized.includes("SELECT id FROM costs WHERE id = ? AND user_id = ?")) return [[{ id: 12 }], []];
    if (normalized.includes("UPDATE costs")) return [{ affectedRows: 1 }, []];
    if (normalized.includes("DELETE FROM costs")) {
      assert.equal(params[1], 1);
      return [{ affectedRows: 1 }, []];
    }
    throw new Error(`Unexpected cost query: ${sql}`);
  });

  const payload = { vehicleId: 8, category: "fuel", amount: 49.5, date: "2026-08-13" };
  assert.equal((await request("/api/costs", { token: tokenFor() })).response.status, 200);
  assert.equal((await request("/api/costs", { method: "POST", token: tokenFor(), body: payload })).response.status, 201);
  assert.equal((await request("/api/costs/12", { method: "PUT", token: tokenFor(), body: payload })).response.status, 200);
  assert.equal((await request("/api/costs/12", { method: "DELETE", token: tokenFor() })).response.status, 200);
});

test("maintenance CRUD verifies vehicle ownership and user scope", async () => {
  queryHandler = authenticatedHandler(async (sql, params) => {
    const normalized = String(sql);
    if (normalized.includes("SELECT id FROM vehicles")) return [[{ id: 8 }], []];
    if (normalized.includes("INSERT INTO maintenances")) return [{ insertId: 15 }, []];
    if (normalized.includes("FROM maintenances") && normalized.includes("WHERE id = ?")) {
      return [[{ id: Number(params[0]), vehicleId: 8, maintenanceType: "service" }], []];
    }
    if (normalized.includes("FROM maintenances") && normalized.includes("WHERE user_id = ?")) return [[], []];
    if (normalized.includes("SELECT id FROM maintenances WHERE id = ? AND user_id = ?")) return [[{ id: 15 }], []];
    if (normalized.includes("UPDATE maintenances")) return [{ affectedRows: 1 }, []];
    if (normalized.includes("DELETE FROM maintenances")) {
      assert.equal(params[1], 1);
      return [{ affectedRows: 1 }, []];
    }
    throw new Error(`Unexpected maintenance query: ${sql}`);
  });

  const payload = {
    vehicleId: 8,
    maintenanceType: "service",
    nextDate: "2026-09-01",
    nextMileage: 15000,
    notificationDays: 7,
    status: "pending",
  };
  assert.equal((await request("/api/maintenances", { token: tokenFor() })).response.status, 200);
  assert.equal((await request("/api/maintenances", { method: "POST", token: tokenFor(), body: payload })).response.status, 201);
  assert.equal((await request("/api/maintenances/15", { method: "PUT", token: tokenFor(), body: payload })).response.status, 200);
  assert.equal((await request("/api/maintenances/15", { method: "DELETE", token: tokenFor() })).response.status, 200);
});

test("a user cannot attach costs or maintenance to another user's vehicle", async () => {
  queryHandler = authenticatedHandler(async (sql) => {
    if (String(sql).includes("SELECT id FROM vehicles")) return [[], []];
    throw new Error(`Unexpected isolation query: ${sql}`);
  });

  const cost = await request("/api/costs", {
    method: "POST",
    token: tokenFor(),
    body: { vehicleId: 999, category: "fuel", amount: 10, date: "2026-08-13" },
  });
  assert.equal(cost.response.status, 404);

  const maintenance = await request("/api/maintenances", {
    method: "POST",
    token: tokenFor(),
    body: { vehicleId: 999, maintenanceType: "service" },
  });
  assert.equal(maintenance.response.status, 404);
});
