// routes/auth.js
const express = require("express");
const router = express.Router();
const db = require("../db");
const jwt = require("jsonwebtoken");
const { JWT_SECRET, authenticateToken } = require("../middleware");
const crypto = require("crypto");
const bcrypt = require("bcrypt");
const sendMail = require("../emailService");
const crypto = require("crypto"); // Για το hashing και το jti

// Χρόνοι λήξης
const ACCESS_TOKEN_EXPIRY = "15m";
const REFRESH_TOKEN_EXPIRY_DAYS = 30;

// Helper για το hashing του refresh token
function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

// Ρυθμίσεις για το HttpOnly Cookie
function getCookieOptions(req) {
  const isSecure = process.env.NODE_ENV === "production" || req.secure;
  return {
    httpOnly: true,
    secure: isSecure, 
    sameSite: isSecure ? "none" : "lax", 
    path: "/api/refresh",
    maxAge: REFRESH_TOKEN_EXPIRY_DAYS * 24 * 60 * 60 * 1000,
  };
}
// POST /api/login
router.post("/login", async (req, res) => {
  // Για backward compatibility κρατάμε το πεδίο "username" από το frontend,
  // αλλά πλέον μπορεί να είναι είτε username είτε email.
  const { username, password } = req.body || {};
  const identifier = (username || "").trim();
  if (!identifier || !password) {
    return res
      .status(400)
      .json({ error: "Username/Email και password απαιτούνται" });
  }

  try {
    // 1) Βρίσκουμε χρήστη με username Ή email
    const [found] = await db.query(
      `SELECT 
         users.id,
         users.username,
         users.password,
         users.email,
         users.role,
         users.company_id,
         users.is_active,
         users.email_verified,
         companies.name AS companyName
       FROM users
       LEFT JOIN companies ON users.company_id = companies.id
       WHERE (users.username = ? OR users.email = ?)
       LIMIT 1`,
      [identifier, identifier]
    );

    if (!found.length) {
      return res
        .status(401)
        .json({ error: "Λάθος στοιχεία σύνδεσης", code: "INVALID_USER" });
    }

    const user = found[0];

    // 2) Έλεγχος password (bcrypt hash, με fallback για παλιούς plaintext χρήστες)
    const stored = String(user.password || "");
    let ok = false;

    // bcrypt hashes ξεκινάνε συνήθως με $2a$ / $2b$ / $2y$
    if (stored.startsWith("$2a$") || stored.startsWith("$2b$") || stored.startsWith("$2y$")) {
      ok = await bcrypt.compare(password, stored);
    } else {
      // fallback: παλιός χρήστης με plaintext password
      ok = stored === password;
    }

    if (!ok) {
      return res
        .status(401)
        .json({ error: "Λάθος κωδικός", code: "INVALID_PASSWORD" });
    }

    if (!user.is_active) {
      return res
        .status(403)
        .json({ error: "Ο λογαριασμός είναι απενεργοποιημένος" });
    }

    // 3) Email verification gate (εκτός admin/guest)
    if (
      user.role !== "admin" &&
      user.role !== "guest" &&
      user.email &&
      String(user.email_verified || 0) !== "1"
    ) {
      return res.status(403).json({
        error: "Πρέπει να επιβεβαιώσετε το email σας πριν συνδεθείτε.",
        code: "EMAIL_NOT_VERIFIED",
        email: user.email,
      });
    }

const userPayload = {
      id: user.id,
      username: user.username,
      role: user.role,
      companyId: user.company_id,
      companyName: user.companyName,
    };

    // 1. Παραγωγή Access Token (Short-lived)
    const accessToken = jwt.sign(userPayload, JWT_SECRET, { expiresIn: ACCESS_TOKEN_EXPIRY });

    // 2. Παραγωγή Refresh Token (Long-lived)
    const jti = crypto.randomUUID(); 
    const refreshToken = jwt.sign(
      { id: user.id, jti, type: "refresh" }, 
      JWT_SECRET, 
      { expiresIn: `${REFRESH_TOKEN_EXPIRY_DAYS}d` }
    );

    // 3. Αποθήκευση Hash στη βάση
    const hashedToken = hashToken(refreshToken);
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + REFRESH_TOKEN_EXPIRY_DAYS);

    await db.query(
      `INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES (?, ?, ?)`,
      [user.id, hashedToken, expiresAt]
    );

    // 4. Αποστολή Cookie και JSON
    res.cookie("refreshToken", refreshToken, getCookieOptions(req));
    return res.json({ accessToken, user: userPayload });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ error: "Σφάλμα διακομιστή κατά το login" });
  }
});

router.post("/refresh", async (req, res) => {
  const refreshToken = req.cookies.refreshToken;
  if (!refreshToken) return res.status(401).json({ error: "No refresh token" });

  try {
    const decoded = jwt.verify(refreshToken, JWT_SECRET);
    if (decoded.type !== "refresh") return res.status(403).json({ error: "Invalid type" });

    const hashedToken = hashToken(refreshToken);
    const [rows] = await db.query(
      "SELECT user_id FROM refresh_tokens WHERE token_hash = ? AND revoked_at IS NULL AND expires_at > NOW() LIMIT 1",
      [hashedToken]
    );

    if (!rows.length) {
      res.clearCookie("refreshToken", { path: "/api/refresh" });
      return res.status(403).json({ error: "Invalid refresh token" });
    }

    // Φέρνουμε τα στοιχεία του χρήστη για το νέο access token
    const [users] = await db.query("SELECT id, username, role, company_id FROM users WHERE id = ? LIMIT 1", [decoded.id]);
    const user = users[0];
    
    const newAccessToken = jwt.sign({
      id: user.id, username: user.username, role: user.role, companyId: user.company_id
    }, JWT_SECRET, { expiresIn: ACCESS_TOKEN_EXPIRY });

    res.json({ accessToken: newAccessToken, user });
  } catch (err) {
    res.clearCookie("refreshToken", { path: "/api/refresh" });
    res.status(403).json({ error: "Token expired" });
  }
});

function normalizeEmail(v) {
  return String(v || "")
    .trim()
    .toLowerCase();
}


async function getOrCreateCompanyId(companyNameRaw) {
  const name = String(companyNameRaw || "").trim();
  if (!name) return null;

  // Βρίσκουμε εταιρεία (case-insensitive)
  const [rows] = await db.query(
    "SELECT id, name FROM companies WHERE LOWER(name) = LOWER(?) LIMIT 1",
    [name]
  );

  if (rows.length) return rows[0].id;

  // Δημιουργούμε εταιρεία
  const [ins] = await db.query("INSERT INTO companies (name) VALUES (?)", [name]);
  return ins.insertId;
}


async function createAndSendVerificationCode(user) {
  const code = generate6DigitCode();
  const codeHash = hashCode(code);

  // 5 λεπτά ισχύς
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
      <p>Ο 6-ψήφιος κωδικός επιβεβαίωσης είναι:</p>
      <div style="font-size:28px; letter-spacing:6px; font-weight:700; padding:12px 16px; background:#f3f6f8; display:inline-block; border-radius:10px;">${code}</div>
      <p style="margin-top:14px">Ο κωδικός λήγει σε <b>5 λεπτά</b>.</p>
      <p style="color:#666; font-size:13px">Αν δεν κάνατε εσείς την εγγραφή, αγνοήστε αυτό το email.</p>
    </div>
  `;

  await sendMail(user.email, subject, html);
}

// POST /api/register
router.post("/register", async (req, res) => {
  const username = String(req.body?.username || "").trim();
  const email = normalizeEmail(req.body?.email);
  const phone = String(req.body?.phone || req.body?.user_number || req.body?.userNumber || "").trim();
  const companyName = String(req.body?.companyName || req.body?.company || "").trim();
  const password = String(req.body?.password || "");
  const fullName = String(req.body?.fullName || req.body?.full_name || "").trim();

  if (!username || !email || !password) {
    return res
      .status(400)
      .json({ error: "Username, email και password είναι υποχρεωτικά" });
  }

  try {
    // Έλεγχος duplicates
    const [dups] = await db.query(
      "SELECT id, username, email FROM users WHERE username = ? OR email = ? LIMIT 1",
      [username, email]
    );
    if (dups.length) {
      const d = dups[0];
      if (d.username === username) {
        return res
          .status(409)
          .json({ error: "Το username χρησιμοποιείται ήδη", code: "USERNAME_TAKEN" });
      }
      if ((d.email || "").toLowerCase() === email) {
        return res
          .status(409)
          .json({ error: "Το email χρησιμοποιείται ήδη", code: "EMAIL_TAKEN" });
      }
      return res.status(409).json({ error: "Υπάρχει ήδη χρήστης" });
    }

    // Hash password (bcrypt)
    const passwordHash = await bcrypt.hash(password, 10);

    // company_id (find or create)
    let companyId = null;
    if (companyName) {
      companyId = await getOrCreateCompanyId(companyName);
    }

    // Δημιουργία χρήστη (role user, email_verified=0)
    // Σημείωση: κρατάμε το πεδίο users.password ως hash για να μην χρειαστεί rename στήλης.
    const [result] = await db.query(
      `INSERT INTO users (username, password, full_name, email, role, company_id, user_number, is_active, email_verified)
       VALUES (?, ?, ?, ?, 'user', ?, ?, 1, 0)`,
      [username, passwordHash, fullName || null, email, companyId, phone || null]
    );

    const userId = result.insertId;

    await createAndSendVerificationCode({ id: userId, username, email });

    return res.json({
      message: "Η εγγραφή ολοκληρώθηκε. Στάλθηκε κωδικός επιβεβαίωσης στο email σας.",
      email,
    });
  } catch (err) {
    console.error("register error:", err);
    return res.status(500).json({ error: "Σφάλμα διακομιστή" });
  }
});



// POST /api/verify-email
router.post("/verify-email", async (req, res) => {
  const email = normalizeEmail(req.body?.email);
  const code = String(req.body?.code || "").trim();
  if (!email || !code || code.length !== 6) {
    return res.status(400).json({ error: "Email και 6-ψήφιος κωδικός απαιτούνται" });
  }

  try {
    const [urows] = await db.query(
      "SELECT id, username, email_verified FROM users WHERE email = ? LIMIT 1",
      [email]
    );
    if (!urows.length) {
      return res.status(404).json({ error: "Δεν βρέθηκε χρήστης", code: "EMAIL_NOT_FOUND" });
    }

    const user = urows[0];
    if (String(user.email_verified || 0) === "1") {
      return res.json({ message: "Το email είναι ήδη επιβεβαιωμένο." });
    }

    const codeHash = hashCode(code);
    const [codes] = await db.query(
      `SELECT id, code_hash
       FROM email_verification_codes
       WHERE user_id = ?
         AND used_at IS NULL
         AND expires_at > NOW()
       ORDER BY created_at DESC
       LIMIT 1`,
      [user.id]
    );

    if (!codes.length) {
      return res.status(400).json({
        error: "Ο κωδικός έληξε ή δεν υπάρχει. Πατήστε 'Αποστολή ξανά'.",
        code: "CODE_EXPIRED",
      });
    }

    const row = codes[0];
    if (row.code_hash !== codeHash) {
      return res.status(400).json({ error: "Λάθος κωδικός", code: "INVALID_CODE" });
    }

    await db.query("UPDATE email_verification_codes SET used_at = NOW() WHERE id = ?", [
      row.id,
    ]);
    await db.query("UPDATE users SET email_verified = 1 WHERE id = ?", [user.id]);

    return res.json({ message: "Το email επιβεβαιώθηκε επιτυχώς. Μπορείτε να συνδεθείτε." });
  } catch (err) {
    console.error("verify-email error:", err);
    return res.status(500).json({ error: "Σφάλμα διακομιστή" });
  }
});

// POST /api/resend-verification
router.post("/resend-verification", async (req, res) => {
  const email = normalizeEmail(req.body?.email);
  if (!email) {
    return res.status(400).json({ error: "Το email είναι υποχρεωτικό" });
  }

  try {
    const [rows] = await db.query(
      "SELECT id, username, email, email_verified FROM users WHERE email = ? LIMIT 1",
      [email]
    );
    if (!rows.length) {
      // κρατάμε generic απάντηση για να μην αποκαλύπτουμε αν υπάρχει email
      return res.json({ message: "Αν το email υπάρχει στο σύστημα, στάλθηκε νέος κωδικός." });
    }

    const user = rows[0];
    if (String(user.email_verified || 0) === "1") {
      return res.json({ message: "Το email είναι ήδη επιβεβαιωμένο." });
    }

    await createAndSendVerificationCode(user);

    return res.json({ message: "Στάλθηκε νέος κωδικός επιβεβαίωσης." });
  } catch (err) {
    console.error("resend-verification error:", err);
    return res.status(500).json({ error: "Σφάλμα διακομιστή" });
  }
});


function hashResetCode(code) {
  return crypto.createHash("sha256").update(String(code)).digest("hex");
}

function generate6DigitCode() {
  // 000000 - 999999
  const n = crypto.randomInt(0, 1000000);
  return String(n).padStart(6, "0");
}

function hashCode(code) {
  return crypto.createHash("sha256").update(String(code)).digest("hex");
}

// POST /api/forgot-password
router.post("/forgot-password", async (req, res) => {
  const email = String(req.body?.email || "")
    .trim()
    .toLowerCase();
  if (!email) {
    return res.status(400).json({ error: "Το email είναι υποχρεωτικό" });
  }

  try {
    const [rows] = await db.query(
      "SELECT id, username, email FROM users WHERE email = ? LIMIT 1",
      [email]
    );

    // Αν δεν υπάρχει email στη βάση, επιστρέφουμε μήνυμα λάθους
    if (!rows.length) {
      return res.status(404).json({
        code: "EMAIL_NOT_FOUND",
        message: "Πληκτρολογήστε έγκυρη διεύθυνση Email",
      });
    }

    const user = rows[0];
    const code = generate6DigitCode();
    const codeHash = hashResetCode(code);

    // 10 λεπτά ισχύς
    await db.query(
      `INSERT INTO password_reset_codes (user_id, code_hash, expires_at)
       VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 10 MINUTE))`,
      [user.id, codeHash]
    );

    const subject = "CaReMind - Κωδικός επαναφοράς";
    const html = `
      <div style="font-family: Arial, sans-serif; line-height:1.5">
        <h2 style="margin:0 0 12px 0">Επαναφορά κωδικού</h2>
        <p>Γεια σας <b>${user.username || ""}</b>,</p>
        <p>Ο κωδικός επαναφοράς σας είναι:</p>
        <div style="font-size:28px; letter-spacing:6px; font-weight:700; padding:12px 16px; background:#f3f6f8; display:inline-block; border-radius:10px;">${code}</div>
        <p style="margin-top:14px">Ο κωδικός λήγει σε <b>10 λεπτά</b>.</p>
        <p style="color:#666; font-size:13px">Αν δεν ζητήσατε επαναφορά, αγνοήστε αυτό το email.</p>
      </div>
    `;

    await sendMail(email, subject, html);

    return res.json({
      message:
        "Αν το email υπάρχει στο σύστημα, θα λάβετε έναν κωδικό επαναφοράς.",
    });
  } catch (err) {
    console.error("forgot-password error:", err);
    return res.status(500).json({ error: "Σφάλμα διακομιστή" });
  }
});

// POST /api/verify-reset-code
router.post("/verify-reset-code", async (req, res) => {
  const email = String(req.body?.email || "")
    .trim()
    .toLowerCase();
  const code = String(req.body?.code || "").trim();

  if (!email || !code) {
    return res.status(400).json({ error: "Email και κωδικός απαιτούνται" });
  }

  try {
    const [users] = await db.query(
      "SELECT id FROM users WHERE email = ? LIMIT 1",
      [email]
    );
    if (!users.length) {
      return res.status(401).json({ error: "Λάθος κωδικός" });
    }
    const userId = users[0].id;
    const codeHash = hashResetCode(code);

    const [rows] = await db.query(
      `SELECT id
       FROM password_reset_codes
       WHERE user_id = ?
         AND code_hash = ?
         AND used_at IS NULL
         AND expires_at > NOW()
       ORDER BY created_at DESC
       LIMIT 1`,
      [userId, codeHash]
    );

    if (!rows.length) {
      return res.status(401).json({ error: "Λάθος κωδικός" });
    }

    const resetCodeId = rows[0].id;
    const resetToken = jwt.sign(
      { userId, resetCodeId, purpose: "password_reset" },
      JWT_SECRET,
      { expiresIn: "15m" }
    );

    return res.json({ resetToken });
  } catch (err) {
    console.error("verify-reset-code error:", err);
    return res.status(500).json({ error: "Σφάλμα διακομιστή" });
  }
});

// POST /api/reset-password
router.post("/reset-password", async (req, res) => {
  const resetToken = String(req.body?.resetToken || "").trim();
  const newPassword = String(req.body?.newPassword || "");

  if (!resetToken || !newPassword) {
    return res
      .status(400)
      .json({ error: "resetToken και νέος κωδικός απαιτούνται" });
  }

  try {
    const payload = jwt.verify(resetToken, JWT_SECRET);
    if (payload?.purpose !== "password_reset") {
      return res.status(401).json({ error: "Μη έγκυρο token" });
    }

    const { userId, resetCodeId } = payload;

    // Έλεγχος ότι ο κωδικός δεν έχει χρησιμοποιηθεί/λήξει
    const [rows] = await db.query(
      `SELECT id
       FROM password_reset_codes
       WHERE id = ?
         AND user_id = ?
         AND used_at IS NULL
         AND expires_at > NOW()
       LIMIT 1`,
      [resetCodeId, userId]
    );

    if (!rows.length) {
      return res.status(401).json({ error: "Ο κωδικός έχει λήξει" });
    }

   const hashedPassword = await bcrypt.hash(newPassword, 10); 
await db.query("UPDATE users SET password = ? WHERE id = ?", [hashedPassword, userId]); 

    await db.query(
      "UPDATE password_reset_codes SET used_at = NOW() WHERE id = ?",
      [resetCodeId]
    );

    return res.json({ message: "Ο κωδικός άλλαξε επιτυχώς" });
  } catch (err) {
    console.error("reset-password error:", err);
    return res.status(401).json({ error: "Μη έγκυρο ή ληγμένο token" });
  }
});


// GET /api/account/me  (στοιχεία λογαριασμού)
router.get("/account/me", authenticateToken, async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const [rows] = await db.query(
  `SELECT 
     users.id,
     users.username,
     users.email,
     users.user_number AS phone,
     users.role,
     companies.name AS companyName
   FROM users
   LEFT JOIN companies ON users.company_id = companies.id
   WHERE users.id = ?
   LIMIT 1`,
  [userId]
);


    if (!rows.length) return res.status(404).json({ error: "User not found" });

    return res.json(rows[0]);
  } catch (err) {
    console.error("account/me error:", err);
    return res.status(500).json({ error: "Σφάλμα διακομιστή" });
  }
});


router.post("/logout", async (req, res) => {
  const refreshToken = req.cookies.refreshToken;
  if (refreshToken) {
    await db.query("UPDATE refresh_tokens SET revoked_at = NOW() WHERE token_hash = ?", [hashToken(refreshToken)]);
  }
  res.clearCookie("refreshToken", getCookieOptions(req));
  res.json({ message: "Logged out" });
});

module.exports = router;
