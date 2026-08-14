const express = require("express");
const bcrypt = require("bcrypt");
const db = require("../db");
const { authenticateToken } = require("../authMiddleware");
const { requirePositiveId } = require("../validation");

const router = express.Router();
router.param("id", requirePositiveId);

const USERNAME_PATTERN = /^[\p{L}\p{N}._-]{3,50}$/u;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ACCOUNT_TYPES = new Set(["individual", "business"]);
const ADMIN_ROLES = new Set(["admin", "owner"]);

function requireAdmin(req, res, next) {
  if (!req.user || !ADMIN_ROLES.has(req.user.role)) {
    return res.status(403).json({
      error: "Δεν έχετε δικαίωμα πρόσβασης στη διαχείριση χρηστών.",
      code: "ADMIN_REQUIRED",
    });
  }
  return next();
}

function requireOwner(req, res, next) {
  if (!req.user || req.user.role !== "owner") {
    return res.status(403).json({
      error: "Μόνο ο owner μπορεί να αλλάζει δικαιώματα διαχειριστή.",
      code: "OWNER_REQUIRED",
    });
  }
  return next();
}

function normalizeUserInput(body = {}, { passwordRequired = false } = {}) {
  const username = String(body.username || "").trim();
  const password = String(body.password || "");
  const email = String(body.email || "").trim().toLowerCase();
  const userNumber = String(body.userNumber || "").trim();
  const companyName = String(body.companyName || "").trim();
  const fullName = String(body.fullName || "").trim();
  const accountType = String(body.accountType || "individual").trim();

  if (!username || !email || !userNumber || !companyName) {
    return { error: "Συμπληρώστε username, email, τηλέφωνο και εταιρεία." };
  }
  if (!USERNAME_PATTERN.test(username)) {
    return { error: "Το username πρέπει να έχει 3-50 έγκυρους χαρακτήρες." };
  }
  if (!EMAIL_PATTERN.test(email)) {
    return { error: "Το email δεν είναι έγκυρο." };
  }
  if (!ACCOUNT_TYPES.has(accountType)) {
    return { error: "Ο τύπος λογαριασμού δεν είναι έγκυρος." };
  }
  if (passwordRequired && !password) {
    return { error: "Ο κωδικός πρόσβασης είναι υποχρεωτικός." };
  }
  if (password && (password.length < 8 || password.length > 128)) {
    return { error: "Ο κωδικός πρέπει να έχει 8-128 χαρακτήρες." };
  }

  return {
    value: {
      username,
      password,
      email,
      userNumber,
      companyName,
      fullName: fullName || null,
      accountType,
    },
  };
}

function databaseError(res, error, fallback) {
  if (error?.code === "23505") {
    return res.status(409).json({
      error: "Το username ή το email χρησιμοποιείται ήδη.",
      code: "USER_EXISTS",
    });
  }
  console.error(fallback, error);
  return res.status(500).json({ error: "Παρουσιάστηκε σφάλμα διακομιστή." });
}

// Complete, read-only overview used by the owner console.
router.get("/", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT
         u.id,
         u.username,
         u.full_name,
         u.email,
         u.user_number,
         u.role,
         u.company_id,
         u.account_type,
         u.is_active,
         u.email_verified,
         u.created_at,
         u.updated_at,
         c.name AS company_name,
         (SELECT COUNT(*) FROM vehicles v WHERE v.user_id = u.id) AS vehicle_count,
         (SELECT COUNT(*) FROM maintenances m WHERE m.user_id = u.id) AS maintenance_count,
         (SELECT COUNT(*) FROM costs co WHERE co.user_id = u.id) AS cost_count,
         COALESCE((SELECT SUM(co.amount) FROM costs co WHERE co.user_id = u.id), 0) AS total_cost,
         CASE WHEN u.id = ? THEN 1 ELSE 0 END AS is_self
       FROM users u
       LEFT JOIN companies c ON c.id = u.company_id
       ORDER BY
         CASE WHEN u.id = ? THEN 0 ELSE 1 END,
         u.created_at DESC,
         u.id DESC`,
      [req.user.id, req.user.id]
    );

    return res.json(rows);
  } catch (error) {
    return databaseError(res, error, "GET /api/users failed:");
  }
});

router.post("/", authenticateToken, requireAdmin, async (req, res) => {
  const parsed = normalizeUserInput(req.body, { passwordRequired: true });
  if (parsed.error) return res.status(400).json({ error: parsed.error });

  const {
    username,
    password,
    email,
    userNumber,
    companyName,
    fullName,
    accountType,
  } = parsed.value;

  let connection;
  try {
    connection = await db.getConnection();
    await connection.beginTransaction();

    const [existing] = await connection.query(
      "SELECT id FROM users WHERE LOWER(email) = LOWER(?) OR LOWER(username) = LOWER(?) LIMIT 1",
      [email, username]
    );
    if (existing.length) {
      await connection.rollback();
      return res.status(409).json({
        error: "Το username ή το email χρησιμοποιείται ήδη.",
        code: "USER_EXISTS",
      });
    }

    let companyId;
    const [companies] = await connection.query(
      "SELECT id FROM companies WHERE LOWER(name) = LOWER(?) LIMIT 1",
      [companyName]
    );
    if (companies.length) {
      companyId = companies[0].id;
    } else {
      const [companyResult] = await connection.query(
        "INSERT INTO companies (name) VALUES (?)",
        [companyName]
      );
      companyId = companyResult.insertId;
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const [result] = await connection.query(
      `INSERT INTO users
         (username, password, full_name, email, role, company_id, user_number,
          account_type, is_active, email_verified)
       VALUES (?, ?, ?, ?, 'user', ?, ?, ?, 1, 1)`,
      [
        username,
        passwordHash,
        fullName,
        email,
        companyId,
        userNumber,
        accountType,
      ]
    );

    await connection.commit();
    return res.status(201).json({
      success: true,
      message: "Ο χρήστης δημιουργήθηκε.",
      user: { id: result.insertId, username, email, companyId },
    });
  } catch (error) {
    if (connection) await connection.rollback().catch(() => {});
    return databaseError(res, error, "POST /api/users failed:");
  } finally {
    connection?.release();
  }
});

router.put("/:id", authenticateToken, requireAdmin, async (req, res) => {
  const userId = Number(req.params.id);
  const parsed = normalizeUserInput(req.body);
  if (parsed.error) return res.status(400).json({ error: parsed.error });

  const {
    username,
    password,
    email,
    userNumber,
    companyName,
    fullName,
    accountType,
  } = parsed.value;

  let connection;
  try {
    connection = await db.getConnection();
    await connection.beginTransaction();

    const [userRows] = await connection.query(
      "SELECT id, role FROM users WHERE id = ? LIMIT 1",
      [userId]
    );
    if (!userRows.length) {
      await connection.rollback();
      return res.status(404).json({ error: "Ο χρήστης δεν βρέθηκε." });
    }
    const targetRole = userRows[0].role;
    const targetIsPrivileged = ADMIN_ROLES.has(targetRole);
    const editingSelf = userId === Number(req.user.id);
    if (targetIsPrivileged && !editingSelf && req.user.role !== "owner") {
      await connection.rollback();
      return res.status(403).json({
        error: "Δεν μπορείτε να επεξεργαστείτε άλλον διαχειριστή.",
      });
    }

    const [duplicates] = await connection.query(
      `SELECT id FROM users
       WHERE id <> ? AND (LOWER(email) = LOWER(?) OR LOWER(username) = LOWER(?))
       LIMIT 1`,
      [userId, email, username]
    );
    if (duplicates.length) {
      await connection.rollback();
      return res.status(409).json({
        error: "Το username ή το email χρησιμοποιείται ήδη.",
        code: "USER_EXISTS",
      });
    }

    let companyId;
    const [companies] = await connection.query(
      "SELECT id FROM companies WHERE LOWER(name) = LOWER(?) LIMIT 1",
      [companyName]
    );
    if (companies.length) {
      companyId = companies[0].id;
    } else {
      const [companyResult] = await connection.query(
        "INSERT INTO companies (name) VALUES (?)",
        [companyName]
      );
      companyId = companyResult.insertId;
    }

    const fields = [
      "username = ?",
      "full_name = ?",
      "email = ?",
      "user_number = ?",
      "company_id = ?",
      "account_type = ?",
    ];
    const params = [
      username,
      fullName,
      email,
      userNumber,
      companyId,
      accountType,
    ];

    if (password) {
      fields.push("password = ?");
      params.push(await bcrypt.hash(password, 12));
    }
    if (typeof req.body.isActive === "boolean" && !targetIsPrivileged) {
      fields.push("is_active = ?");
      params.push(req.body.isActive ? 1 : 0);
    }
    params.push(userId);

    await connection.query(
      `UPDATE users SET ${fields.join(", ")} WHERE id = ?`,
      params
    );
    if (password) {
      await connection.query(
        "UPDATE refresh_tokens SET revoked_at = NOW() WHERE user_id = ? AND revoked_at IS NULL",
        [userId]
      );
    }

    await connection.commit();
    return res.json({ success: true, message: "Ο χρήστης ενημερώθηκε." });
  } catch (error) {
    if (connection) await connection.rollback().catch(() => {});
    return databaseError(res, error, "PUT /api/users/:id failed:");
  } finally {
    connection?.release();
  }
});

router.patch(
  "/:id/role",
  authenticateToken,
  requireAdmin,
  requireOwner,
  async (req, res) => {
    const userId = Number(req.params.id);
    const role = String(req.body?.role || "").trim();
    if (!new Set(["user", "admin"]).has(role)) {
      return res.status(400).json({ error: "Ο ρόλος πρέπει να είναι user ή admin." });
    }

    try {
      const [rows] = await db.query(
        "SELECT id, username, role FROM users WHERE id = ? LIMIT 1",
        [userId]
      );
      if (!rows.length) {
        return res.status(404).json({ error: "Ο χρήστης δεν βρέθηκε." });
      }
      if (rows[0].role === "owner") {
        return res.status(403).json({
          error: "Ο owner είναι προστατευμένος και ο ρόλος του δεν αλλάζει.",
        });
      }
      if (rows[0].role === role) {
        return res.json({
          success: true,
          role,
          message: "Ο χρήστης έχει ήδη αυτόν τον ρόλο.",
        });
      }

      await db.query("UPDATE users SET role = ? WHERE id = ?", [role, userId]);
      if (role === "user") {
        await db.query(
          "UPDATE refresh_tokens SET revoked_at = NOW() WHERE user_id = ? AND revoked_at IS NULL",
          [userId]
        );
      }

      return res.json({
        success: true,
        role,
        message:
          role === "admin"
            ? `Ο χρήστης ${rows[0].username} έγινε admin.`
            : `Αφαιρέθηκαν τα δικαιώματα admin από τον χρήστη ${rows[0].username}.`,
      });
    } catch (error) {
      return databaseError(res, error, "PATCH /api/users/:id/role failed:");
    }
  }
);

router.patch(
  "/:id/toggle-active",
  authenticateToken,
  requireAdmin,
  async (req, res) => {
    const userId = Number(req.params.id);
    try {
      const [rows] = await db.query(
        "SELECT id, is_active, role FROM users WHERE id = ? LIMIT 1",
        [userId]
      );
      if (!rows.length) {
        return res.status(404).json({ error: "Ο χρήστης δεν βρέθηκε." });
      }
      if (ADMIN_ROLES.has(rows[0].role)) {
        return res.status(403).json({
          error: "Δεν μπορείτε να απενεργοποιήσετε διαχειριστή.",
        });
      }

      const isActive = rows[0].is_active ? 0 : 1;
      await db.query("UPDATE users SET is_active = ? WHERE id = ?", [
        isActive,
        userId,
      ]);
      if (!isActive) {
        await db.query(
          "UPDATE refresh_tokens SET revoked_at = NOW() WHERE user_id = ? AND revoked_at IS NULL",
          [userId]
        );
      }

      return res.json({
        success: true,
        isActive: Boolean(isActive),
        message: isActive
          ? "Ο χρήστης ενεργοποιήθηκε."
          : "Ο χρήστης απενεργοποιήθηκε και αποσυνδέθηκε.",
      });
    } catch (error) {
      return databaseError(res, error, "PATCH /api/users/:id/toggle-active failed:");
    }
  }
);

router.delete("/:id", authenticateToken, requireAdmin, async (req, res) => {
  const userId = Number(req.params.id);
  let connection;
  try {
    connection = await db.getConnection();
    await connection.beginTransaction();

    const [rows] = await connection.query(
      `SELECT
         u.id, u.username, u.role, u.company_id,
         (SELECT COUNT(*) FROM vehicles v WHERE v.user_id = u.id) AS vehicle_count,
         (SELECT COUNT(*) FROM maintenances m WHERE m.user_id = u.id) AS maintenance_count,
         (SELECT COUNT(*) FROM costs c WHERE c.user_id = u.id) AS cost_count
       FROM users u WHERE u.id = ? LIMIT 1`,
      [userId]
    );
    if (!rows.length) {
      await connection.rollback();
      return res.status(404).json({ error: "Ο χρήστης δεν βρέθηκε." });
    }
    if (ADMIN_ROLES.has(rows[0].role)) {
      await connection.rollback();
      return res.status(403).json({
        error: "Οι λογαριασμοί διαχειριστή προστατεύονται από διαγραφή.",
      });
    }

    const target = rows[0];
    await connection.query("DELETE FROM users WHERE id = ?", [userId]);
    if (target.company_id) {
      await connection.query(
        `DELETE FROM companies
         WHERE id = ? AND NOT EXISTS (SELECT 1 FROM users WHERE company_id = ?)`,
        [target.company_id, target.company_id]
      );
    }
    await connection.commit();

    return res.json({
      success: true,
      message: `Ο χρήστης ${target.username} διαγράφηκε οριστικά.`,
      deleted: {
        id: target.id,
        username: target.username,
        vehicles: Number(target.vehicle_count || 0),
        maintenances: Number(target.maintenance_count || 0),
        costs: Number(target.cost_count || 0),
      },
    });
  } catch (error) {
    if (connection) await connection.rollback().catch(() => {});
    return databaseError(res, error, "DELETE /api/users/:id failed:");
  } finally {
    connection?.release();
  }
});

module.exports = router;
