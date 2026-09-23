const assert = require("node:assert/strict");
const { after, before, beforeEach, test } = require("node:test");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "test-only-secret-with-at-least-thirty-two-characters";
process.env.CORS_ORIGINS = "http://localhost:4173";

const db = require("../db");
const app = require("../server");
const { normalizeCreate, normalizePatch } = require("../routes/vehicles");
const { isVehicleArchiveEnabled } = require("../vehicle-archive-capability");

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

test("vehicle archive capability parsing is strict and fail-closed", () => {
  assert.equal(isVehicleArchiveEnabled({}), false);
  assert.equal(isVehicleArchiveEnabled({ VEHICLE_ARCHIVE_ENABLED: "" }), false);
  assert.equal(isVehicleArchiveEnabled({ VEHICLE_ARCHIVE_ENABLED: "false" }), false);
  assert.equal(isVehicleArchiveEnabled({ VEHICLE_ARCHIVE_ENABLED: "true" }), true);
  for (const value of ["TRUE", "True", "1", "yes", " true ", true]) {
    assert.equal(isVehicleArchiveEnabled({ VEHICLE_ARCHIVE_ENABLED: value }), false, String(value));
  }
});

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
  delete process.env.VEHICLE_ARCHIVE_ENABLED;
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

test("registration reports duplicate username and email with stable codes", async () => {
  queryHandler = async (sql, params) => {
    assert.match(String(sql), /SELECT id, username, email FROM users/);
    return [[{ id: 9, username: params[0], email: "different@example.test" }], []];
  };
  const usernameTaken = await request("/api/register", {
    method: "POST",
    body: { username: "existing-user", email: "new@example.test", password: "valid-password-123" },
  });
  assert.equal(usernameTaken.response.status, 409);
  assert.equal(usernameTaken.body.code, "USERNAME_TAKEN");

  queryHandler = async (sql, params) => {
    assert.match(String(sql), /SELECT id, username, email FROM users/);
    return [[{ id: 10, username: "different-user", email: params[1] }], []];
  };
  const emailTaken = await request("/api/register", {
    method: "POST",
    body: { username: "new-user", email: "existing@example.test", password: "valid-password-123" },
  });
  assert.equal(emailTaken.response.status, 409);
  assert.equal(emailTaken.body.code, "EMAIL_TAKEN");
});

test("email verification handles invalid or expired codes and already verified accounts", async () => {
  queryHandler = async (sql) => {
    if (String(sql).includes("SELECT id, email_verified FROM users")) {
      return [[{ id: 12, email_verified: 0 }], []];
    }
    if (String(sql).includes("FROM email_verification_codes")) return [[], []];
    throw new Error("Unexpected verification query");
  };
  const expired = await request("/api/verify-email", {
    method: "POST",
    body: { email: "pending@example.test", code: "123456" },
  });
  assert.equal(expired.response.status, 400);

  queryHandler = async (sql) => {
    if (String(sql).includes("SELECT id, email_verified FROM users")) {
      return [[{ id: 13, email_verified: 1 }], []];
    }
    throw new Error("Already verified must not inspect a code");
  };
  const alreadyVerified = await request("/api/verify-email", {
    method: "POST",
    body: { email: "verified@example.test", code: "654321" },
  });
  assert.equal(alreadyVerified.response.status, 200);
  assert.equal(alreadyVerified.body.message, "Email already verified");
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

test("vehicle creation accepts validated P3a identity and purchase fields", async () => {
  const values = normalizeCreate({
    vehicleType: "car", chassisNumber: " VIN-NEW ", make: "Toyota", model: "Corolla",
    registrationPlate: "ABC-123", registrationCountry: "gr", vin: "vin123",
    fuelType: "hybrid", year: 2025, currentMileage: 100, purchaseDate: "2026-01-15",
    purchaseAmount: 24500.5, currency: "eur",
  });
  assert.deepEqual(Object.fromEntries(values.map(({ column, value }) => [column, value])), {
    vehicle_type: "car", chassis_number: "VIN-NEW", model: "Corolla", make: "Toyota",
    registration_plate: "ABC-123", registration_country: "GR", vin: "VIN123",
    fuel_type: "hybrid", year: 2025, current_mileage: 100, purchase_date: "2026-01-15",
    purchase_amount: 24500.5, currency: "EUR",
  });
  assert.throws(() => normalizeCreate({ vehicleType: "car", chassisNumber: "VIN", fuelType: "steam" }), (error) => error.body.code === "INVALID_VEHICLE_FIELD");
  assert.throws(() => normalizeCreate({ vehicleType: "car", chassisNumber: "VIN", ownerId: 2 }), (error) => error.body.code === "UNSUPPORTED_VEHICLE_FIELD");
});

test("maintenance and cost vehicle filters validate ownership and scope the query", async () => {
  const scoped = [];
  queryHandler = authenticatedHandler(async (sql, params) => {
    const normalized = String(sql).replace(/\s+/g, " ");
    if (normalized.includes("SELECT id FROM vehicles")) return [[{ id: 8 }], []];
    if (normalized.includes("FROM maintenances") || normalized.includes("FROM costs")) {
      scoped.push({ normalized, params });
      return [[], []];
    }
    throw new Error(`Unexpected filtered history query: ${sql}`);
  });
  assert.equal((await request("/api/maintenances?vehicle_id=8", { token: tokenFor() })).response.status, 200);
  assert.equal((await request("/api/costs?vehicle_id=8", { token: tokenFor() })).response.status, 200);
  assert.equal(scoped.length, 2);
  for (const query of scoped) {
    assert.match(query.normalized, /WHERE user_id = \? AND vehicle_id = \?/);
    assert.deepEqual(query.params, [1, "8"]);
  }
  assert.equal((await request("/api/maintenances?vehicle_id=invalid", { token: tokenFor() })).response.status, 400);
  assert.equal((await request("/api/costs?vehicle_id=0", { token: tokenFor() })).response.status, 400);

  queryHandler = authenticatedHandler(async (sql) => {
    if (String(sql).includes("SELECT id FROM vehicles")) return [[], []];
    throw new Error("A cross-user filter must stop at ownership verification");
  });
  assert.equal((await request("/api/maintenances?vehicle_id=999", { token: tokenFor() })).response.status, 404);
  assert.equal((await request("/api/costs?vehicle_id=999", { token: tokenFor() })).response.status, 404);
});

test("vehicle detail and archive-state lists remain owner scoped", async () => {
  const seen = [];
  queryHandler = async (sql, params) => {
    const normalized = String(sql).replace(/\s+/g, " ");
    if (normalized.includes("SELECT id, username, email, role, is_active")) return [[{ ...activeUser, id: Number(params[0]), username: `user-${params[0]}` }], []];
    seen.push(normalized);
    if (normalized.includes("FROM vehicles v") && normalized.includes("WHERE v.id = ? AND v.user_id = ?")) {
      return [Number(params[1]) === 1 ? [{ id: Number(params[0]), state: "archived", archivedAt: "2026-09-23T00:00:00.000Z", revision: 2 }] : [], []];
    }
    if (normalized.includes("FROM vehicles v") && normalized.includes("ORDER BY v.id DESC")) return [[{ id: 7 }], []];
    throw new Error(`Unexpected vehicle detail/list query: ${sql}`);
  };

  assert.equal((await request("/api/vehicles/7", { token: tokenFor() })).response.status, 200);
  assert.equal((await request("/api/vehicles/7", { token: tokenFor({ ...activeUser, id: 2, username: "other" }) })).response.status, 404);
  assert.equal((await request("/api/vehicles?state=active", { token: tokenFor() })).response.status, 200);
  assert.match(seen.at(-1), /v\.archived_at IS NULL/);
  assert.equal((await request("/api/vehicles?state=archived", { token: tokenFor() })).response.status, 200);
  assert.match(seen.at(-1), /v\.archived_at IS NOT NULL/);
  assert.equal((await request("/api/vehicles?state=all", { token: tokenFor() })).response.status, 200);
  assert.doesNotMatch(seen.at(-1), /WHERE v\.user_id = \? AND v\.archived_at/);
  assert.equal((await request("/api/vehicles?state=invalid", { token: tokenFor() })).response.status, 400);
});

test("vehicle PATCH allowlist validates input and increments revision in one owner-scoped transaction", async () => {
  assert.deepEqual(normalizePatch({ make: null }), [{ column: "make", value: null }]);
  assert.throws(() => normalizePatch({ make: "" }), (error) => error.body.code === "INVALID_VEHICLE_FIELD");
  let revision = 1;
  let make = null;
  queryHandler = authenticatedHandler(async (sql, params) => {
    const normalized = String(sql).replace(/\s+/g, " ");
    if (normalized === "SELECT id FROM users WHERE id = ? FOR UPDATE") return [[{ id: 1 }], []];
    if (normalized.includes("SELECT id, user_id, archived_at AS archivedAt, revision") && normalized.includes("FOR UPDATE")) return [[{ id: 7, user_id: 1, archivedAt: null, revision }], []];
    if (normalized.startsWith("UPDATE vehicles SET make = ?")) {
      make = params[0];
      revision++;
      return [{ affectedRows: 1 }, []];
    }
    if (normalized.includes("FROM vehicles v") && normalized.includes("WHERE v.id = ? AND v.user_id = ?")) return [[{ id: 7, make, revision, state: "active", archivedAt: null }], []];
    throw new Error(`Unexpected vehicle PATCH query: ${sql}`);
  });

  const patched = await request("/api/vehicles/7", { method: "PATCH", token: tokenFor(), body: { make: "Toyota" } });
  assert.equal(patched.response.status, 200);
  assert.equal(patched.body.make, "Toyota");
  assert.equal(patched.body.revision, 2);
  assert.equal((await request("/api/vehicles/7", { method: "PATCH", token: tokenFor(), body: { user_id: 99 } })).body.code, "UNSUPPORTED_VEHICLE_FIELD");
  assert.equal((await request("/api/vehicles/7", { method: "PATCH", token: tokenFor(), body: { currentMileage: -1 } })).body.code, "INVALID_VEHICLE_FIELD");

  queryHandler = authenticatedHandler(async (sql) => {
    if (String(sql).includes("SELECT id FROM users")) return [[{ id: 1 }], []];
    if (String(sql).includes("FROM vehicles") && String(sql).includes("FOR UPDATE")) return [[], []];
    throw new Error("Cross-user PATCH must stop after the owned lookup");
  });
  assert.equal((await request("/api/vehicles/7", { method: "PATCH", token: tokenFor(), body: { make: "Nope" } })).response.status, 404);
});

test("archive capability gates transitions and protects legacy DELETE after activation", async () => {
  queryHandler = authenticatedHandler(async () => {
    throw new Error("A disabled archive or guarded DELETE must not query vehicle state");
  });
  assert.equal((await request("/api/vehicles/7/archive", { method: "POST", token: tokenFor() })).body.code, "VEHICLE_ARCHIVE_DISABLED");
  assert.equal((await request("/api/vehicles/7/restore", { method: "POST", token: tokenFor() })).body.code, "VEHICLE_ARCHIVE_DISABLED");
  process.env.VEHICLE_ARCHIVE_ENABLED = "true";
  assert.equal((await request("/api/vehicles/7", { method: "DELETE", token: tokenFor() })).body.code, "VEHICLE_ARCHIVE_REQUIRED");

  let archivedAt = null;
  let revision = 1;
  queryHandler = authenticatedHandler(async (sql) => {
    const normalized = String(sql).replace(/\s+/g, " ");
    if (normalized === "SELECT id FROM users WHERE id = ? FOR UPDATE") return [[{ id: 1 }], []];
    if (normalized.includes("FROM vehicles") && normalized.includes("FOR UPDATE")) return [[{ id: 7, user_id: 1, archivedAt, revision }], []];
    if (normalized.includes("SET archived_at = clock_timestamp()")) {
      archivedAt = "2026-09-23T10:00:00.000Z";
      revision++;
      return [{ affectedRows: 1 }, []];
    }
    if (normalized.includes("SET archived_at = NULL")) {
      archivedAt = null;
      revision++;
      return [{ affectedRows: 1 }, []];
    }
    if (normalized.includes("FROM vehicles v")) return [[{ id: 7, archivedAt, state: archivedAt ? "archived" : "active", revision }], []];
    throw new Error(`Unexpected archive query: ${sql}`);
  });

  const archived = await request("/api/vehicles/7/archive", { method: "POST", token: tokenFor() });
  assert.equal(archived.body.revision, 2);
  const repeatedArchive = await request("/api/vehicles/7/archive", { method: "POST", token: tokenFor() });
  assert.equal(repeatedArchive.body.revision, 2);
  assert.equal(repeatedArchive.body.archivedAt, archived.body.archivedAt);
  const restored = await request("/api/vehicles/7/restore", { method: "POST", token: tokenFor() });
  assert.equal(restored.body.revision, 3);
  const repeatedRestore = await request("/api/vehicles/7/restore", { method: "POST", token: tokenFor() });
  assert.equal(repeatedRestore.body.revision, 3);

  queryHandler = authenticatedHandler(async (sql) => {
    if (String(sql).includes("SELECT id FROM users")) return [[{ id: 1 }], []];
    if (String(sql).includes("FROM vehicles") && String(sql).includes("FOR UPDATE")) return [[], []];
    throw new Error("Cross-user archive/restore must stop after the owned lookup");
  });
  assert.equal((await request("/api/vehicles/7/archive", { method: "POST", token: tokenFor() })).response.status, 404);
  assert.equal((await request("/api/vehicles/7/restore", { method: "POST", token: tokenFor() })).response.status, 404);
});
