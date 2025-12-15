// backend/routes/adminUsers.js
const express = require("express");
const router = express.Router();
const db = require("../db");
const { authenticateToken } = require("../middleware");

// Μόνο admin επιτρέπεται
function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== "admin") {
    return res.status(403).json({ error: "Access denied – Admins only" });
  }
  next();
}

/* ----------------------------------------------
   GET /api/users
   Επιστρέφει όλους τους χρήστες με στοιχεία εταιρείας
---------------------------------------------- */
router.get("/", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT 
     users.id,
     users.username,
     users.role,
     users.company_id,
     users.is_active,
     users.created_at,
     users.email,
     users.user_number,
     companies.name AS company_name
   FROM users
   LEFT JOIN companies ON users.company_id = companies.id
   ORDER BY users.id DESC`
    );

    res.json(rows);
  } catch (err) {
    console.error("GET /users error:", err);
    res.status(500).json({ error: "Σφάλμα κατά τη φόρτωση χρηστών" });
  }
});

/* ----------------------------------------------
   POST /api/users
   Δημιουργία εταιρείας + χρήστη (role = 'user')
---------------------------------------------- */
router.post("/", authenticateToken, requireAdmin, async (req, res) => {
  const { username, password, companyName, email, userNumber } = req.body;

  if (!username || !password || !companyName || !email || !userNumber) {
    return res.status(400).json({ error: "Λείπουν απαιτούμενα πεδία" });
  }

  try {
    // 1. Έλεγχος αν υπάρχει ήδη ο χρήστης
    const [existing] = await db.query(
      "SELECT id FROM users WHERE email = ? OR username = ? LIMIT 1",
      [email, username]
    );

    if (existing.length > 0) {
      return res
        .status(400)
        .json({ error: "Το email ή το username χρησιμοποιείται ήδη." });
    }

    // 2. Δημιουργία εταιρείας
    const [companyResult] = await db.query(
      `INSERT INTO companies (name) VALUES (?)`,
      [companyName]
    );

    const companyId = companyResult.insertId;

    // 3. Δημιουργία χρήστη
    await db.query(
      `INSERT INTO users (username, password, role, company_id, is_active, email, user_number) 
   VALUES (?, ?, 'user', ?, 1, ?, ?)`,
      [username, password, companyId, email, userNumber]
    );

    res.json({
      success: true,
      message: "Ο χρήστης δημιουργήθηκε",
      username,
      companyId,
    });
  } catch (err) {
    console.error("POST /users error:", err);
    res.status(500).json({ error: "Σφάλμα κατά τη δημιουργία χρήστη" });
  }
});

/* ----------------------------------------------
   PUT /api/users/:id
   Επεξεργασία χρήστη (username, password, companyName, is_active)
---------------------------------------------- */
router.put("/:id", authenticateToken, requireAdmin, async (req, res) => {
  const userId = parseInt(req.params.id, 10);
  const { username, password, companyName, isActive, email, userNumber } =
    req.body;

  if (!username || !companyName || !email || !userNumber) {
    return res.status(400).json({ error: "Λείπουν απαιτούμενα πεδία" });
  }

  try {
    // Δεν επιτρέπουμε αλλαγή / πείραγμα άλλου admin (προαιρετικό)
    const [userRows] = await db.query(
      `SELECT id, role FROM users WHERE id = ?`,
      [userId]
    );
    if (!userRows.length) {
      return res.status(404).json({ error: "Ο χρήστης δεν βρέθηκε" });
    }

    const targetUser = userRows[0];
    if (targetUser.role === "admin" && userId !== req.user.id) {
      return res
        .status(403)
        .json({ error: "Δεν μπορείτε να επεξεργαστείτε άλλον admin" });
    }

    // 1. Αν υπάρχει companyName, διασφαλίζουμε ότι υπάρχει εταιρεία
    let companyId = null;

    // Αναζητούμε αν υπάρχει ήδη εταιρεία με αυτό το όνομα
    const [existingCompanies] = await db.query(
      `SELECT id FROM companies WHERE name = ? LIMIT 1`,
      [companyName]
    );

    if (existingCompanies.length > 0) {
      companyId = existingCompanies[0].id;
    } else {
      const [companyResult] = await db.query(
        `INSERT INTO companies (name) VALUES (?)`,
        [companyName]
      );
      companyId = companyResult.insertId;
    }

    // 2. Ενημέρωση χρήστη
    const fields = [];
    const params = [];

    fields.push("username = ?");
    params.push(username);

    if (password) {
      fields.push("password = ?");
      params.push(password);
    }

    fields.push("company_id = ?");
    params.push(companyId);

    // ΝΕΟ: email & user_number
    fields.push("email = ?");
    params.push(email);

    fields.push("user_number = ?");
    params.push(userNumber);

    if (typeof isActive === "boolean") {
      fields.push("is_active = ?");
      params.push(isActive ? 1 : 0);
    }

    params.push(userId);

    const sql = `UPDATE users SET ${fields.join(", ")} WHERE id = ?`;
    await db.query(sql, params);

    res.json({ success: true, message: "Ο χρήστης ενημερώθηκε" });
  } catch (err) {
    console.error("PUT /users/:id error:", err);
    res.status(500).json({ error: "Σφάλμα κατά την ενημέρωση χρήστη" });
  }
});

/* ----------------------------------------------
   PATCH /api/users/:id/toggle-active
   Αλλαγή is_active (ενεργοποίηση / απενεργοποίηση)
---------------------------------------------- */
router.patch(
  "/:id/toggle-active",
  authenticateToken,
  requireAdmin,
  async (req, res) => {
    const userId = parseInt(req.params.id, 10);

    try {
      const [rows] = await db.query(
        `SELECT id, is_active, role FROM users WHERE id = ?`,
        [userId]
      );

      if (!rows.length) {
        return res.status(404).json({ error: "Ο χρήστης δεν βρέθηκε" });
      }

      const user = rows[0];

      // Δεν απενεργοποιούμε admin (προαιρετικό)
      if (user.role === "admin") {
        return res
          .status(403)
          .json({ error: "Δεν μπορείτε να απενεργοποιήσετε admin" });
      }

      const newStatus = user.is_active ? 0 : 1;

      await db.query(`UPDATE users SET is_active = ? WHERE id = ?`, [
        newStatus,
        userId,
      ]);

      res.json({
        success: true,
        isActive: !!newStatus,
        message: newStatus
          ? "Ο χρήστης ενεργοποιήθηκε"
          : "Ο χρήστης απενεργοποιήθηκε",
      });
    } catch (err) {
      console.error("PATCH /users/:id/toggle-active error:", err);
      res
        .status(500)
        .json({ error: "Σφάλμα κατά την αλλαγή κατάστασης χρήστη" });
    }
  }
);

/* ----------------------------------------------
   DELETE /api/users/:id
   Διαγραφή χρήστη
---------------------------------------------- */
router.delete("/:id", authenticateToken, requireAdmin, async (req, res) => {
  const userId = parseInt(req.params.id, 10);

  try {
    const [rows] = await db.query(`SELECT id, role FROM users WHERE id = ?`, [
      userId,
    ]);

    if (!rows.length) {
      return res.status(404).json({ error: "Ο χρήστης δεν βρέθηκε" });
    }

    const user = rows[0];

    // Δεν επιτρέπουμε διαγραφή admin
    if (user.role === "admin") {
      return res
        .status(403)
        .json({ error: "Δεν μπορείτε να διαγράψετε admin" });
    }

    await db.query(`DELETE FROM users WHERE id = ?`, [userId]);

    res.json({ success: true, message: "Ο χρήστης διαγράφηκε" });
  } catch (err) {
    console.error("DELETE /users/:id error:", err);
    res.status(500).json({ error: "Σφάλμα κατά τη διαγραφή χρήστη" });
  }
});

module.exports = router;
