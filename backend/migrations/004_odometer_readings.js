async function assertZero(db, sql, message) {
  const [rows] = await db.query(sql);
  if (Number(rows[0]?.count) !== 0) throw new Error(message);
}

async function up(db) {
  await db.query(`ALTER TABLE vehicles
    ADD CONSTRAINT uq_vehicles_id_user UNIQUE (id, user_id)`);

  await db.query(`CREATE TABLE odometer_readings (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL,
    vehicle_id BIGINT NOT NULL,
    mileage_km INTEGER NOT NULL,
    occurred_on DATE,
    source VARCHAR(32) NOT NULL,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    voided_at TIMESTAMPTZ,
    void_reason TEXT,
    replaces_reading_id BIGINT,
    CONSTRAINT uq_odometer_readings_scope UNIQUE (id, vehicle_id, user_id),
    CONSTRAINT chk_odometer_readings_mileage CHECK (mileage_km >= 0),
    CONSTRAINT chk_odometer_readings_source CHECK (
      source IN ('manual', 'legacy_baseline', 'inspection', 'maintenance')
    ),
    CONSTRAINT chk_odometer_readings_occurrence CHECK (
      (source = 'legacy_baseline' AND occurred_on IS NULL)
      OR (source <> 'legacy_baseline' AND occurred_on IS NOT NULL)
    ),
    CONSTRAINT chk_odometer_readings_notes_length CHECK (
      notes IS NULL OR char_length(notes) <= 2000
    ),
    CONSTRAINT chk_odometer_readings_void_state CHECK (
      (voided_at IS NULL AND void_reason IS NULL)
      OR (
        voided_at IS NOT NULL
        AND void_reason IS NOT NULL
        AND char_length(btrim(void_reason)) BETWEEN 1 AND 500
      )
    ),
    CONSTRAINT chk_odometer_readings_not_self_replacement CHECK (
      replaces_reading_id IS NULL OR replaces_reading_id <> id
    ),
    CONSTRAINT fk_odometer_readings_vehicle_owner
      FOREIGN KEY (vehicle_id, user_id)
      REFERENCES vehicles (id, user_id)
      ON UPDATE NO ACTION
      ON DELETE CASCADE,
    CONSTRAINT fk_odometer_readings_replaces
      FOREIGN KEY (replaces_reading_id, vehicle_id, user_id)
      REFERENCES odometer_readings (id, vehicle_id, user_id)
      ON UPDATE NO ACTION
      ON DELETE NO ACTION
      DEFERRABLE INITIALLY DEFERRED
  )`);

  await db.query(`CREATE INDEX idx_odometer_readings_vehicle_history
    ON odometer_readings (
      user_id,
      vehicle_id,
      occurred_on DESC NULLS LAST,
      created_at DESC,
      id DESC
    )`);
  await db.query(`CREATE INDEX idx_odometer_readings_vehicle_current
    ON odometer_readings (
      user_id,
      vehicle_id,
      occurred_on DESC,
      created_at DESC,
      id DESC
    )
    WHERE voided_at IS NULL AND occurred_on IS NOT NULL`);
  await db.query(`CREATE UNIQUE INDEX uq_odometer_readings_active_vehicle_day
    ON odometer_readings (user_id, vehicle_id, occurred_on)
    WHERE voided_at IS NULL AND occurred_on IS NOT NULL`);
  await db.query(`CREATE UNIQUE INDEX uq_odometer_readings_active_legacy_baseline
    ON odometer_readings (user_id, vehicle_id)
    WHERE source = 'legacy_baseline' AND voided_at IS NULL`);
  await db.query(`CREATE UNIQUE INDEX uq_odometer_readings_replacement
    ON odometer_readings (replaces_reading_id)
    WHERE replaces_reading_id IS NOT NULL`);

  await db.query(`INSERT INTO odometer_readings
      (user_id, vehicle_id, mileage_km, occurred_on, source, notes)
    SELECT v.user_id, v.id, v.current_mileage, NULL, 'legacy_baseline', NULL
    FROM vehicles v
    WHERE v.current_mileage IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM odometer_readings r
        WHERE r.user_id = v.user_id
          AND r.vehicle_id = v.id
          AND r.source = 'legacy_baseline'
          AND r.voided_at IS NULL
      )`);

  await assertZero(db, `SELECT count(*)::int AS count
    FROM vehicles v
    LEFT JOIN odometer_readings r
      ON r.vehicle_id = v.id
     AND r.user_id = v.user_id
     AND r.source = 'legacy_baseline'
     AND r.voided_at IS NULL
    WHERE v.current_mileage IS NOT NULL AND r.id IS NULL`, "Odometer baseline coverage validation failed");
  await assertZero(db, `SELECT count(*)::int AS count
    FROM vehicles v
    JOIN odometer_readings r
      ON r.vehicle_id = v.id
     AND r.user_id = v.user_id
     AND r.source = 'legacy_baseline'
     AND r.voided_at IS NULL
    WHERE v.current_mileage IS DISTINCT FROM r.mileage_km`, "Odometer baseline value validation failed");
  await assertZero(db, `SELECT count(*)::int AS count
    FROM vehicles v
    JOIN odometer_readings r
      ON r.vehicle_id = v.id
     AND r.user_id = v.user_id
     AND r.source = 'legacy_baseline'
     AND r.voided_at IS NULL
    WHERE v.current_mileage IS NULL`, "Odometer null mileage validation failed");
  await assertZero(db, `SELECT count(*)::int AS count
    FROM odometer_readings
    WHERE source = 'legacy_baseline'
      AND (
        occurred_on IS NOT NULL
        OR voided_at IS NOT NULL
        OR void_reason IS NOT NULL
        OR replaces_reading_id IS NOT NULL
      )`, "Odometer baseline shape validation failed");
  await assertZero(db, `SELECT count(*)::int AS count
    FROM odometer_readings r
    LEFT JOIN vehicles v
      ON v.id = r.vehicle_id AND v.user_id = r.user_id
    WHERE v.id IS NULL`, "Odometer ownership validation failed");
  await assertZero(db, `SELECT count(*)::int AS count
    FROM (
      SELECT
        (SELECT count(*) FROM vehicles WHERE current_mileage IS NOT NULL) AS vehicle_count,
        (SELECT count(*) FROM odometer_readings
          WHERE source = 'legacy_baseline' AND voided_at IS NULL) AS baseline_count
    ) counts
    WHERE vehicle_count <> baseline_count`, "Odometer baseline cardinality validation failed");
}

module.exports = { up };
