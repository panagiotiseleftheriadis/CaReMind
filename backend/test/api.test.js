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
    { id: user.id, username: user.username, role: user.role },
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
  await new Promise((resolve) => {
    server = app.listen(0, "127.0.0.1", () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
});

beforeEach(() => {
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

test("login issues an access token and httpOnly refresh cookie", async () => {
  const passwordHash = await bcrypt.hash("correct-password", 4);
  queryHandler = async (sql) => {
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

test("refresh accepts an active session and logout revokes only the signed-in user token", async () => {
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
      assert.equal(params[1], activeUser.id);
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

  const logout = await request("/api/logout", {
    method: "POST",
    token: tokenFor(),
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
