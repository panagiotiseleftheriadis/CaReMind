const assert = require("node:assert/strict");
const express = require("express");
const { Pool } = require("pg");
const { runQuery, getConnection } = require("../postgres-query");
const db = require("../db");
const vehicleRouter = require("../routes/vehicles");
const { REMINDER_CANDIDATE_SQL } = require("../routes/cron");

module.exports = async function vehicleDomain(t, config, client) {
  const originalQuery = db.query;
  const originalGetConnection = db.getConnection;
  const originalFlag = process.env.VEHICLE_ARCHIVE_ENABLED;
  const pool = new Pool({ ...config, max: 6, allowExitOnIdle: true });
  db.query = (sql, params) => runQuery(pool, sql, params);
  db.getConnection = () => getConnection(pool);
  process.env.VEHICLE_ARCHIVE_ENABLED = "true";

  const app = express();
  app.use(express.json());
  app.use("/api/vehicles", (req, _res, next) => {
    req.user = { id: Number(req.headers["x-test-user"]) };
    next();
  }, vehicleRouter);
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });

  async function request(userId, path, { method = "GET", body } = {}) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/vehicles${path}`, {
      method,
      headers: { "X-Test-User": String(userId), ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  }

  async function bounded(promise, label) {
    let timer;
    try {
      return await Promise.race([
        promise,
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`Timed out during ${label}`)), 5_000); }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  try {
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const owner = (await client.query("INSERT INTO users(username,password,email) VALUES ($1,'test',$2) RETURNING id", [`p3a-owner-${suffix}`, `p3a-owner-${suffix}@example.test`])).rows[0].id;
    const foreign = (await client.query("INSERT INTO users(username,password,email) VALUES ($1,'test',$2) RETURNING id", [`p3a-foreign-${suffix}`, `p3a-foreign-${suffix}@example.test`])).rows[0].id;

    const created = await request(owner, "", { method: "POST", body: { vehicleType: "car", chassisNumber: `P3A-${suffix}`, model: "Legacy", year: 2020, currentMileage: 50000 } });
    assert.equal(created.status, 201);
    const vehicleId = created.body.id;
    assert.equal(created.body.revision, 1);
    assert.equal(created.body.archivedAt, null);

    const maintenanceId = (await client.query("INSERT INTO maintenances(user_id,vehicle_id,maintenance_type,next_date,notification_days,status) VALUES ($1,$2,'service',CURRENT_DATE,0,'pending') RETURNING id", [owner, vehicleId])).rows[0].id;
    const costId = (await client.query("INSERT INTO costs(user_id,vehicle_id,category,amount,cost_date) VALUES ($1,$2,'service',99.95,CURRENT_DATE) RETURNING id", [owner, vehicleId])).rows[0].id;

    assert.equal((await request(owner, `/${vehicleId}`)).status, 200);
    assert.equal((await request(foreign, `/${vehicleId}`)).status, 404);
    assert.equal((await request(foreign, `/${vehicleId}`, { method: "PATCH", body: { make: "Nope" } })).status, 404);
    assert.equal((await request(owner, `/${vehicleId}`, { method: "PATCH", body: { user_id: foreign } })).body.code, "UNSUPPORTED_VEHICLE_FIELD");
    assert.equal((await request(owner, `/${vehicleId}`, { method: "PATCH", body: { year: 1200 } })).body.code, "INVALID_VEHICLE_FIELD");

    const patched = await request(owner, `/${vehicleId}`, { method: "PATCH", body: { make: "Toyota", registrationPlate: "ΙΒΧ-1234", registrationCountry: "gr", fuelType: "hybrid", purchaseDate: "2020-02-29", purchaseAmount: 18000, currency: "eur" } });
    assert.equal(patched.status, 200);
    assert.equal(patched.body.revision, 2);
    assert.equal(patched.body.registrationCountry, "GR");
    assert.equal(patched.body.currency, "EUR");

    const legacyPut = await request(owner, `/${vehicleId}`, { method: "PUT", body: { vehicleType: "car", chassisNumber: `P3A-${suffix}`, model: "Legacy PUT", year: 2020, currentMileage: 51000 } });
    assert.equal(legacyPut.status, 200);
    assert.equal(legacyPut.body.make, "Toyota");
    assert.equal(legacyPut.body.revision, 3);

    assert.equal((await request(owner, "?state=active")).body.some((item) => item.id === vehicleId), true);
    assert.equal((await request(owner, "?state=archived")).body.some((item) => item.id === vehicleId), false);
    assert.equal((await request(owner, "?state=invalid")).status, 400);
    assert.equal((await request(foreign, `/${vehicleId}/archive`, { method: "POST" })).status, 404);

    const archived = await request(owner, `/${vehicleId}/archive`, { method: "POST" });
    assert.equal(archived.status, 200);
    assert.equal(archived.body.state, "archived");
    assert.equal(archived.body.revision, 4);
    const archiveTimestamp = archived.body.archivedAt;
    const repeatedArchive = await request(owner, `/${vehicleId}/archive`, { method: "POST" });
    assert.equal(repeatedArchive.body.revision, 4);
    assert.equal(repeatedArchive.body.archivedAt, archiveTimestamp);
    assert.equal((await request(owner, "")).body.some((item) => item.id === vehicleId), false);
    assert.equal((await request(owner, "?state=archived")).body.some((item) => item.id === vehicleId), true);
    assert.equal((await request(owner, "?state=all")).body.some((item) => item.id === vehicleId), true);
    assert.equal((await request(owner, `/${vehicleId}`)).body.state, "archived");
    assert.equal((await client.query(REMINDER_CANDIDATE_SQL)).rows.some((row) => Number(row.maintenance_id) === Number(maintenanceId)), false);
    assert.equal((await client.query("SELECT count(*)::int AS count FROM maintenances WHERE id=$1", [maintenanceId])).rows[0].count, 1);
    assert.equal((await client.query("SELECT count(*)::int AS count FROM costs WHERE id=$1", [costId])).rows[0].count, 1);
    assert.equal((await request(owner, `/${vehicleId}`, { method: "DELETE" })).body.code, "VEHICLE_ARCHIVE_REQUIRED");

    assert.equal((await request(foreign, `/${vehicleId}/restore`, { method: "POST" })).status, 404);
    const restored = await request(owner, `/${vehicleId}/restore`, { method: "POST" });
    assert.equal(restored.body.state, "active");
    assert.equal(restored.body.revision, 5);
    const repeatedRestore = await request(owner, `/${vehicleId}/restore`, { method: "POST" });
    assert.equal(repeatedRestore.body.revision, 5);

    const concurrentArchive = await bounded(Promise.all([
      request(owner, `/${vehicleId}/archive`, { method: "POST" }),
      request(owner, `/${vehicleId}/archive`, { method: "POST" }),
    ]), "concurrent archive");
    assert.deepEqual(concurrentArchive.map((result) => result.status), [200, 200]);
    assert.deepEqual(new Set(concurrentArchive.map((result) => result.body.revision)), new Set([6]));
    assert.equal(new Set(concurrentArchive.map((result) => result.body.archivedAt)).size, 1);
    const concurrentRestore = await bounded(Promise.all([
      request(owner, `/${vehicleId}/restore`, { method: "POST" }),
      request(owner, `/${vehicleId}/restore`, { method: "POST" }),
    ]), "concurrent restore");
    assert.deepEqual(new Set(concurrentRestore.map((result) => result.body.revision)), new Set([7]));
    assert.equal(concurrentRestore.every((result) => result.body.archivedAt === null), true);

    process.env.VEHICLE_ARCHIVE_ENABLED = "false";
    assert.equal((await request(owner, `/${vehicleId}/archive`, { method: "POST" })).body.code, "VEHICLE_ARCHIVE_DISABLED");
    const disposable = await request(owner, "", { method: "POST", body: { vehicleType: "car", chassisNumber: `DELETE-${suffix}` } });
    assert.equal((await request(owner, `/${disposable.body.id}`, { method: "DELETE" })).status, 200);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await pool.end();
    db.query = originalQuery;
    db.getConnection = originalGetConnection;
    if (originalFlag === undefined) delete process.env.VEHICLE_ARCHIVE_ENABLED;
    else process.env.VEHICLE_ARCHIVE_ENABLED = originalFlag;
  }
};
