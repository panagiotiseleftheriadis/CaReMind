// routes/account.js
// User account page: profile info, change email/username/password with 6-digit email code,
// and extra notification recipients (emails today, phones later).

const express = require("express");
const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const db = require("../db");
const sendMail = require("../emailService");
const { JWT_SECRET } = require("../middleware");

const router = express.Router();

function hashCode(code) {
  return crypto.createHash("sha256").update(String(code)).digest("hex");
}

function generate6DigitCode() {
  const n = crypto.randomInt(0, 1000000);
  return String(n).padStart(6, "0");
}

// GET /api/account/me
router.get("/me", async (req, res) => {
  try {
    const userId = req.user.id;
    const [rows] = await db.query(
      `SELECT u.id, u.username, u.email, u.user_number, u.role, c.name AS companyName
       FROM users u
       LEFT JOIN companies c ON c.id = u.company_id
       WHERE u.id = ?
       LIMIT 1`,
      [userId]
    );

    if (!rows.length) {
      return res.status(404).json({ error: "User not found" });
    }

    return res.json(rows[0]);
  } catch (err) {
    console.error("account/me error:", err);
    return res.status(500).json({ error: "Σφάλμα διακομιστή" });
  }
});

// POST /api/account/send-code
// Sends a 6-digit code to the user's current email.
router.post("/send-code", async (req, res) => {
  try {
    const userId = req.user.id;
    const [rows] = await db.query(
      "SELECT username, email FROM users WHERE id = ? LIMIT 1",
      [userId]
    );
    if (!rows.length) {
      return res.status(404).json({ error: "User not found" });
    }

    const email = String(rows[0].email || "").trim().toLowerCase();
    if (!email) {
      return res.status(400).json({
        message:
          "Δεν υπάρχει email στον λογαριασμό σας. Ζητήστε από τον διαχειριστή να ορίσει email.",
        code: "NO_EMAIL",
      });
    }

    const code = generate6DigitCode();
    const codeHash = hashCode(code);

    // 10 minutes validity
    await db.query(
      `INSERT INTO verification_codes (user_id, code_hash, purpose, expires_at)
       VALUES (?, ?, 'account_change', DATE_ADD(NOW(), INTERVAL 10 MINUTE))`,
      [userId, codeHash]
    );

    const subject = "CaReMind - Κωδικός επιβεβαίωσης";
    const html = `
      <div style="font-family: Arial, sans-serif; line-height:1.6">
        <h2 style="margin:0 0 12px 0">Επιβεβαίωση αλλαγής στοιχείων</h2>
        <p>Γεια σας <b>${rows[0].username || ""}</b>,</p>
        <p>Ο κωδικός επιβεβαίωσης σας είναι:</p>
        <div style="font-size:28px; letter-spacing:6px; font-weight:700; padding:12px 16px; background:#f3f6f8; display:inline-block; border-radius:10px;">${code}</div>
        <p style="margin-top:14px">Ο κωδικός λήγει σε <b>10 λεπτά</b>.</p>
        <p style="color:#666; font-size:13px">Αν δεν ζητήσατε εσείς αλλαγή στοιχείων, αγνοήστε αυτό το email.</p>
      </div>
    `;

    await sendMail(email, subject, html);

    return res.json({ ok: true, message: "Code sent" });
  } catch (err) {
    console.error("account/send-code error:", err);
    return res.status(500).json({ error: "Σφάλμα διακομιστή" });
  }
});

// POST /api/account/verify-code
// { code } -> { accountToken }
router.post("/verify-code", async (req, res) => {
  const userId = req.user.id;
  const code = String(req.body?.code || "").trim();
  if (!code) {
    return res.status(400).json({ error: "Κωδικός απαιτείται" });
  }

  try {
    const codeHash = hashCode(code);
    const [rows] = await db.query(
      `SELECT id
       FROM verification_codes
       WHERE user_id = ?
         AND purpose = 'account_change'
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

    const verificationId = rows[0].id;
    const accountToken = jwt.sign(
      { userId, verificationId, purpose: "account_change" },
      JWT_SECRET,
      { expiresIn: "15m" }
    );

    return res.json({ accountToken });
  } catch (err) {
    console.error("account/verify-code error:", err);
    return res.status(500).json({ error: "Σφάλμα διακομιστή" });
  }
});

// POST /api/account/update
// { accountToken, updates: { email?, username?, password? } }
router.post("/update", async (req, res) => {
  const accountToken = String(req.body?.accountToken || "").trim();
  const updates = req.body?.updates || {};

  if (!accountToken || !updates || typeof updates !== "object") {
    return res.status(400).json({ error: "Μη έγκυρο αίτημα" });
  }

  try {
    const payload = jwt.verify(accountToken, JWT_SECRET);
    if (payload?.purpose !== "account_change") {
      return res.status(401).json({ error: "Μη έγκυρο token" });
    }

    const userId = payload.userId;
    const verificationId = payload.verificationId;

    // Ensure code still valid & unused
    const [rows] = await db.query(
      `SELECT id
       FROM verification_codes
       WHERE id = ? AND user_id = ? AND used_at IS NULL AND expires_at > NOW()
       LIMIT 1`,
      [verificationId, userId]
    );

    if (!rows.length) {
      return res.status(401).json({ error: "Ο κωδικός έχει λήξει" });
    }

    const allowed = {};
    if (typeof updates.email === "string") {
      allowed.email = updates.email.trim().toLowerCase();
    }
    if (typeof updates.username === "string") {
      allowed.username = updates.username.trim();
    }
    if (typeof updates.password === "string") {
      allowed.password = updates.password;
    }

    const keys = Object.keys(allowed);
    if (keys.length === 0) {
      return res.status(400).json({ error: "Δεν δόθηκαν αλλαγές" });
    }

    // Unique checks (email/username)
    if (allowed.email) {
      const [e] = await db.query(
        "SELECT id FROM users WHERE email = ? AND id <> ? LIMIT 1",
        [allowed.email, userId]
      );
      if (e.length) {
        return res
          .status(409)
          .json({ message: "Το email χρησιμοποιείται ήδη.", code: "EMAIL_TAKEN" });
      }
    }
    if (allowed.username) {
      const [u] = await db.query(
        "SELECT id FROM users WHERE username = ? AND id <> ? LIMIT 1",
        [allowed.username, userId]
      );
      if (u.length) {
        return res.status(409).json({
          message: "Το username χρησιμοποιείται ήδη.",
          code: "USERNAME_TAKEN",
        });
      }
    }

    const setSql = keys.map((k) => `${k} = ?`).join(", ");
    const vals = keys.map((k) => allowed[k]);
    vals.push(userId);

    await db.query(`UPDATE users SET ${setSql} WHERE id = ?`, vals);
    await db.query("UPDATE verification_codes SET used_at = NOW() WHERE id = ?", [
      verificationId,
    ]);

    return res.json({ ok: true });
  } catch (err) {
    console.error("account/update error:", err);
    return res.status(401).json({ error: "Μη έγκυρο ή ληγμένο token" });
  }
});

/* =====================
   RECIPIENTS
   ===================== */

// GET /api/account/recipients
router.get("/recipients", async (req, res) => {
  try {
    const userId = req.user.id;
    const [rows] = await db.query(
      `SELECT id, type, value, created_at
       FROM notification_recipients
       WHERE user_id = ? AND is_active = 1
       ORDER BY created_at DESC`,
      [userId]
    );
    return res.json(rows);
  } catch (err) {
    console.error("account/recipients GET error:", err);
    return res.status(500).json({ error: "Σφάλμα διακομιστή" });
  }
});

// POST /api/account/recipients { type, value }
router.post("/recipients", async (req, res) => {
  try {
    const userId = req.user.id;
    const type = String(req.body?.type || "email").trim().toLowerCase();
    const value = String(req.body?.value || "").trim().toLowerCase();

    if (!value) {
      return res.status(400).json({ error: "Τιμή απαιτείται" });
    }
    if (type !== "email" && type !== "phone") {
      return res.status(400).json({ error: "Μη έγκυρος τύπος" });
    }
    if (type === "email" && !value.includes("@")) {
      return res.status(400).json({ error: "Μη έγκυρο email" });
    }

    // prevent duplicates
    const [exists] = await db.query(
      `SELECT id FROM notification_recipients
       WHERE user_id = ? AND type = ? AND value = ? AND is_active = 1
       LIMIT 1`,
      [userId, type, value]
    );
    if (exists.length) {
      return res.status(409).json({ message: "Υπάρχει ήδη στη λίστα." });
    }

    await db.query(
      `INSERT INTO notification_recipients (user_id, type, value, is_active)
       VALUES (?, ?, ?, 1)`,
      [userId, type, value]
    );

    return res.json({ ok: true });
  } catch (err) {
    console.error("account/recipients POST error:", err);
    return res.status(500).json({ error: "Σφάλμα διακομιστή" });
  }
});

// DELETE /api/account/recipients/:id
router.delete("/recipients/:id", async (req, res) => {
  try {
    const userId = req.user.id;
    const id = req.params.id;

    await db.query(
      `UPDATE notification_recipients
       SET is_active = 0
       WHERE id = ? AND user_id = ?`,
      [id, userId]
    );

    return res.json({ ok: true });
  } catch (err) {
    console.error("account/recipients DELETE error:", err);
    return res.status(500).json({ error: "Σφάλμα διακομιστή" });
  }
});

module.exports = router;
