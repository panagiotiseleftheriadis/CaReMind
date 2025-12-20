// routes/auth.js
const express = require("express");
const router = express.Router();
const db = require("../db");
const jwt = require("jsonwebtoken");
const { JWT_SECRET, authenticateToken } = require("../middleware");
const crypto = require("crypto");
const sendMail = require("../emailService");

// POST /api/login
// router.post("/login", async (req, res) => {
//   const { username, password } = req.body || {};
//   if (!username || !password) {
//     return res.status(400).json({ error: "Username και password απαιτούνται" });
//   }

//   try {
//     const [rows] = await db.query(
//       "SELECT id, username, role, company_id, is_active FROM users WHERE username = ? AND password = ? LIMIT 1",
//       [username, password]
//     );

//     if (!rows.length) {
//       return res.status(401).json({ error: "Λάθος στοιχεία σύνδεσης" });
//     }

//     const user = rows[0];
//     if (!user.is_active) {
//       return res
//         .status(403)
//         .json({ error: "Ο λογαριασμός είναι απενεργοποιημένος" });
//     }

//     const payload = {
//       id: user.id,
//       username: user.username,
//       role: user.role,
//       companyId: user.company_id,
//     };

//     const token = jwt.sign(payload, JWT_SECRET, { expiresIn: "8h" });

//     res.json({ token, user: payload });
//   } catch (err) {
//     console.error("Login error:", err);
//     res.status(500).json({ error: "Σφάλμα διακομιστή κατά το login" });
//   }
// });
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
         users.role,
         users.company_id,
         users.is_active,
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

    // 2) Έλεγχος password
    if (user.password !== password) {
      return res
        .status(401)
        .json({ error: "Λάθος κωδικός", code: "INVALID_PASSWORD" });
    }

    if (!user.is_active) {
      return res
        .status(403)
        .json({ error: "Ο λογαριασμός είναι απενεργοποιημένος" });
    }

    const payload = {
      id: user.id,
      username: user.username,
      role: user.role,
      companyId: user.company_id,
      companyName: user.companyName, // 🔥 εδώ μπαίνει το όνομα της εταιρείας
    };

    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: "8h" });

    res.json({ token, user: payload });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ error: "Σφάλμα διακομιστή κατά το login" });
  }
});

/* ==========================
   FORGOT PASSWORD FLOW
   ==========================
   1) POST /api/forgot-password  { email }
      - στέλνει 6-ψήφιο κωδικό στο email
   2) POST /api/verify-reset-code { email, code }
      - αν είναι σωστό, επιστρέφει resetToken (JWT)
   3) POST /api/reset-password { resetToken, newPassword }
      - αλλάζει τον κωδικό

   Σημείωση: το project αυτή τη στιγμή κρατά password "χύμα".
*/

function hashResetCode(code) {
  return crypto.createHash("sha256").update(String(code)).digest("hex");
}

function generate6DigitCode() {
  // 000000 - 999999
  const n = crypto.randomInt(0, 1000000);
  return String(n).padStart(6, "0");
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

    // Για ασφάλεια επιστρέφουμε ίδιο μήνυμα είτε υπάρχει είτε όχι.
    if (!rows.length) {
      return res.json({
        message:
          "Αν το email υπάρχει στο σύστημα, θα λάβετε έναν κωδικό επαναφοράς.",
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

    await db.query("UPDATE users SET password = ? WHERE id = ?", [
      newPassword,
      userId,
    ]);

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

// POST /api/logout
router.post("/logout", authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const username = req.user.username;

    // Αν είναι guest, καθαρίζουμε ΟΛΑ τα δεδομένα του
    if (username === "guest") {
      await db.query("DELETE FROM costs WHERE user_id = ?", [userId]);
      await db.query("DELETE FROM maintenances WHERE user_id = ?", [userId]);
      await db.query("DELETE FROM vehicles WHERE user_id = ?", [userId]);
    }

    res.json({ message: "Logged out successfully" });
  } catch (err) {
    console.error("Logout error:", err);
    res.status(500).json({ error: "Σφάλμα διακομιστή κατά το logout" });
  }
});

module.exports = router;
