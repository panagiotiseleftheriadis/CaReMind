// Explicit command only. No dotenv, runtime pool, or DATABASE_URL fallback.
const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { Client } = require("pg");
const { migrate } = require("../scripts/migrate");
const { testDatabaseConfig } = require("../scripts/migration-config");
const { REMINDER_CANDIDATE_SQL } = require("../routes/cron");

// Validate before constructing any client. Only the shell's explicit test URL is read.
const config = testDatabaseConfig();
const source = path.resolve(__dirname, "../migrations");
const expected = ["001_initial_schema.js", "002_align_legacy_schema.js", "003_vehicle_identity_archive.js", "004_odometer_readings.js"];
const logger = { log() {} };
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitFor(probe, description) {
  const until = Date.now() + 8_000;
  while (Date.now() < until) {
    if (await probe()) return;
    await delay(40);
  }
  throw new Error(`Timed out waiting for ${description}`);
}

test("real PostgreSQL migration guarantees", { timeout: 110_000 }, async (t) => {
  const admin = new Client(config);
  const databases = [];
  const clients = [];
  const pending = [];
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "caremind-migrations-"));
  t.after(async () => {
    try {
      // Release the concurrency gate even when an assertion fails.
      await admin.query("SELECT pg_advisory_unlock_all()").catch(() => {});
      await Promise.allSettled(pending);
      await Promise.allSettled(clients.map((client) => client.end()));
      for (const name of databases) {
        // Names are generated locally, never taken from a supplied connection URL.
        assert.match(name, /^caremind_test_run_[a-f0-9]+$/);
        await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
      }
    } finally {
      await admin.end();
      await fs.rm(temporary, { recursive: true, force: true });
    }
  });
  await admin.connect();
  const hashes = async () => Promise.all(expected.map(async (name) => crypto.createHash("sha256").update(await fs.readFile(path.join(source, name))).digest("hex")));
  const originalHashes = await hashes();
  async function database() {
    const name = `caremind_test_run_${crypto.randomBytes(10).toString("hex")}`;
    await admin.query(`CREATE DATABASE "${name}"`);
    databases.push(name);
    const client = new Client({ ...config, database: name });
    clients.push(client);
    await client.connect();
    const url = new URL(process.env.TEST_DATABASE_URL);
    url.pathname = `/${name}`;
    return { client, env: { MIGRATION_DATABASE_URL: url.toString(), CI: "true" }, name };
  }
  async function fixture(label) {
    const directory = path.join(temporary, label);
    await fs.mkdir(directory);
    for (const name of expected) await fs.copyFile(path.join(source, name), path.join(directory, name));
    return directory;
  }
  async function noRunnerSessions(name) {
    const result = await admin.query("SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname=$1 AND application_name='caremind-migrations'", [name]);
    assert.equal(result.rows[0].count, 0, "dedicated migration sessions must be closed");
  }
  const fresh = await database();
  let ledger;
  await t.test("fresh database applies exactly 001/002/003/004 and all expected tables", async () => {
    await migrate({ env: fresh.env, logger });
    ledger = (await fresh.client.query("SELECT name, checksum, executed_at FROM schema_migrations ORDER BY name")).rows;
    assert.deepEqual(ledger.map((row) => row.name), expected);
    assert.deepEqual(ledger.map((row) => row.checksum), originalHashes);
    const tables = (await fresh.client.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows.map((row) => row.tablename);
    assert.deepEqual(tables, ["companies", "costs", "email_verification_codes", "interest_requests", "maintenances", "notification_recipients", "odometer_readings", "password_reset_codes", "refresh_tokens", "schema_migrations", "users", "vehicles", "verification_codes"]);
    await fresh.client.query("INSERT INTO companies(name) VALUES ('preserve-me')");
    await noRunnerSessions(fresh.name);
  });
  await t.test("second run skips every migration and preserves ledger/data", async () => {
    const messages = [];
    await migrate({ env: fresh.env, logger: { log: (message) => messages.push(message) } });
    assert.equal(messages.filter((message) => message.startsWith("skip ")).length, expected.length);
    assert.equal(messages.filter((message) => message.startsWith("run ")).length, 0);
    assert.deepEqual((await fresh.client.query("SELECT name, checksum, executed_at FROM schema_migrations ORDER BY name")).rows, ledger);
    assert.equal((await fresh.client.query("SELECT name FROM companies")).rows[0].name, "preserve-me");
  });
  await t.test("tampered copied migration fails without changing data or repository bytes", async () => {
    const directory = await fixture("checksum");
    await fs.appendFile(path.join(directory, expected[0]), "\n// deliberate test-only checksum change\n");
    await assert.rejects(migrate({ env: fresh.env, directory, logger }), /Applied migration was modified: 001/);
    assert.deepEqual(await hashes(), originalHashes);
    assert.deepEqual((await fresh.client.query("SELECT name, checksum, executed_at FROM schema_migrations ORDER BY name")).rows, ledger);
    assert.equal((await fresh.client.query("SELECT name FROM companies")).rows[0].name, "preserve-me");
    await noRunnerSessions(fresh.name);
  });
  await t.test("failed migration rolls back DDL/write/ledger, stops later files and releases session", async () => {
    const directory = await fixture("rollback");
    await fs.writeFile(path.join(directory, "900_failure.js"), `exports.up = async (db) => {
      await db.query("CREATE TABLE rollback_probe (id SERIAL PRIMARY KEY)");
      await db.query("INSERT INTO companies(name) VALUES ('must-rollback')");
      await db.query("SELECT 1/0");
    };`);
    await fs.writeFile(path.join(directory, "901_never.js"), `exports.up = async (db) => { await db.query("CREATE TABLE never_probe (id SERIAL PRIMARY KEY)"); };`);
    await assert.rejects(migrate({ env: fresh.env, directory, logger }), /division by zero/);
    assert.equal((await fresh.client.query("SELECT to_regclass('rollback_probe') AS a, to_regclass('never_probe') AS b")).rows[0].a, null);
    assert.equal((await fresh.client.query("SELECT to_regclass('never_probe') AS b")).rows[0].b, null);
    assert.deepEqual((await fresh.client.query("SELECT name FROM companies")).rows, [{ name: "preserve-me" }]);
    assert.deepEqual((await fresh.client.query("SELECT name, checksum, executed_at FROM schema_migrations ORDER BY name")).rows, ledger);
    await noRunnerSessions(fresh.name);
    await migrate({ env: fresh.env, logger });
  });
  await t.test("a failure after copied 003 work rolls back every 003 schema change", async () => {
    const target = await database();
    const directory = await fixture("rollback-003");
    await fs.appendFile(path.join(directory, expected[2]), `
const originalUpForRollbackTest = module.exports.up;
module.exports.up = async (db) => {
  await originalUpForRollbackTest(db);
  await db.query("SELECT 1/0");
};
`);
    await assert.rejects(migrate({ env: target.env, directory, logger }), /division by zero/);
    assert.deepEqual(
      (await target.client.query("SELECT name FROM schema_migrations ORDER BY name")).rows.map((row) => row.name),
      expected.slice(0, 2)
    );
    const columns = (await target.client.query(`SELECT column_name FROM information_schema.columns
      WHERE table_schema='public' AND table_name='vehicles'`)).rows.map((row) => row.column_name);
    for (const column of ["registration_plate", "registration_country", "make", "vin", "fuel_type", "purchase_date", "purchase_amount", "currency", "archived_at", "revision"]) {
      assert.equal(columns.includes(column), false, column);
    }
    assert.equal((await target.client.query("SELECT to_regclass('idx_vehicles_user_active') AS index")).rows[0].index, null);
    assert.deepEqual(
      (await target.client.query("SELECT conname FROM pg_constraint WHERE conrelid='vehicles'::regclass AND conname LIKE 'chk_vehicles_%' ORDER BY conname")).rows.map((row) => row.conname),
      ["chk_vehicles_mileage"]
    );
    await noRunnerSessions(target.name);
  });
  await t.test("two real runners serialize and execute on the session owning the lock", async () => {
    const target = await database();
    const directory = await fixture("concurrency");
    await fs.writeFile(path.join(directory, "900_concurrency.js"), `exports.up = async (db) => {
      await db.query("SELECT pg_advisory_xact_lock(71920421)");
      await db.query("CREATE TABLE session_probe (id SERIAL PRIMARY KEY, pid INTEGER, owns_lock BOOLEAN)");
      await db.query("INSERT INTO session_probe(pid, owns_lock) SELECT pg_backend_pid(), EXISTS (SELECT 1 FROM pg_locks WHERE locktype='advisory' AND pid=pg_backend_pid() AND granted AND objid=hashtext('caremind_migrations')::oid)");
    };`);
    // Advisory locks are database-local, so hold the gate on the target database.
    await target.client.query("SELECT pg_advisory_lock(71920421)");
    let runA, runB;
    try {
      runA = migrate({ env: target.env, directory, logger });
      pending.push(runA);
      runA.catch(() => {});
      const locks = async () => (await target.client.query("SELECT pid, granted FROM pg_locks WHERE locktype='advisory' AND database=(SELECT oid FROM pg_database WHERE datname=current_database()) AND objid=hashtext('caremind_migrations')::oid")).rows;
      await waitFor(async () => (await locks()).some((row) => row.granted), "runner A migration lock");
      const pidA = (await locks()).find((row) => row.granted).pid;
      await waitFor(async () => (await target.client.query("SELECT 1 FROM pg_locks WHERE pid=$1 AND locktype='advisory' AND objid=71920421 AND NOT granted", [pidA])).rowCount === 1, "runner A fixture gate");
      runB = migrate({ env: target.env, directory, logger });
      pending.push(runB);
      runB.catch(() => {});
      await waitFor(async () => (await locks()).some((row) => !row.granted && row.pid !== pidA), "runner B blocked on migration lock");
      assert.equal((await target.client.query("SELECT to_regclass('session_probe') AS probe")).rows[0].probe, null);
      await target.client.query("SELECT pg_advisory_unlock(71920421)");
      await Promise.all([runA, runB]);
      assert.deepEqual((await target.client.query("SELECT pid, owns_lock FROM session_probe")).rows, [{ pid: pidA, owns_lock: true }]);
      assert.deepEqual((await target.client.query("SELECT name FROM schema_migrations ORDER BY name")).rows.map((row) => row.name), [...expected, "900_concurrency.js"]);
      assert.deepEqual(await locks(), []);
      await noRunnerSessions(target.name);
    } finally {
      await target.client.query("SELECT pg_advisory_unlock_all()");
      await Promise.allSettled([runA, runB].filter(Boolean));
    }
  });
  assert.deepEqual(await hashes(), originalHashes);
  await t.test("004 backfills mileage evidence and enforces ownership, correction and cascade constraints", async () => {
    const target = await database();
    const before004 = await fixture("legacy-before-004");
    await fs.rm(path.join(before004, expected[3]));
    await migrate({ env: target.env, directory: before004, logger });
    const owner = (await target.client.query("INSERT INTO users(username,password,email) VALUES ('p4-owner','test','p4-owner@example.test') RETURNING id")).rows[0].id;
    const foreign = (await target.client.query("INSERT INTO users(username,password,email) VALUES ('p4-foreign','test','p4-foreign@example.test') RETURNING id")).rows[0].id;
    const active = (await target.client.query("INSERT INTO vehicles(user_id,vehicle_type,chassis_number,current_mileage) VALUES ($1,'car','P4-ACTIVE',12345) RETURNING id", [owner])).rows[0].id;
    const archived = (await target.client.query("INSERT INTO vehicles(user_id,vehicle_type,chassis_number,current_mileage,archived_at) VALUES ($1,'car','P4-ARCHIVED',0,clock_timestamp()) RETURNING id", [owner])).rows[0].id;
    const empty = (await target.client.query("INSERT INTO vehicles(user_id,vehicle_type,chassis_number,current_mileage) VALUES ($1,'car','P4-NULL',NULL) RETURNING id", [owner])).rows[0].id;
    const foreignVehicle = (await target.client.query("INSERT INTO vehicles(user_id,vehicle_type,chassis_number,current_mileage) VALUES ($1,'car','P4-FOREIGN',77) RETURNING id", [foreign])).rows[0].id;
    const maintenance = (await target.client.query("INSERT INTO maintenances(user_id,vehicle_id,maintenance_type,last_mileage,next_mileage) VALUES ($1,$2,'service',111,222) RETURNING id", [owner, active])).rows[0].id;
    const cost = (await target.client.query("INSERT INTO costs(user_id,vehicle_id,category,amount,cost_date) VALUES ($1,$2,'service',10,CURRENT_DATE) RETURNING id", [owner, active])).rows[0].id;

    await migrate({ env: target.env, logger });
    const baselines = (await target.client.query("SELECT vehicle_id,mileage_km,occurred_on,source FROM odometer_readings ORDER BY vehicle_id")).rows;
    assert.deepEqual(baselines.map((row) => [Number(row.vehicle_id), row.mileage_km, row.occurred_on, row.source]), [
      [Number(active), 12345, null, "legacy_baseline"],
      [Number(archived), 0, null, "legacy_baseline"],
      [Number(foreignVehicle), 77, null, "legacy_baseline"],
    ]);
    assert.equal(baselines.some((row) => Number(row.vehicle_id) === Number(empty)), false);
    assert.equal((await target.client.query("SELECT count(*)::int AS count FROM odometer_readings WHERE mileage_km IN (111,222)")).rows[0].count, 0);
    assert.equal((await target.client.query("SELECT count(*)::int AS count FROM maintenances WHERE id=$1", [maintenance])).rows[0].count, 1);
    assert.equal((await target.client.query("SELECT count(*)::int AS count FROM costs WHERE id=$1", [cost])).rows[0].count, 1);

    await assert.rejects(
      target.client.query("INSERT INTO odometer_readings(user_id,vehicle_id,mileage_km,occurred_on,source) VALUES ($1,$2,1,CURRENT_DATE,'manual')", [foreign, active]),
      (error) => error.code === "23503"
    );
    const first = (await target.client.query("INSERT INTO odometer_readings(user_id,vehicle_id,mileage_km,occurred_on,source) VALUES ($1,$2,13000,CURRENT_DATE,'manual') RETURNING id", [owner, active])).rows[0].id;
    await assert.rejects(
      target.client.query("INSERT INTO odometer_readings(user_id,vehicle_id,mileage_km,occurred_on,source) VALUES ($1,$2,13001,CURRENT_DATE,'manual')", [owner, active]),
      (error) => error.code === "23505"
    );
    await target.client.query("UPDATE odometer_readings SET voided_at=clock_timestamp(),void_reason='Correction' WHERE id=$1", [first]);
    const replacement = (await target.client.query("INSERT INTO odometer_readings(user_id,vehicle_id,mileage_km,occurred_on,source,replaces_reading_id) VALUES ($1,$2,13001,CURRENT_DATE,'manual',$3) RETURNING id", [owner, active, first])).rows[0].id;
    await assert.rejects(
      target.client.query("INSERT INTO odometer_readings(user_id,vehicle_id,mileage_km,occurred_on,source,replaces_reading_id) VALUES ($1,$2,13002,CURRENT_DATE-1,'manual',$3)", [owner, active, first]),
      (error) => {
        assert.equal(error.code, "23505");
        assert.equal(error.constraint, "uq_odometer_readings_replacement");
        return true;
      }
    );
    const crossScopeOriginal = (await target.client.query(
      "INSERT INTO odometer_readings(user_id,vehicle_id,mileage_km,occurred_on,source) VALUES ($1,$2,12900,CURRENT_DATE-2,'manual') RETURNING id",
      [owner, active]
    )).rows[0].id;
    await target.client.query("UPDATE odometer_readings SET voided_at=clock_timestamp(),void_reason='Cross-scope FK test' WHERE id=$1", [crossScopeOriginal]);
    await assert.rejects(
      target.client.query("INSERT INTO odometer_readings(user_id,vehicle_id,mileage_km,occurred_on,source,replaces_reading_id) VALUES ($1,$2,80,CURRENT_DATE-2,'manual',$3)", [foreign, foreignVehicle, crossScopeOriginal]),
      (error) => {
        assert.equal(error.code, "23503");
        assert.equal(error.constraint, "fk_odometer_readings_replaces");
        return true;
      }
    );
    await target.client.query("BEGIN");
    await target.client.query("DELETE FROM odometer_readings WHERE id=$1", [first]);
    await assert.rejects(
      target.client.query("COMMIT"),
      (error) => {
        assert.equal(error.code, "23503");
        assert.equal(error.constraint, "fk_odometer_readings_replaces");
        return true;
      }
    );
    await target.client.query("ROLLBACK");
    assert.equal((await target.client.query("SELECT count(*)::int AS count FROM odometer_readings WHERE id IN ($1,$2)", [first, replacement])).rows[0].count, 2);
    await target.client.query("DELETE FROM vehicles WHERE id=$1", [active]);
    assert.equal((await target.client.query("SELECT count(*)::int AS count FROM odometer_readings WHERE vehicle_id=$1", [active])).rows[0].count, 0);
  });
  await t.test("004 fails closed on unledgered table, constraint or index state", async () => {
    async function before004Target(label) {
      const target = await database();
      const directory = await fixture(label);
      await fs.rm(path.join(directory, expected[3]));
      await migrate({ env: target.env, directory, logger });
      return target;
    }

    const tableTarget = await before004Target("fail-closed-table");
    await tableTarget.client.query("CREATE TABLE odometer_readings(id BIGINT)");
    await assert.rejects(migrate({ env: tableTarget.env, logger }), /already exists/);
    assert.deepEqual((await tableTarget.client.query("SELECT name FROM schema_migrations ORDER BY name")).rows.map((row) => row.name), expected.slice(0, 3));

    const constraintTarget = await before004Target("fail-closed-constraint");
    await constraintTarget.client.query("ALTER TABLE vehicles ADD CONSTRAINT uq_vehicles_id_user UNIQUE(id,user_id)");
    await assert.rejects(migrate({ env: constraintTarget.env, logger }), /already exists/);
    assert.equal((await constraintTarget.client.query("SELECT to_regclass('odometer_readings') AS table")).rows[0].table, null);

    const indexTarget = await before004Target("fail-closed-index");
    await indexTarget.client.query("CREATE INDEX idx_odometer_readings_vehicle_history ON vehicles(user_id)");
    await assert.rejects(migrate({ env: indexTarget.env, logger }), /already exists/);
    assert.equal((await indexTarget.client.query("SELECT to_regclass('odometer_readings') AS table")).rows[0].table, null);
    assert.equal((await indexTarget.client.query("SELECT to_regclass('idx_odometer_readings_vehicle_history') AS index")).rows[0].index, "idx_odometer_readings_vehicle_history");
  });
  await t.test("atomic security writes on disposable PostgreSQL", async (securityTest) => {
    await require("./security-writes")(securityTest, { ...config, database: fresh.name }, fresh.client, waitFor);
  });
  await t.test("003 preserves populated legacy vehicles and adds only nullable identity/archive state plus revision", async () => {
    const target = await database();
    const before003 = await fixture("legacy-before-003");
    await fs.rm(path.join(before003, expected[2]));
    await fs.rm(path.join(before003, expected[3]));
    await migrate({ env: target.env, directory: before003, logger });
    const userId = (await target.client.query(
      "INSERT INTO users(username,password,email) VALUES ('legacy-003','test','legacy-003@example.test') RETURNING id"
    )).rows[0].id;
    const vehicleId = (await target.client.query(
      "INSERT INTO vehicles(user_id,vehicle_type,chassis_number,model,year,current_mileage) VALUES ($1,'car','LEGACY-003','Legacy',2018,123456) RETURNING id",
      [userId]
    )).rows[0].id;
    const maintenanceId = (await target.client.query(
      "INSERT INTO maintenances(user_id,vehicle_id,maintenance_type,status) VALUES ($1,$2,'service','pending') RETURNING id",
      [userId, vehicleId]
    )).rows[0].id;
    const costId = (await target.client.query(
      "INSERT INTO costs(user_id,vehicle_id,category,amount,cost_date) VALUES ($1,$2,'service',25.50,CURRENT_DATE) RETURNING id",
      [userId, vehicleId]
    )).rows[0].id;
    const countsBefore = (await target.client.query(`SELECT
      (SELECT count(*)::int FROM vehicles) AS vehicles,
      (SELECT count(*)::int FROM maintenances) AS maintenances,
      (SELECT count(*)::int FROM costs) AS costs`)).rows[0];

    await migrate({ env: target.env, logger });
    assert.deepEqual((await target.client.query(`SELECT
      (SELECT count(*)::int FROM vehicles) AS vehicles,
      (SELECT count(*)::int FROM maintenances) AS maintenances,
      (SELECT count(*)::int FROM costs) AS costs`)).rows[0], countsBefore);
    const vehicle = (await target.client.query("SELECT * FROM vehicles WHERE id=$1", [vehicleId])).rows[0];
    assert.equal(Number(vehicle.id), Number(vehicleId));
    assert.equal(Number(vehicle.user_id), Number(userId));
    assert.equal(vehicle.chassis_number, "LEGACY-003");
    assert.equal(vehicle.vehicle_type, "car");
    assert.equal(vehicle.model, "Legacy");
    assert.equal(vehicle.year, 2018);
    assert.equal(vehicle.current_mileage, 123456);
    for (const column of ["registration_plate", "registration_country", "make", "vin", "fuel_type", "purchase_date", "purchase_amount", "currency", "archived_at"]) assert.equal(vehicle[column], null, column);
    assert.equal(vehicle.revision, 1);
    assert.deepEqual((await target.client.query("SELECT id,vehicle_id FROM maintenances WHERE id=$1", [maintenanceId])).rows.map((row) => [Number(row.id), Number(row.vehicle_id)]), [[Number(maintenanceId), Number(vehicleId)]]);
    assert.deepEqual((await target.client.query("SELECT id,vehicle_id FROM costs WHERE id=$1", [costId])).rows.map((row) => [Number(row.id), Number(row.vehicle_id)]), [[Number(costId), Number(vehicleId)]]);

    const columns = (await target.client.query(`SELECT column_name,data_type,is_nullable,column_default
      FROM information_schema.columns WHERE table_schema='public' AND table_name='vehicles'`)).rows;
    const byName = Object.fromEntries(columns.map((column) => [column.column_name, column]));
    assert.match(byName.revision.column_default, /^1$/);
    assert.equal(byName.revision.is_nullable, "NO");
    assert.equal(byName.archived_at.data_type, "timestamp with time zone");
    assert.equal(byName.purchase_amount.data_type, "numeric");
    const indexes = (await target.client.query("SELECT indexname,indexdef FROM pg_indexes WHERE schemaname='public' AND tablename='vehicles'")).rows;
    assert.ok(indexes.some((index) => index.indexname === "idx_vehicles_user_active" && /WHERE \(archived_at IS NULL\)/.test(index.indexdef)));
    assert.equal(indexes.some((index) => index.indexname === "uq_vehicles_id_user"), true);
    const constraints = (await target.client.query("SELECT conname,convalidated FROM pg_constraint WHERE conrelid='vehicles'::regclass")).rows;
    for (const name of ["chk_vehicles_purchase_amount", "chk_vehicles_registration_country", "chk_vehicles_currency", "chk_vehicles_revision", "uq_vehicles_user_chassis"]) assert.equal(constraints.find((item) => item.conname === name)?.convalidated, true, name);

    await target.client.query("UPDATE vehicles SET registration_country=NULL,currency=NULL WHERE id=$1", [vehicleId]);
    await target.client.query("UPDATE vehicles SET registration_country='GR',currency='EUR',purchase_amount=0,revision=1 WHERE id=$1", [vehicleId]);
    await target.client.query("UPDATE vehicles SET purchase_amount=123.45 WHERE id=$1", [vehicleId]);
    for (const invalid of ["gr", "G", "GRC"]) {
      await assert.rejects(target.client.query("UPDATE vehicles SET registration_country=$2 WHERE id=$1", [vehicleId, invalid]), (error) => error.code === "23514" || error.code === "22001");
    }
    for (const invalid of ["eur", "EU", "EURO"]) {
      await assert.rejects(target.client.query("UPDATE vehicles SET currency=$2 WHERE id=$1", [vehicleId, invalid]), (error) => error.code === "23514" || error.code === "22001");
    }
    await assert.rejects(target.client.query("UPDATE vehicles SET purchase_amount=-0.01 WHERE id=$1", [vehicleId]), (error) => error.code === "23514");
    await assert.rejects(target.client.query("UPDATE vehicles SET revision=0 WHERE id=$1", [vehicleId]), (error) => error.code === "23514");
    await assert.rejects(target.client.query("UPDATE vehicles SET revision=-1 WHERE id=$1", [vehicleId]), (error) => error.code === "23514");

    const oldWriterId = (await target.client.query(
      "INSERT INTO vehicles(user_id,vehicle_type,chassis_number,current_mileage) VALUES ($1,'car','OLD-WRITER-003',0) RETURNING id",
      [userId]
    )).rows[0].id;
    await target.client.query("UPDATE vehicles SET model='Old writer still works' WHERE id=$1", [oldWriterId]);
    assert.deepEqual((await target.client.query("SELECT model,revision,archived_at FROM vehicles WHERE id=$1", [oldWriterId])).rows[0], { model: "Old writer still works", revision: 1, archived_at: null });

    const firstLedger = (await target.client.query("SELECT name,executed_at FROM schema_migrations WHERE name=$1", [expected[2]])).rows;
    assert.equal(firstLedger.length, 1);
    await migrate({ env: target.env, logger });
    assert.deepEqual((await target.client.query("SELECT name,executed_at FROM schema_migrations WHERE name=$1", [expected[2]])).rows, firstLedger);
    await noRunnerSessions(target.name);
  });
  await t.test("P0D reminder candidates enforce date, status, active-user and ownership rules", async () => {
    await fresh.client.query("BEGIN");
    try {
      // The current schema makes notification_days NOT NULL. Relax it only inside
      // this rolled-back fixture to prove the query also rejects a legacy null.
      await fresh.client.query("ALTER TABLE maintenances ALTER COLUMN notification_days DROP NOT NULL");
      const active = (await fresh.client.query(
        "INSERT INTO users(username,password,email,is_active) VALUES ('p0d-active','test','p0d-active@example.test',1) RETURNING id"
      )).rows[0].id;
      const inactive = (await fresh.client.query(
        "INSERT INTO users(username,password,email,is_active) VALUES ('p0d-inactive','test','p0d-inactive@example.test',0) RETURNING id"
      )).rows[0].id;
      const activeVehicle = (await fresh.client.query(
        "INSERT INTO vehicles(user_id,vehicle_type,chassis_number,model) VALUES ($1,'car','P0D-ACTIVE','Active') RETURNING id",
        [active]
      )).rows[0].id;
      const inactiveVehicle = (await fresh.client.query(
        "INSERT INTO vehicles(user_id,vehicle_type,chassis_number,model) VALUES ($1,'car','P0D-INACTIVE','Inactive') RETURNING id",
        [inactive]
      )).rows[0].id;

      async function maintenance(userId, vehicleId, nextDateSql, notificationDays, status, label) {
        return (await fresh.client.query(
          `INSERT INTO maintenances(user_id,vehicle_id,maintenance_type,next_date,notification_days,status,notes)
           VALUES ($1,$2,'service',${nextDateSql},$3,$4,$5) RETURNING id`,
          [userId, vehicleId, notificationDays, status, label]
        )).rows[0].id;
      }

      const selectedSevenDay = await maintenance(active, activeVehicle, "CURRENT_DATE + 7", 7, "pending", "selected-seven-day");
      const selectedZeroDay = await maintenance(active, activeVehicle, "CURRENT_DATE", 0, "pending", "selected-zero-day");
      const inactiveUser = await maintenance(inactive, inactiveVehicle, "CURRENT_DATE + 7", 7, "pending", "inactive-user");
      const completed = await maintenance(active, activeVehicle, "CURRENT_DATE + 7", 7, "completed", "completed");
      const nullDate = await maintenance(active, activeVehicle, "NULL", 7, "pending", "null-date");
      const nullOffset = await maintenance(active, activeVehicle, "CURRENT_DATE + 7", null, "pending", "null-offset");
      const mismatchedOwner = await maintenance(active, inactiveVehicle, "CURRENT_DATE + 7", 7, "pending", "mismatched-owner");

      const result = await fresh.client.query(REMINDER_CANDIDATE_SQL);
      assert.deepEqual(
        result.rows.map((row) => Number(row.maintenance_id)).sort((a, b) => a - b),
        [Number(selectedSevenDay), Number(selectedZeroDay)].sort((a, b) => a - b)
      );
      for (const excluded of [inactiveUser, completed, nullDate, nullOffset, mismatchedOwner]) {
        assert.ok(!result.rows.some((row) => Number(row.maintenance_id) === Number(excluded)));
      }
    } finally {
      await fresh.client.query("ROLLBACK");
    }
  });
  await t.test("full user deletion still cascades active and archived vehicle history", async () => {
    const suffix = crypto.randomBytes(6).toString("hex");
    const userId = (await fresh.client.query(
      "INSERT INTO users(username,password,email) VALUES ($1,'test',$2) RETURNING id",
      [`delete-${suffix}`, `delete-${suffix}@example.test`]
    )).rows[0].id;
    const activeVehicle = (await fresh.client.query(
      "INSERT INTO vehicles(user_id,vehicle_type,chassis_number) VALUES ($1,'car',$2) RETURNING id",
      [userId, `DELETE-ACTIVE-${suffix}`]
    )).rows[0].id;
    const archivedVehicle = (await fresh.client.query(
      "INSERT INTO vehicles(user_id,vehicle_type,chassis_number,archived_at) VALUES ($1,'car',$2,clock_timestamp()) RETURNING id",
      [userId, `DELETE-ARCHIVED-${suffix}`]
    )).rows[0].id;
    await fresh.client.query(
      "INSERT INTO maintenances(user_id,vehicle_id,maintenance_type) VALUES ($1,$2,'active-history'),($1,$3,'archived-history')",
      [userId, activeVehicle, archivedVehicle]
    );
    await fresh.client.query(
      "INSERT INTO costs(user_id,vehicle_id,category,amount,cost_date) VALUES ($1,$2,'active-history',1,CURRENT_DATE),($1,$3,'archived-history',1,CURRENT_DATE)",
      [userId, activeVehicle, archivedVehicle]
    );
    await fresh.client.query("DELETE FROM users WHERE id=$1", [userId]);
    assert.equal((await fresh.client.query("SELECT count(*)::int AS count FROM vehicles WHERE user_id=$1", [userId])).rows[0].count, 0);
    assert.equal((await fresh.client.query("SELECT count(*)::int AS count FROM maintenances WHERE user_id=$1", [userId])).rows[0].count, 0);
    assert.equal((await fresh.client.query("SELECT count(*)::int AS count FROM costs WHERE user_id=$1", [userId])).rows[0].count, 0);
  });
  await t.test("P3a vehicle domain uses owner-scoped detail, PATCH, archive/restore and preserved history", async (vehicleTest) => {
    await require("./vehicle-domain")(vehicleTest, { ...config, database: fresh.name }, fresh.client);
  });
});
