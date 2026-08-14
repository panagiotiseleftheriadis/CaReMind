async function up(db) {
  const statements = [
    `CREATE TABLE IF NOT EXISTS companies (
      id BIGSERIAL PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE INDEX IF NOT EXISTS idx_companies_name ON companies (name)`,
    `CREATE INDEX IF NOT EXISTS idx_companies_lower_name ON companies (LOWER(name))`,

    `CREATE TABLE IF NOT EXISTS users (
      id BIGSERIAL PRIMARY KEY,
      username VARCHAR(50) NOT NULL,
      password VARCHAR(255) NOT NULL,
      full_name VARCHAR(100),
      email VARCHAR(100),
      user_number VARCHAR(50),
      role VARCHAR(20) NOT NULL DEFAULT 'user',
      company_id BIGINT REFERENCES companies(id) ON DELETE SET NULL,
      account_type VARCHAR(20) NOT NULL DEFAULT 'individual',
      is_active SMALLINT NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
      email_verified SMALLINT NOT NULL DEFAULT 0 CHECK (email_verified IN (0, 1)),
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT uq_users_username UNIQUE (username),
      CONSTRAINT uq_users_email UNIQUE (email)
    )`,

    `CREATE TABLE IF NOT EXISTS vehicles (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      vehicle_type VARCHAR(100) NOT NULL,
      chassis_number VARCHAR(50) NOT NULL,
      model VARCHAR(100),
      year INTEGER,
      current_mileage INTEGER,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT uq_vehicles_user_chassis UNIQUE (user_id, chassis_number),
      CONSTRAINT chk_vehicles_mileage CHECK (current_mileage IS NULL OR current_mileage >= 0)
    )`,
    `CREATE INDEX IF NOT EXISTS idx_vehicles_user ON vehicles (user_id)`,

    `CREATE TABLE IF NOT EXISTS maintenances (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      vehicle_id BIGINT NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
      maintenance_type VARCHAR(100) NOT NULL,
      last_date DATE,
      next_date DATE,
      last_mileage INTEGER,
      next_mileage INTEGER,
      notification_days INTEGER NOT NULL DEFAULT 7,
      status VARCHAR(20) NOT NULL DEFAULT 'pending',
      notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT chk_maint_last_mileage CHECK (last_mileage IS NULL OR last_mileage >= 0),
      CONSTRAINT chk_maint_next_mileage CHECK (next_mileage IS NULL OR next_mileage >= 0),
      CONSTRAINT chk_maint_notification_days CHECK (notification_days BETWEEN 0 AND 365)
    )`,
    `CREATE INDEX IF NOT EXISTS idx_maint_user_vehicle ON maintenances (user_id, vehicle_id)`,
    `CREATE INDEX IF NOT EXISTS idx_maint_next_date ON maintenances (next_date)`,

    `CREATE TABLE IF NOT EXISTS costs (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      vehicle_id BIGINT NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
      category VARCHAR(100) NOT NULL,
      amount NUMERIC(12,2) NOT NULL,
      cost_date DATE NOT NULL,
      description TEXT,
      receipt_number VARCHAR(100),
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT chk_costs_amount CHECK (amount > 0)
    )`,
    `CREATE INDEX IF NOT EXISTS idx_costs_user_vehicle ON costs (user_id, vehicle_id)`,
    `CREATE INDEX IF NOT EXISTS idx_costs_user_date ON costs (user_id, cost_date)`,

    `CREATE TABLE IF NOT EXISTS interest_requests (
      id BIGSERIAL PRIMARY KEY,
      full_name VARCHAR(100) NOT NULL,
      email VARCHAR(100) NOT NULL,
      phone VARCHAR(30),
      company_name VARCHAR(100),
      fleet_size INTEGER,
      message TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT chk_interest_fleet_size CHECK (fleet_size IS NULL OR fleet_size > 0)
    )`,

    `CREATE TABLE IF NOT EXISTS refresh_tokens (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash CHAR(64) NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      revoked_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT uq_refresh_token_hash UNIQUE (token_hash)
    )`,
    `CREATE INDEX IF NOT EXISTS idx_refresh_user_active ON refresh_tokens (user_id, revoked_at)`,

    `CREATE TABLE IF NOT EXISTS email_verification_codes (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      code_hash CHAR(64) NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      used_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE INDEX IF NOT EXISTS idx_email_verification_lookup
      ON email_verification_codes (user_id, code_hash, used_at, expires_at)`,

    `CREATE TABLE IF NOT EXISTS verification_codes (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      code_hash CHAR(64) NOT NULL,
      purpose VARCHAR(50) NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      used_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE INDEX IF NOT EXISTS idx_verification_lookup
      ON verification_codes (user_id, purpose, code_hash, used_at, expires_at)`,

    `CREATE TABLE IF NOT EXISTS password_reset_codes (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      code_hash CHAR(64) NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      used_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE INDEX IF NOT EXISTS idx_password_reset_lookup
      ON password_reset_codes (user_id, code_hash, used_at, expires_at)`,

    `CREATE TABLE IF NOT EXISTS notification_recipients (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type VARCHAR(20) NOT NULL DEFAULT 'email',
      value VARCHAR(120) NOT NULL,
      is_active SMALLINT NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT uq_recipient_unique UNIQUE (user_id, type, value),
      CONSTRAINT chk_recipient_type CHECK (type IN ('email', 'phone'))
    )`,
    `CREATE INDEX IF NOT EXISTS idx_recipient_user ON notification_recipients (user_id)`,

    `CREATE OR REPLACE FUNCTION caremind_set_updated_at()
      RETURNS TRIGGER AS $$
      BEGIN
        NEW.updated_at = CURRENT_TIMESTAMP;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql`,
    `DO $$
      DECLARE target_table TEXT;
      BEGIN
        FOREACH target_table IN ARRAY ARRAY['users', 'vehicles', 'maintenances', 'costs']
        LOOP
          IF NOT EXISTS (
            SELECT 1 FROM pg_trigger
            WHERE tgname = 'trg_' || target_table || '_updated_at'
              AND NOT tgisinternal
          ) THEN
            EXECUTE format(
              'CREATE TRIGGER %I BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION caremind_set_updated_at()',
              'trg_' || target_table || '_updated_at',
              target_table
            );
          END IF;
        END LOOP;
      END $$`,
  ];

  for (const statement of statements) {
    await db.query(statement);
  }
}

module.exports = { up };
