require("dotenv").config();

const bcrypt = require("bcrypt");
const db = require("../db");

async function seed() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Development seed is disabled in production");
  }

  const username = String(process.env.DEV_ADMIN_USERNAME || "").trim();
  const email = String(process.env.DEV_ADMIN_EMAIL || "").trim().toLowerCase();
  const password = String(process.env.DEV_ADMIN_PASSWORD || "");

  if (!username || !email || password.length < 12) {
    throw new Error(
      "Set DEV_ADMIN_USERNAME, DEV_ADMIN_EMAIL and a DEV_ADMIN_PASSWORD of at least 12 characters"
    );
  }

  const passwordHash = await bcrypt.hash(password, 12);
  await db.query(
    `INSERT INTO users
       (username, password, full_name, email, role, account_type, is_active, email_verified)
     VALUES (?, ?, 'Development Administrator', ?, 'admin', 'individual', 1, 1)
     ON DUPLICATE KEY UPDATE password = VALUES(password), role = 'admin', is_active = 1, email_verified = 1`,
    [username, passwordHash, email]
  );

  console.log(`Development administrator ready: ${username}`);
}

seed()
  .catch((error) => {
    console.error("Development seed failed:", error.message);
    process.exitCode = 1;
  })
  .finally(() => db.end());
