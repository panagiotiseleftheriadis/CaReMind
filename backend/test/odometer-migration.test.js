const assert = require("node:assert/strict");
const test = require("node:test");
const migration = require("../migrations/004_odometer_readings");

test("004 uses fail-closed DDL and the locked odometer schema", async () => {
  const statements = [];
  await migration.up({
    async query(sql) {
      statements.push(String(sql));
      if (/^SELECT count\(\*\)::int AS count/i.test(String(sql).trim())) return [[{ count: 0 }], []];
      return [[], []];
    },
  });
  const source = statements.join("\n");
  assert.match(source, /ALTER TABLE vehicles\s+ADD CONSTRAINT uq_vehicles_id_user UNIQUE \(id, user_id\)/);
  assert.match(source, /CREATE TABLE odometer_readings \(/);
  assert.doesNotMatch(source, /CREATE TABLE IF NOT EXISTS odometer_readings/i);
  assert.doesNotMatch(source, /CREATE (?:UNIQUE )?INDEX IF NOT EXISTS/i);
  for (const field of ["id BIGSERIAL PRIMARY KEY", "user_id BIGINT NOT NULL", "vehicle_id BIGINT NOT NULL", "mileage_km INTEGER NOT NULL", "occurred_on DATE", "source VARCHAR(32) NOT NULL", "notes TEXT", "created_at TIMESTAMPTZ NOT NULL", "voided_at TIMESTAMPTZ", "void_reason TEXT", "replaces_reading_id BIGINT"]) assert.equal(source.includes(field), true, field);
  assert.match(source, /FOREIGN KEY \(vehicle_id, user_id\)[\s\S]*REFERENCES vehicles \(id, user_id\)[\s\S]*ON DELETE CASCADE/);
  assert.match(source, /FOREIGN KEY \(replaces_reading_id, vehicle_id, user_id\)[\s\S]*DEFERRABLE INITIALLY DEFERRED/);
  for (const name of ["idx_odometer_readings_vehicle_history", "idx_odometer_readings_vehicle_current", "uq_odometer_readings_active_vehicle_day", "uq_odometer_readings_active_legacy_baseline", "uq_odometer_readings_replacement"]) assert.match(source, new RegExp(name));
  assert.match(source, /v\.current_mileage IS NOT NULL/);
  assert.doesNotMatch(source, /maintenances|last_mileage|next_mileage/);
});

test("004 aborts when a migration validation assertion is nonzero", async () => {
  let validation = 0;
  await assert.rejects(
    migration.up({
      async query(sql) {
        if (/^SELECT count\(\*\)::int AS count/i.test(String(sql).trim())) {
          validation += 1;
          return [[{ count: validation === 2 ? 1 : 0 }], []];
        }
        return [[], []];
      },
    }),
    /Odometer baseline value validation failed/
  );
});
