async function up(db) {
  const statements = [
    `CREATE TABLE IF NOT EXISTS companies (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      name VARCHAR(100) NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      INDEX idx_companies_name (name)
    ) ENGINE=InnoDB`,

    `CREATE TABLE IF NOT EXISTS users (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      username VARCHAR(50) NOT NULL,
      password VARCHAR(255) NOT NULL,
      full_name VARCHAR(100) NULL,
      email VARCHAR(100) NULL,
      user_number VARCHAR(50) NULL,
      role VARCHAR(20) NOT NULL DEFAULT 'user',
      company_id BIGINT UNSIGNED NULL,
      account_type VARCHAR(20) NOT NULL DEFAULT 'individual',
      is_active TINYINT(1) NOT NULL DEFAULT 1,
      email_verified TINYINT(1) NOT NULL DEFAULT 0,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_users_username (username),
      UNIQUE KEY uq_users_email (email),
      CONSTRAINT fk_users_company FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE SET NULL
    ) ENGINE=InnoDB`,

    `CREATE TABLE IF NOT EXISTS vehicles (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      user_id BIGINT UNSIGNED NOT NULL,
      vehicle_type VARCHAR(100) NOT NULL,
      chassis_number VARCHAR(50) NOT NULL,
      model VARCHAR(100) NULL,
      year INT NULL,
      current_mileage INT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_vehicles_user_chassis (user_id, chassis_number),
      INDEX idx_vehicles_user (user_id),
      CONSTRAINT fk_vehicles_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      CONSTRAINT chk_vehicles_mileage CHECK (current_mileage IS NULL OR current_mileage >= 0)
    ) ENGINE=InnoDB`,

    `CREATE TABLE IF NOT EXISTS maintenances (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      user_id BIGINT UNSIGNED NOT NULL,
      vehicle_id BIGINT UNSIGNED NOT NULL,
      maintenance_type VARCHAR(100) NOT NULL,
      last_date DATE NULL,
      next_date DATE NULL,
      last_mileage INT NULL,
      next_mileage INT NULL,
      notification_days INT NOT NULL DEFAULT 7,
      status VARCHAR(20) NOT NULL DEFAULT 'pending',
      notes TEXT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      INDEX idx_maint_user_vehicle (user_id, vehicle_id),
      INDEX idx_maint_next_date (next_date),
      CONSTRAINT fk_maint_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      CONSTRAINT fk_maint_vehicle FOREIGN KEY (vehicle_id) REFERENCES vehicles(id) ON DELETE CASCADE,
      CONSTRAINT chk_maint_last_mileage CHECK (last_mileage IS NULL OR last_mileage >= 0),
      CONSTRAINT chk_maint_next_mileage CHECK (next_mileage IS NULL OR next_mileage >= 0),
      CONSTRAINT chk_maint_notification_days CHECK (notification_days BETWEEN 0 AND 365)
    ) ENGINE=InnoDB`,

    `CREATE TABLE IF NOT EXISTS costs (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      user_id BIGINT UNSIGNED NOT NULL,
      vehicle_id BIGINT UNSIGNED NOT NULL,
      category VARCHAR(100) NOT NULL,
      amount DECIMAL(12,2) NOT NULL,
      cost_date DATE NOT NULL,
      description TEXT NULL,
      receipt_number VARCHAR(100) NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      INDEX idx_costs_user_vehicle (user_id, vehicle_id),
      INDEX idx_costs_user_date (user_id, cost_date),
      CONSTRAINT fk_costs_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      CONSTRAINT fk_costs_vehicle FOREIGN KEY (vehicle_id) REFERENCES vehicles(id) ON DELETE CASCADE,
      CONSTRAINT chk_costs_amount CHECK (amount > 0)
    ) ENGINE=InnoDB`,

    `CREATE TABLE IF NOT EXISTS interest_requests (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      full_name VARCHAR(100) NOT NULL,
      email VARCHAR(100) NOT NULL,
      phone VARCHAR(30) NULL,
      company_name VARCHAR(100) NULL,
      fleet_size INT NULL,
      message TEXT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      CONSTRAINT chk_interest_fleet_size CHECK (fleet_size IS NULL OR fleet_size > 0)
    ) ENGINE=InnoDB`,

    `CREATE TABLE IF NOT EXISTS refresh_tokens (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      user_id BIGINT UNSIGNED NOT NULL,
      token_hash CHAR(64) NOT NULL,
      expires_at DATETIME NOT NULL,
      revoked_at DATETIME NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_refresh_token_hash (token_hash),
      INDEX idx_refresh_user_active (user_id, revoked_at),
      CONSTRAINT fk_refresh_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB`,

    `CREATE TABLE IF NOT EXISTS email_verification_codes (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      user_id BIGINT UNSIGNED NOT NULL,
      code_hash CHAR(64) NOT NULL,
      expires_at DATETIME NOT NULL,
      used_at DATETIME NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      INDEX idx_email_verification_lookup (user_id, code_hash, used_at, expires_at),
      CONSTRAINT fk_email_verification_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB`,

    `CREATE TABLE IF NOT EXISTS verification_codes (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      user_id BIGINT UNSIGNED NOT NULL,
      code_hash CHAR(64) NOT NULL,
      purpose VARCHAR(50) NOT NULL,
      expires_at DATETIME NOT NULL,
      used_at DATETIME NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      INDEX idx_verification_lookup (user_id, purpose, code_hash, used_at, expires_at),
      CONSTRAINT fk_verification_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB`,

    `CREATE TABLE IF NOT EXISTS password_reset_codes (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      user_id BIGINT UNSIGNED NOT NULL,
      code_hash CHAR(64) NOT NULL,
      expires_at DATETIME NOT NULL,
      used_at DATETIME NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      INDEX idx_password_reset_lookup (user_id, code_hash, used_at, expires_at),
      CONSTRAINT fk_password_reset_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB`,

    `CREATE TABLE IF NOT EXISTS notification_recipients (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      user_id BIGINT UNSIGNED NOT NULL,
      type VARCHAR(20) NOT NULL DEFAULT 'email',
      value VARCHAR(120) NOT NULL,
      is_active TINYINT(1) NOT NULL DEFAULT 1,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_recipient_unique (user_id, type, value),
      INDEX idx_recipient_user (user_id),
      CONSTRAINT fk_recipient_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      CONSTRAINT chk_recipient_type CHECK (type IN ('email', 'phone'))
    ) ENGINE=InnoDB`,
  ];

  for (const statement of statements) {
    await db.query(statement);
  }
}

module.exports = { up };
