const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const path = require("node:path");
const test = require("node:test");
const {
  athensDateAt,
  validateOccurredOn,
  validateChronology,
  assertExpectedVehicleRevision,
  assertReadingAllowedForVehicle,
  selectAuthoritativeReading,
  deriveAuthoritativeCurrentMileage,
  mediateLegacyCurrentMileage,
} = require("../odometer-domain");

function executor({ dated = [], baseline = [] } = {}) {
  return {
    async query(sql) {
      if (String(sql).includes("occurred_on IS NOT NULL")) return [dated, []];
      if (String(sql).includes("source = 'legacy_baseline'")) return [baseline, []];
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
}

test("Athens business date handles winter, summer and DST boundaries", () => {
  assert.equal(athensDateAt("2026-01-14T21:59:59Z"), "2026-01-14");
  assert.equal(athensDateAt("2026-01-14T22:00:00Z"), "2026-01-15");
  assert.equal(athensDateAt("2026-07-14T20:59:59Z"), "2026-07-14");
  assert.equal(athensDateAt("2026-07-14T21:00:00Z"), "2026-07-15");
  assert.equal(athensDateAt("2026-03-29T00:59:59Z"), "2026-03-29");
  assert.equal(athensDateAt("2026-03-29T01:00:00Z"), "2026-03-29");
  assert.equal(athensDateAt("2026-10-25T00:59:59Z"), "2026-10-25");
  assert.equal(athensDateAt("2026-10-25T01:00:00Z"), "2026-10-25");
});

test("Athens date is independent of the Node host timezone", () => {
  const modulePath = path.resolve(__dirname, "../odometer-domain.js");
  const script = `process.stdout.write(require(${JSON.stringify(modulePath)}).athensDateAt('2026-07-14T21:00:00Z'))`;
  for (const TZ of ["UTC", "America/Los_Angeles", "Pacific/Auckland"]) {
    assert.equal(execFileSync(process.execPath, ["-e", script], { env: { ...process.env, TZ }, encoding: "utf8" }), "2026-07-15");
  }
});

test("occurred_on is strict, Gregorian and not future in Athens", () => {
  const clock = () => new Date("2026-01-14T22:30:00Z");
  assert.equal(validateOccurredOn("2026-01-15", { clock }), "2026-01-15");
  for (const invalid of ["2026-01-16", "2026-02-30", "2026-1-15", "15-01-2026", null]) {
    assert.throws(() => validateOccurredOn(invalid, { clock }), (error) => ["FUTURE_ODOMETER_DATE", "INVALID_ODOMETER_DATE"].includes(error.body.code));
  }
});

test("authoritative mileage selects dated evidence before baseline without MAX", async () => {
  const baseline = [{ id: 1, mileageKm: 900000, occurredOn: null, source: "legacy_baseline" }];
  const dated = [{ id: 2, mileageKm: 42000, occurredOn: "2026-08-01", source: "manual" }];
  assert.deepEqual(await selectAuthoritativeReading(executor({ dated, baseline }), 1, 7), dated[0]);
  assert.equal(await deriveAuthoritativeCurrentMileage(executor({ dated, baseline }), 1, 7), 42000);
  assert.equal(await deriveAuthoritativeCurrentMileage(executor({ baseline }), 1, 7), 900000);
  assert.equal(await deriveAuthoritativeCurrentMileage(executor(), 1, 7), null);
});

test("chronology accepts equal and consistent backdated mileage and rejects conflicts", () => {
  assert.equal(validateChronology(150, { previous: { mileageKm: 100 }, next: { mileageKm: 200 } }), 150);
  assert.equal(validateChronology(100, { previous: { mileageKm: 100 }, next: { mileageKm: 200 } }), 100);
  for (const invalid of [null, "100", 1.5, -1, 2147483648]) assert.throws(() => validateChronology(invalid));
  assert.throws(() => validateChronology(99, { previous: { mileageKm: 100 } }), (error) => error.body.code === "ODOMETER_RESET_UNSUPPORTED");
  assert.throws(() => validateChronology(201, { previous: { mileageKm: 100 }, next: { mileageKm: 200 } }), (error) => error.body.code === "ODOMETER_READING_CONFLICT");
  assert.throws(() => validateChronology(99, { previous: { mileageKm: 100 }, next: { mileageKm: 200 } }), (error) => error.body.code === "ODOMETER_READING_CONFLICT");
});

test("revision and archived-vehicle foundations fail closed", () => {
  assert.doesNotThrow(() => assertExpectedVehicleRevision({ revision: 3 }, 3));
  assert.throws(() => assertExpectedVehicleRevision({ revision: 3 }, 2), (error) => error.body.code === "VEHICLE_REVISION_CONFLICT");
  assert.throws(() => assertExpectedVehicleRevision({ revision: 3 }, "bad"), (error) => error.body.code === "INVALID_VEHICLE_REVISION");
  assert.throws(() => assertExpectedVehicleRevision({ revision: 3 }, "3"), (error) => error.body.code === "INVALID_VEHICLE_REVISION");
  assert.throws(() => assertReadingAllowedForVehicle({ archivedAt: "2026-01-01T00:00:00Z" }), (error) => error.body.code === "VEHICLE_ARCHIVED");
  assert.doesNotThrow(() => assertReadingAllowedForVehicle({ archivedAt: "2026-01-01T00:00:00Z" }, { correction: true }));
});

function legacyConnection({ cache = null, dated = null, baseline = null } = {}) {
  const state = { cache, dated, baseline, rows: baseline ? [{ ...baseline, voided: false }] : [], nextId: 50 };
  return {
    state,
    async query(sql, params = []) {
      const text = String(sql);
      if (text.includes("occurred_on IS NOT NULL")) return [state.dated ? [state.dated] : [], []];
      if (text.includes("source = 'legacy_baseline'") && text.includes("SELECT")) {
        const active = state.rows.find((row) => !row.voided);
        return [active ? [active] : [], []];
      }
      if (text.startsWith("UPDATE odometer_readings")) {
        const row = state.rows.find((item) => Number(item.id) === Number(params[0]));
        row.voided = true;
        return [{ affectedRows: 1 }, []];
      }
      if (text.includes("INSERT INTO odometer_readings")) {
        const row = { id: state.nextId++, mileageKm: Number(params[2]), replacesReadingId: params[3], voided: false };
        state.rows.push(row);
        return [{ insertId: row.id, affectedRows: 1 }, []];
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
}

test("legacy mileage mediation preserves baseline audit and enforces dated authority", async () => {
  const connection = legacyConnection({ cache: 100, baseline: { id: 10, mileageKm: 100 } });
  const vehicle = { id: 7, currentMileage: 100 };
  const unchanged = await mediateLegacyCurrentMileage(connection, { userId: 1, vehicle, requestedMileage: 100 });
  assert.deepEqual(unchanged, { cacheMileage: 100, evidenceChanged: false, cacheChanged: false });

  const changed = await mediateLegacyCurrentMileage(connection, { userId: 1, vehicle, requestedMileage: 120 });
  assert.equal(changed.cacheMileage, 120);
  assert.equal(changed.evidenceChanged, true);
  assert.equal(connection.state.rows[0].voided, true);
  assert.equal(connection.state.rows[1].replacesReadingId, 10);

  const cleared = await mediateLegacyCurrentMileage(connection, { userId: 1, vehicle: { ...vehicle, currentMileage: 120 }, requestedMileage: null });
  assert.equal(cleared.cacheMileage, null);
  assert.equal(connection.state.rows.every((row) => row.voided), true);

  const dated = legacyConnection({ cache: 500, dated: { id: 30, mileageKm: 500, occurredOn: "2026-09-01" } });
  assert.equal((await mediateLegacyCurrentMileage(dated, { userId: 1, vehicle: { id: 7, currentMileage: 500 }, requestedMileage: 500 })).evidenceChanged, false);
  for (const value of [499, 501, null]) {
    await assert.rejects(
      mediateLegacyCurrentMileage(dated, { userId: 1, vehicle: { id: 7, currentMileage: 500 }, requestedMileage: value }),
      (error) => error.body.code === "ODOMETER_HISTORY_REQUIRED"
    );
  }
});
