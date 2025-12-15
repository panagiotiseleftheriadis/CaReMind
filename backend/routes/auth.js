// routes/auth.js
const express = require("express");
const router = express.Router();
const db = require("../db");
const jwt = require("jsonwebtoken");
const { JWT_SECRET, authenticateToken } = require("../middleware");

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
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: "Username και password απαιτούνται" });
  }

  try {
    const [rows] = await db.query(
      `SELECT 
         users.id,
         users.username,
         users.role,
         users.company_id,
         users.is_active,
         companies.name AS companyName
       FROM users
       LEFT JOIN companies ON users.company_id = companies.id
       WHERE users.username = ? AND users.password = ?
       LIMIT 1`,
      [username, password]
    );

    if (!rows.length) {
      return res.status(401).json({ error: "Λάθος στοιχεία σύνδεσης" });
    }

    const user = rows[0];

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
