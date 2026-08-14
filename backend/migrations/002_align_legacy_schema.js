async function addConstraint(db, table, name, expression) {
  await db.query(`DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = '${name}'
          AND conrelid = '${table}'::regclass
      ) THEN
        ALTER TABLE ${table} ADD CONSTRAINT ${name} CHECK (${expression});
      END IF;
    END $$`);
}

async function up(db) {
  await db.query(
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS account_type VARCHAR(20) NOT NULL DEFAULT 'individual'"
  );
  await db.query(
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified SMALLINT NOT NULL DEFAULT 0"
  );
  await db.query(
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP"
  );
  await db.query(
    "ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP"
  );
  await db.query(
    "ALTER TABLE maintenances ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP"
  );
  await db.query(
    "ALTER TABLE costs ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP"
  );

  await db.query(
    "CREATE UNIQUE INDEX IF NOT EXISTS uq_vehicles_user_chassis ON vehicles (user_id, chassis_number)"
  );
  await db.query(
    "CREATE INDEX IF NOT EXISTS idx_costs_user_date ON costs (user_id, cost_date)"
  );

  await addConstraint(
    db,
    "vehicles",
    "chk_vehicles_mileage",
    "current_mileage IS NULL OR current_mileage >= 0"
  );
  await addConstraint(
    db,
    "maintenances",
    "chk_maint_last_mileage",
    "last_mileage IS NULL OR last_mileage >= 0"
  );
  await addConstraint(
    db,
    "maintenances",
    "chk_maint_next_mileage",
    "next_mileage IS NULL OR next_mileage >= 0"
  );
  await addConstraint(
    db,
    "maintenances",
    "chk_maint_notification_days",
    "notification_days BETWEEN 0 AND 365"
  );
  await addConstraint(db, "costs", "chk_costs_amount", "amount > 0");
  await addConstraint(
    db,
    "interest_requests",
    "chk_interest_fleet_size",
    "fleet_size IS NULL OR fleet_size > 0"
  );
}

module.exports = { up };
