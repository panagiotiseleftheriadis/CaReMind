-- =========================================
-- 1. Δημιουργία βάσης
-- =========================================
CREATE DATABASE IF NOT EXISTS carcare
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_general_ci;

USE carcare;

-- =========================================
-- 2. Καθαρισμός (αν υπάρχουν παλιοί πίνακες)
--    ΠΡΟΣΟΧΗ: θα σβήσει ό,τι δεδομένα υπήρχαν!
-- =========================================
DROP TABLE IF EXISTS costs;
DROP TABLE IF EXISTS maintenances;
DROP TABLE IF EXISTS vehicles;
DROP TABLE IF EXISTS interest_requests;
DROP TABLE IF EXISTS users;
DROP TABLE IF EXISTS companies;

-- =========================================
-- 3. Πίνακας εταιρειών (companies)
-- =========================================
CREATE TABLE companies (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name        VARCHAR(100) NOT NULL,
  created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) ENGINE=InnoDB;

-- =========================================
-- 4. Πίνακας χρηστών (users)
--    προς το παρόν κρατάμε τον κωδικό "χύμα"
--    σε πεδίο password για απλότητα στο project
--    (μετά μπορούμε να βάλουμε hashing στο backend)
-- =========================================
CREATE TABLE users (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  username    VARCHAR(50) NOT NULL UNIQUE,
  password    VARCHAR(255) NOT NULL,
  full_name   VARCHAR(100),
  email       VARCHAR(100) UNIQUE,
  user_number VARCHAR(50),
  role        VARCHAR(20) NOT NULL DEFAULT 'user',  -- 'admin', 'user', 'guest'
  company_id  BIGINT UNSIGNED NULL,
  is_active   TINYINT(1) NOT NULL DEFAULT 1,
  created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  CONSTRAINT fk_users_company
    FOREIGN KEY (company_id) REFERENCES companies(id)
    ON DELETE SET NULL
) ENGINE=InnoDB;



-- =========================================
-- 5. Πίνακας οχημάτων (vehicles)
-- =========================================
CREATE TABLE vehicles (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id         BIGINT UNSIGNED NOT NULL,
  vehicle_type    VARCHAR(100) NOT NULL,     -- π.χ. "Επιβατικό", "Φορτηγό"
  chassis_number  VARCHAR(50) NOT NULL,      -- αριθμός πλαισίου
  model           VARCHAR(100),              -- μάρκα/μοντέλο μαζί ή μόνο μοντέλο
  year            INT,
  current_mileage INT,
  created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  CONSTRAINT fk_vehicles_user
    FOREIGN KEY (user_id) REFERENCES users(id)
    ON DELETE CASCADE,
  INDEX idx_vehicles_user (user_id)
) ENGINE=InnoDB;

-- =========================================
-- 6. Πίνακας συντηρήσεων (maintenances)
--    Ακολουθώ τη λογική που χρησιμοποιείς στο maintenance.js:
--    lastDate, nextDate, lastMileage, nextMileage, notificationDays, status, notes
-- =========================================
CREATE TABLE maintenances (
  id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id             BIGINT UNSIGNED NOT NULL,
  vehicle_id          BIGINT UNSIGNED NOT NULL,
  maintenance_type    VARCHAR(100) NOT NULL,   -- π.χ. "ΚΤΕΟ", "Λάδια", "Ασφάλεια"
  last_date           DATE,
  next_date           DATE,
  last_mileage        INT,
  next_mileage        INT,
  notification_days   INT DEFAULT 7,
  status              VARCHAR(20) NOT NULL DEFAULT 'active', -- 'active', 'completed', 'overdue' κλπ
  notes               TEXT,
  created_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  CONSTRAINT fk_maint_user
    FOREIGN KEY (user_id) REFERENCES users(id)
    ON DELETE CASCADE,
  CONSTRAINT fk_maint_vehicle
    FOREIGN KEY (vehicle_id) REFERENCES vehicles(id)
    ON DELETE CASCADE,
  INDEX idx_maint_user_vehicle (user_id, vehicle_id),
  INDEX idx_maint_next_date (next_date)
) ENGINE=InnoDB;

-- =========================================
-- 7. Πίνακας κόστους (costs)
--    Σύμφωνα με το costs.html / costs_patched.js:
--    vehicleId, category, amount, date, description, receiptNumber
-- =========================================
CREATE TABLE costs (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id         BIGINT UNSIGNED NOT NULL,
  vehicle_id      BIGINT UNSIGNED NOT NULL,
  category        VARCHAR(100) NOT NULL,   -- π.χ. 'ΚΤΕΟ', 'Λάδια', 'Ασφάλεια'
  amount          DECIMAL(10,2) NOT NULL,
  cost_date       DATE NOT NULL,
  description     TEXT,
  receipt_number  VARCHAR(100),
  created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  CONSTRAINT fk_costs_user
    FOREIGN KEY (user_id) REFERENCES users(id)
    ON DELETE CASCADE,
  CONSTRAINT fk_costs_vehicle
    FOREIGN KEY (vehicle_id) REFERENCES vehicles(id)
    ON DELETE CASCADE,
  INDEX idx_costs_user_vehicle (user_id, vehicle_id),
  INDEX idx_costs_date (cost_date)
) ENGINE=InnoDB;

-- =========================================
-- 8. Πίνακας αιτημάτων ενδιαφέροντος (interest_requests)
-- =========================================
CREATE TABLE interest_requests (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  full_name     VARCHAR(100) NOT NULL,
  email         VARCHAR(100) NOT NULL,
  phone         VARCHAR(30),
  company_name  VARCHAR(100),
  fleet_size    INT,
  message       TEXT,
  created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) ENGINE=InnoDB;

-- =========================================
-- 9. Αρχικά δεδομένα: εταιρεία, admin, guest
-- =========================================

-- Μία default εταιρεία (αν θες, άλλαξε το όνομα)
INSERT INTO companies (name)
VALUES ('Default Company');

-- Admin χρήστης (βάλε ό,τι στοιχεία θες)
INSERT INTO users (username, password, full_name, email, role, company_id)
VALUES ('admin', 'admin123', 'Διαχειριστής', 'admin@example.com', 'admin', 1);

-- Guest χρήστης: username = guest, password = guest
INSERT INTO users (username, password, full_name, role, company_id)
VALUES ('guest', 'guest', 'Guest User', 'guest', NULL);
