// routes/auth.js
const express = require("express");
const router = express.Router();
const db = require("../db");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const bcrypt = require("bcrypt");
const { JWT_SECRET, authenticateToken } = require("../middleware");
const sendMail = require("../emailService");

// --- CONFIGURATION ---
const COOKIE_OPTIONS = {
  httpOnly: true,
  // Αφού το backend είναι στο Render (HTTPS), το secure ΠΡΕΠΕΙ να είναι true
  secure: true, 
  // Αφού front (car-remind.gr) και back (onrender.com) είναι διαφορετικά, ΠΡΕΠΕΙ να είναι None
  sameSite: "None", 
  path: "/api", // Το cookie ισχύει μόνο για routes που ξεκινάνε με /api
  maxAge: 30 * 24 * 60 * 60 * 1000, // 30 ημέρες
};

// --- HELPER FUNCTIONS ---

function generateRefreshToken() {
  const token = crypto.randomBytes(32).toString("hex");
  const hash = crypto.createHash("sha256").update(token).digest("hex");
  return { token, hash };
}

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function generate6DigitCode() {
  const n = crypto.randomInt(0, 1000000);
  return String(n).padStart(6, "0");
}

function normalizeEmail(v) {
  return String(v || "").trim().toLowerCase();
}

async function getOrCreateCompanyId(companyNameRaw) {
  const name = String(companyNameRaw || "").trim();
  if (!name) return null;
  const [rows] = await db.query(
    "SELECT id, name FROM companies WHERE LOWER(name) = LOWER(?) LIMIT 1",
    [name]
  );
  if (rows.length) return rows[0].id;
  const [ins] = await db.query("INSERT INTO companies (name) VALUES (?)", [name]);
  return ins.insertId;
}

async function createAndSendVerificationCode(user) {
  const code = generate6DigitCode();
  const codeHash = crypto.createHash("sha256").update(code).digest("hex");

  await db.query(
    `INSERT INTO email_verification_codes (user_id, code_hash, expires_at)
     VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 5 MINUTE))`,
    [user.id, codeHash]
  );

  const subject = "CaReMind - Επιβεβαίωση Email";
  const html = `
    <div style="font-family: Arial, sans-serif; line-height:1.5">
      <h2 style="margin:0 0 12px 0">Επιβεβαίωση email</h2>
      <p>Γεια σας <b>${user.username || ""}</b>,</p>
      <p>Ο κωδικός επιβεβαίωσης είναι:</p>
      <div style="font-size:28px; letter-spacing:6px; font-weight:700; padding:12px 16px; background:#f3f6f8; display:inline-block; border-radius:10px;">${code}</div>
      <p>Λήγει σε 5 λεπτά.</p>
    </div>
  `;
  await sendMail(user.email, subject, html);
}

// =============================================================================
// AUTH ROUTES
// =============================================================================

// 1. LOGIN
router.post("/login", async (req, res) => {
  const { username, password } = req.body || {};
  const identifier = (username || "").trim();

  if (!identifier || !password) {
    return res.status(400).json({ error: "Username/Email και password απαιτούνται" });
  }

  try {
    // Εύρεση χρήστη (με username ή email)
    const [found] = await db.query(
      `SELECT users.*, companies.name AS companyName
       FROM users
       LEFT JOIN companies ON users.company_id = companies.id
       WHERE (users.username = ? OR users.email = ?) LIMIT 1`,
      [identifier, identifier]
    );

    if (!found.length) {
      return res.status(401).json({ error: "Λάθος στοιχεία", code: "INVALID_USER" });
    }

    const user = found[0];

    // Έλεγχος Password (υποστήριξη bcrypt & fallback plaintext)
    const stored = String(user.password || "");
    let ok = false;
    if (stored.startsWith("$2a$") || stored.startsWith("$2b$") || stored.startsWith("$2y$")) {
      ok = await bcrypt.compare(password, stored);
    } else {
      ok = stored === password;
    }

    if (!ok) {
      return res.status(401).json({ error: "Λάθος κωδικός", code: "INVALID_PASSWORD" });
    }

    if (!user.is_active) {
      return res.status(403).json({ error: "Ο λογαριασμός είναι απενεργοποιημένος" });
    }

    // Email verification check
    if (user.role !== "admin" && user.role !== "guest" && user.email && String(user.email_verified) !== "1") {
      return res.status(403).json({
        error: "Πρέπει να επιβεβαιώσετε το email σας.",
        code: "EMAIL_NOT_VERIFIED",
        email: user.email,
      });
    }

    // Access Token (JWT) - Μικρή διάρκεια (15 λεπτά)
    const payload = {
      id: user.id,
      username: user.username,
      role: user.role,
      companyId: user.company_id,
      companyName: user.companyName,
    };
    const accessToken = jwt.sign(payload, JWT_SECRET, { expiresIn: "15m" });

    // Refresh Token - Μεγάλη διάρκεια (30 μέρες)
    const { token: refreshToken, hash } = generateRefreshToken();
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30);

    // Αποθήκευση Refresh Token Hash στη βάση
    await db.query(
      `INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES (?, ?, ?)`,
      [user.id, hash, expiresAt]
    );
    console.log("--- DEBUG COOKIE ---");
console.log("Secure connection?", req.secure); // Πρέπει να βγάλει true
console.log("Protocol:", req.protocol);        // Πρέπει να βγάλει https
console.log("Setting cookie with options:", COOKIE_OPTIONS);
    // Αποστολή Cookie (HttpOnly)
    res.cookie("refreshToken", refreshToken, COOKIE_OPTIONS);

    // Επιστροφή απάντησης
    res.json({ accessToken, user: payload });

  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ error: "Σφάλμα διακομιστή κατά το login" });
  }
});

// 2. REFRESH TOKEN
router.post("/refresh", async (req, res) => {
  const refreshToken = req.cookies.refreshToken;
  
  if (!refreshToken) {
    return res.status(401).json({ error: "No refresh token" });
  }

  try {
    const hash = hashToken(refreshToken);

    const [rows] = await db.query(
      `SELECT rt.*, u.username, u.role, u.company_id, u.is_active, c.name as companyName
       FROM refresh_tokens rt
       JOIN users u ON rt.user_id = u.id
       LEFT JOIN companies c ON u.company_id = c.id
       WHERE rt.token_hash = ?`,
      [hash]
    );

    if (!rows.length) {
      res.clearCookie("refreshToken", { path: "/api" });
      return res.status(403).json({ error: "Invalid refresh token" });
    }

    const record = rows[0];

    // Checks: Expired? Revoked? User inactive?
    if (new Date() > new Date(record.expires_at) || record.revoked_at) {
      res.clearCookie("refreshToken", { path: "/api" });
      return res.status(403).json({ error: "Token expired or revoked" });
    }

    if (!record.is_active) {
      return res.status(403).json({ error: "User inactive" });
    }

    // Issue new Access Token
    const payload = {
      id: record.user_id,
      username: record.username,
      role: record.role,
      companyId: record.company_id,
      companyName: record.companyName,
    };

    const newAccessToken = jwt.sign(payload, JWT_SECRET, { expiresIn: "15m" });

    res.json({ accessToken: newAccessToken, user: payload });

  } catch (err) {
    console.error("Refresh error:", err);
    res.status(500).json({ error: "Server error during refresh" });
  }
});

// 3. LOGOUT
router.post("/logout", async (req, res) => {
  const refreshToken = req.cookies.refreshToken;
  
  // Revoke token στη βάση
  if (refreshToken) {
    const hash = hashToken(refreshToken);
    await db.query(
      "UPDATE refresh_tokens SET revoked_at = NOW() WHERE token_hash = ?",
      [hash]
    );
  }

  // Cleanup για Guest χρήστες
  const userId = req.user?.id || (req.body?.user?.id); // Προσπάθεια ανάκτησης ID
  const username = req.user?.username || req.body?.username;
  
  if (username === "guest" && userId) {
      await db.query("DELETE FROM costs WHERE user_id = ?", [userId]);
      await db.query("DELETE FROM maintenances WHERE user_id = ?", [userId]);
      await db.query("DELETE FROM vehicles WHERE user_id = ?", [userId]);
  }

  // Καθαρισμός Cookie
  res.clearCookie("refreshToken", { path: "/api" });
  res.json({ message: "Logged out successfully" });
});

// 4. GET CURRENT USER
router.get("/account/me", authenticateToken, async (req, res) => {
  try {
    // Το req.user έχει ήδη γεμίσει από το authenticateToken
    return res.json(req.user);
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
});

// 5. REGISTER
router.post("/register", async (req, res) => {
  const username = String(req.body?.username || "").trim();
  const email = normalizeEmail(req.body?.email);
  const phone = String(req.body?.phone || req.body?.userNumber || "").trim();
  const companyName = String(req.body?.companyName || "").trim();
  const password = String(req.body?.password || "");
  const fullName = String(req.body?.fullName || "").trim();

  if (!username || !email || !password) {
    return res.status(400).json({ error: "Username, email, password υποχρεωτικά" });
  }

  try {
    // Check duplicates
    const [dups] = await db.query(
      "SELECT id, username, email FROM users WHERE username = ? OR email = ? LIMIT 1",
      [username, email]
    );
    if (dups.length) {
      const d = dups[0];
      if (d.username === username) return res.status(409).json({ error: "Username taken", code: "USERNAME_TAKEN" });
      if (d.email.toLowerCase() === email) return res.status(409).json({ error: "Email taken", code: "EMAIL_TAKEN" });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    
    let companyId = null;
    if (companyName) {
      companyId = await getOrCreateCompanyId(companyName);
    }

    const [result] = await db.query(
      `INSERT INTO users (username, password, full_name, email, role, company_id, user_number, is_active, email_verified)
       VALUES (?, ?, ?, ?, 'user', ?, ?, 1, 0)`,
      [username, passwordHash, fullName, email, companyId, phone]
    );

    await createAndSendVerificationCode({ id: result.insertId, username, email });

    res.json({ message: "Εγγραφή επιτυχής. Στάλθηκε κωδικός στο email.", email });
  } catch (err) {
    console.error("Register error:", err);
    res.status(500).json({ error: "Σφάλμα εγγραφής" });
  }
});

// 6. VERIFY EMAIL
router.post("/verify-email", async (req, res) => {
  const email = normalizeEmail(req.body?.email);
  const code = String(req.body?.code || "").trim();

  if (!email || !code || code.length !== 6) return res.status(400).json({ error: "Email & Code required" });

  try {
    const [users] = await db.query("SELECT id, email_verified FROM users WHERE email = ? LIMIT 1", [email]);
    if (!users.length) return res.status(404).json({ error: "User not found" });

    const user = users[0];
    if (String(user.email_verified) === "1") return res.json({ message: "Email already verified" });

    const codeHash = crypto.createHash("sha256").update(code).digest("hex");
    const [codes] = await db.query(
      `SELECT id FROM email_verification_codes 
       WHERE user_id = ? AND code_hash = ? AND used_at IS NULL AND expires_at > NOW() LIMIT 1`,
      [user.id, codeHash]
    );

    if (!codes.length) return res.status(400).json({ error: "Λάθος ή ληγμένος κωδικός" });

    await db.query("UPDATE email_verification_codes SET used_at = NOW() WHERE id = ?", [codes[0].id]);
    await db.query("UPDATE users SET email_verified = 1 WHERE id = ?", [user.id]);

    res.json({ message: "Email verified successfully" });
  } catch (err) {
    console.error("Verify error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// 7. RESEND VERIFICATION
router.post("/resend-verification", async (req, res) => {
  const email = normalizeEmail(req.body?.email);
  if (!email) return res.status(400).json({ error: "Email required" });

  try {
    const [rows] = await db.query("SELECT id, username, email, email_verified FROM users WHERE email = ?", [email]);
    if (rows.length && String(rows[0].email_verified) !== "1") {
      await createAndSendVerificationCode(rows[0]);
    }
    res.json({ message: "Αν το email υπάρχει, στάλθηκε νέος κωδικός." });
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
});

// 8. FORGOT PASSWORD
router.post("/forgot-password", async (req, res) => {
  const email = normalizeEmail(req.body?.email);
  if (!email) return res.status(400).json({ error: "Email required" });

  try {
    const [rows] = await db.query("SELECT id, username FROM users WHERE email = ?", [email]);
    if (!rows.length) return res.status(404).json({ message: "Email not found", code: "EMAIL_NOT_FOUND" });

    const user = rows[0];
    const code = generate6DigitCode();
    const codeHash = crypto.createHash("sha256").update(code).digest("hex");

    await db.query(
      `INSERT INTO password_reset_codes (user_id, code_hash, expires_at)
       VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 10 MINUTE))`,
      [user.id, codeHash]
    );

    const subject = "CaReMind - Επαναφορά Κωδικού";
    const html = `
      <div style="font-family: Arial, sans-serif;">
        <h2>Επαναφορά Κωδικού</h2>
        <p>Ο κωδικός σας είναι: <b>${code}</b></p>
        <p>Λήγει σε 10 λεπτά.</p>
      </div>
    `;
    await sendMail(email, subject, html);

    res.json({ message: "Code sent to email" });
  } catch (err) {
    console.error("Forgot pass error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// 9. VERIFY RESET CODE
router.post("/verify-reset-code", async (req, res) => {
  const email = normalizeEmail(req.body?.email);
  const code = String(req.body?.code || "").trim();

  if (!email || !code) return res.status(400).json({ error: "Missing data" });

  try {
    const [users] = await db.query("SELECT id FROM users WHERE email = ?", [email]);
    if (!users.length) return res.status(401).json({ error: "User not found" });

    const codeHash = crypto.createHash("sha256").update(code).digest("hex");
    const [rows] = await db.query(
      `SELECT id FROM password_reset_codes 
       WHERE user_id = ? AND code_hash = ? AND used_at IS NULL AND expires_at > NOW()`,
      [users[0].id, codeHash]
    );

    if (!rows.length) return res.status(401).json({ error: "Invalid or expired code" });

    const resetToken = jwt.sign(
      { userId: users[0].id, resetCodeId: rows[0].id, purpose: "password_reset" },
      JWT_SECRET,
      { expiresIn: "15m" }
    );
    res.json({ resetToken });
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
});

// 10. RESET PASSWORD (BCRYPT HASH)
router.post("/reset-password", async (req, res) => {
  const { resetToken, newPassword } = req.body || {};

  if (!resetToken || !newPassword) return res.status(400).json({ error: "Missing data" });

  try {
    const payload = jwt.verify(resetToken, JWT_SECRET);
    if (payload.purpose !== "password_reset") return res.status(401).json({ error: "Invalid token purpose" });

    const [rows] = await db.query(
      `SELECT id FROM password_reset_codes WHERE id = ? AND used_at IS NULL AND expires_at > NOW()`,
      [payload.resetCodeId]
    );

    if (!rows.length) return res.status(401).json({ error: "Code already used or expired" });

    // Hash the new password
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    await db.query("UPDATE users SET password = ? WHERE id = ?", [hashedPassword, payload.userId]);
    await db.query("UPDATE password_reset_codes SET used_at = NOW() WHERE id = ?", [payload.resetCodeId]);

    res.json({ message: "Password updated successfully" });
  } catch (err) {
    console.error("Reset pass error:", err);
    res.status(401).json({ error: "Invalid or expired token" });
  }
});

module.exports = router;