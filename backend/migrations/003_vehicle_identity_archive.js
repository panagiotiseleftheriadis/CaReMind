async function addConstraint(db, name, expression) {
  await db.query(`DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = '${name}'
          AND conrelid = 'vehicles'::regclass
      ) THEN
        ALTER TABLE vehicles ADD CONSTRAINT ${name} CHECK (${expression}) NOT VALID;
      END IF;
    END $$`);
  await db.query(`ALTER TABLE vehicles VALIDATE CONSTRAINT ${name}`);
}

async function up(db) {
  await db.query(`ALTER TABLE vehicles
    ADD COLUMN IF NOT EXISTS registration_plate VARCHAR(32),
    ADD COLUMN IF NOT EXISTS registration_country CHAR(2),
    ADD COLUMN IF NOT EXISTS make VARCHAR(100),
    ADD COLUMN IF NOT EXISTS vin VARCHAR(50),
    ADD COLUMN IF NOT EXISTS fuel_type VARCHAR(30),
    ADD COLUMN IF NOT EXISTS purchase_date DATE,
    ADD COLUMN IF NOT EXISTS purchase_amount NUMERIC(12,2),
    ADD COLUMN IF NOT EXISTS currency CHAR(3),
    ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS revision INTEGER NOT NULL DEFAULT 1`);

  await addConstraint(
    db,
    "chk_vehicles_purchase_amount",
    "purchase_amount IS NULL OR purchase_amount >= 0"
  );
  await addConstraint(
    db,
    "chk_vehicles_registration_country",
    "registration_country IS NULL OR registration_country ~ '^[A-Z]{2}$'"
  );
  await addConstraint(
    db,
    "chk_vehicles_currency",
    "currency IS NULL OR currency ~ '^[A-Z]{3}$'"
  );
  await addConstraint(db, "chk_vehicles_revision", "revision > 0");

  await db.query(`CREATE INDEX IF NOT EXISTS idx_vehicles_user_active
    ON vehicles (user_id, id)
    WHERE archived_at IS NULL`);
}

module.exports = { up };
