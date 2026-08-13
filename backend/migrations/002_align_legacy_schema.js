async function columnExists(db, table, column) {
  const [rows] = await db.query(
    `SELECT 1 FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?`,
    [table, column]
  );
  return rows.length > 0;
}

async function indexExists(db, table, index) {
  const [rows] = await db.query(
    `SELECT 1 FROM information_schema.statistics
     WHERE table_schema = DATABASE() AND table_name = ? AND index_name = ?`,
    [table, index]
  );
  return rows.length > 0;
}

async function constraintExists(db, table, constraint) {
  const [rows] = await db.query(
    `SELECT 1 FROM information_schema.table_constraints
     WHERE constraint_schema = DATABASE() AND table_name = ? AND constraint_name = ?`,
    [table, constraint]
  );
  return rows.length > 0;
}

async function addColumn(db, table, column, definition) {
  if (!(await columnExists(db, table, column))) {
    await db.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${definition}`);
  }
}

async function addIndex(db, table, name, expression, unique = false) {
  if (!(await indexExists(db, table, name))) {
    await db.query(
      `ALTER TABLE \`${table}\` ADD ${unique ? "UNIQUE " : ""}INDEX \`${name}\` ${expression}`
    );
  }
}

async function addCheck(db, table, name, expression) {
  if (!(await constraintExists(db, table, name))) {
    await db.query(`ALTER TABLE \`${table}\` ADD CONSTRAINT \`${name}\` CHECK (${expression})`);
  }
}

async function up(db) {
  await addColumn(db, "users", "account_type", "VARCHAR(20) NOT NULL DEFAULT 'individual'");
  await addColumn(db, "users", "email_verified", "TINYINT(1) NOT NULL DEFAULT 0");
  await addColumn(db, "users", "updated_at", "TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP");
  await addColumn(db, "vehicles", "updated_at", "TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP");
  await addColumn(db, "maintenances", "updated_at", "TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP");
  await addColumn(db, "costs", "updated_at", "TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP");

  await addIndex(db, "vehicles", "uq_vehicles_user_chassis", "(user_id, chassis_number)", true);
  await addIndex(db, "costs", "idx_costs_user_date", "(user_id, cost_date)");

  await addCheck(db, "vehicles", "chk_vehicles_mileage", "current_mileage IS NULL OR current_mileage >= 0");
  await addCheck(db, "maintenances", "chk_maint_last_mileage", "last_mileage IS NULL OR last_mileage >= 0");
  await addCheck(db, "maintenances", "chk_maint_next_mileage", "next_mileage IS NULL OR next_mileage >= 0");
  await addCheck(db, "maintenances", "chk_maint_notification_days", "notification_days BETWEEN 0 AND 365");
  await addCheck(db, "costs", "chk_costs_amount", "amount > 0");
  await addCheck(db, "interest_requests", "chk_interest_fleet_size", "fleet_size IS NULL OR fleet_size > 0");
}

module.exports = { up };
