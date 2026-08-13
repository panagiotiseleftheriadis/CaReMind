// routes/maintenances.js
const express = require("express");
const router = express.Router();
const db = require("../db");
const { isPositiveId, requirePositiveId } = require("../validation");

router.param("id", requirePositiveId);

const ALLOWED_STATUSES = new Set(["active", "pending", "completed", "overdue"]);

function toSqlDate(value) {
  if (!value) return null;
  const raw = String(value).slice(0, 10);
  const parsed = new Date(`${raw}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== raw) {
    return null;
  }
  return raw;
}

function validOptionalMileage(value) {
  return value == null || value === "" || (Number.isInteger(Number(value)) && Number(value) >= 0);
}

async function userOwnsVehicle(userId, vehicleId) {
  const [rows] = await db.query(
    "SELECT id FROM vehicles WHERE id = ? AND user_id = ? LIMIT 1",
    [vehicleId, userId]
  );
  return rows.length > 0;
}

// GET /api/maintenances
router.get("/", async (req, res) => {
  try {
    const userId = req.user.id;
    const [rows] = await db.query(
      `SELECT
         id,
         vehicle_id AS vehicleId,
         maintenance_type AS maintenanceType,
         last_date AS lastDate,
         next_date AS nextDate,
         last_mileage AS lastMileage,
         next_mileage AS nextMileage,
         notification_days AS notificationDays,
         status,
         notes,
         created_at    -- ✅ ΠΡΟΣΘΗΚΗ ΕΔΩ
       FROM maintenances
       WHERE user_id = ?
       ORDER BY id DESC`,
      [userId]
    );
    res.json(rows);
  } catch (err) {
    console.error("Get maintenances error:", err);
    res.status(500).json({ error: "Σφάλμα κατά την ανάκτηση συντηρήσεων" });
  }
});

// POST /api/maintenances
router.post("/", async (req, res) => {
  try {
    const userId = req.user.id;
    const {
      vehicleId,
      maintenanceType,
      lastDate,
      nextDate,
      lastMileage,
      nextMileage,
      notificationDays,
      status,
      notes,
    } = req.body || {};

    if (!isPositiveId(vehicleId) || !maintenanceType) {
      return res
        .status(400)
        .json({ error: "Απαιτείται όχημα και τύπος συντήρησης" });
    }
    if (!(await userOwnsVehicle(userId, vehicleId))) {
      return res.status(404).json({ error: "Το όχημα δεν βρέθηκε" });
    }
    if (String(maintenanceType).length > 100 || String(notes || "").length > 10000) {
      return res.status(400).json({ error: "Τα στοιχεία συντήρησης είναι πολύ μεγάλα" });
    }

    const normalizedLastDate = lastDate ? toSqlDate(lastDate) : null;
    const normalizedNextDate = nextDate ? toSqlDate(nextDate) : null;
    const normalizedNotificationDays = notificationDays == null ? 7 : Number(notificationDays);
    const normalizedStatus = status || "pending";

    if ((lastDate && !normalizedLastDate) || (nextDate && !normalizedNextDate)) {
      return res.status(400).json({ error: "Μη έγκυρη ημερομηνία" });
    }
    if (!validOptionalMileage(lastMileage) || !validOptionalMileage(nextMileage)) {
      return res.status(400).json({ error: "Τα χιλιόμετρα πρέπει να είναι θετικός αριθμός" });
    }
    if (!Number.isInteger(normalizedNotificationDays) || normalizedNotificationDays < 0 || normalizedNotificationDays > 365) {
      return res.status(400).json({ error: "Οι ημέρες ειδοποίησης πρέπει να είναι από 0 έως 365" });
    }
    if (!ALLOWED_STATUSES.has(normalizedStatus)) {
      return res.status(400).json({ error: "Μη έγκυρη κατάσταση συντήρησης" });
    }

    const [result] = await db.query(
      `INSERT INTO maintenances
       (user_id, vehicle_id, maintenance_type, last_date, next_date, last_mileage, next_mileage, notification_days, status, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        userId,
        vehicleId,
        maintenanceType,
        normalizedLastDate,
        normalizedNextDate,
        lastMileage === "" ? null : lastMileage,
        nextMileage === "" ? null : nextMileage,
        normalizedNotificationDays,
        normalizedStatus,
        notes || null,
      ]
    );

    const insertedId = result.insertId;

    const [rows] = await db.query(
      `SELECT
         id,
         vehicle_id AS vehicleId,
         maintenance_type AS maintenanceType,
         last_date AS lastDate,
         next_date AS nextDate,
         last_mileage AS lastMileage,
         next_mileage AS nextMileage,
         notification_days AS notificationDays,
         status,
         notes
       FROM maintenances
       WHERE id = ?`,
      [insertedId]
    );

    res.status(201).json(rows[0]);
  } catch (err) {
    console.error("Add maintenance error:", err);
    res.status(500).json({ error: "Σφάλμα κατά την προσθήκη συντήρησης" });
  }
});

// PUT /api/maintenances/:id
router.put("/:id", async (req, res) => {
  try {
    const userId = req.user.id;
    const maintenanceId = req.params.id;
    const {
      vehicleId,
      maintenanceType,
      lastDate,
      nextDate,
      lastMileage,
      nextMileage,
      notificationDays,
      status,
      notes,
    } = req.body || {};

    const [existingRows] = await db.query(
      "SELECT id FROM maintenances WHERE id = ? AND user_id = ?",
      [maintenanceId, userId]
    );
    if (!existingRows.length) {
      return res.status(404).json({ error: "Η συντήρηση δεν βρέθηκε" });
    }

    if (!isPositiveId(vehicleId)) {
      return res.status(400).json({ error: "Μη έγκυρο αναγνωριστικό οχήματος" });
    }
    if (!(await userOwnsVehicle(userId, vehicleId))) {
      return res.status(404).json({ error: "Το όχημα δεν βρέθηκε" });
    }
    if (!maintenanceType || String(maintenanceType).length > 100 || String(notes || "").length > 10000) {
      return res.status(400).json({ error: "Μη έγκυρα στοιχεία συντήρησης" });
    }

    const normalizedLastDate = lastDate ? toSqlDate(lastDate) : null;
    const normalizedNextDate = nextDate ? toSqlDate(nextDate) : null;
    const normalizedNotificationDays = notificationDays == null ? 7 : Number(notificationDays);
    const normalizedStatus = status || "pending";

    if ((lastDate && !normalizedLastDate) || (nextDate && !normalizedNextDate)) {
      return res.status(400).json({ error: "Μη έγκυρη ημερομηνία" });
    }
    if (!validOptionalMileage(lastMileage) || !validOptionalMileage(nextMileage)) {
      return res.status(400).json({ error: "Τα χιλιόμετρα πρέπει να είναι θετικός αριθμός" });
    }
    if (!Number.isInteger(normalizedNotificationDays) || normalizedNotificationDays < 0 || normalizedNotificationDays > 365) {
      return res.status(400).json({ error: "Οι ημέρες ειδοποίησης πρέπει να είναι από 0 έως 365" });
    }
    if (!ALLOWED_STATUSES.has(normalizedStatus)) {
      return res.status(400).json({ error: "Μη έγκυρη κατάσταση συντήρησης" });
    }

    await db.query(
      `UPDATE maintenances
       SET vehicle_id = ?, maintenance_type = ?, last_date = ?, next_date = ?,
           last_mileage = ?, next_mileage = ?, notification_days = ?, status = ?, notes = ?
       WHERE id = ? AND user_id = ?`,
      [
        vehicleId,
        maintenanceType,
        normalizedLastDate,
        normalizedNextDate,
        lastMileage === "" ? null : lastMileage,
        nextMileage === "" ? null : nextMileage,
        normalizedNotificationDays,
        normalizedStatus,
        notes || null,
        maintenanceId,
        userId,
      ]
    );

    const [rows] = await db.query(
      `SELECT
         id,
         vehicle_id AS vehicleId,
         maintenance_type AS maintenanceType,
         last_date AS lastDate,
         next_date AS nextDate,
         last_mileage AS lastMileage,
         next_mileage AS nextMileage,
         notification_days AS notificationDays,
         status,
         notes
       FROM maintenances
       WHERE id = ?`,
      [maintenanceId]
    );

    res.json(rows[0]);
  } catch (err) {
    console.error("❌ Update maintenance error:");
    console.error("MySQL / Server error:", err);
    console.error("➡️ req.body:", req.body);
    console.error("➡️ maintenanceId:", req.params.id);
    console.error("➡️ userId:", req.user?.id);

    res.status(500).json({ error: "Σφάλμα κατά την ενημέρωση συντήρησης" });
  }
});

// DELETE /api/maintenances/:id
router.delete("/:id", async (req, res) => {
  try {
    const userId = req.user.id;
    const maintenanceId = req.params.id;

    const [existingRows] = await db.query(
      "SELECT id FROM maintenances WHERE id = ? AND user_id = ?",
      [maintenanceId, userId]
    );
    if (!existingRows.length) {
      return res.status(404).json({ error: "Η συντήρηση δεν βρέθηκε" });
    }

    await db.query("DELETE FROM maintenances WHERE id = ? AND user_id = ?", [
      maintenanceId,
      userId,
    ]);

    res.json({ success: true });
  } catch (err) {
    console.error("Delete maintenance error:", err);
    res.status(500).json({ error: "Σφάλμα κατά τη διαγραφή συντήρησης" });
  }
});

module.exports = router;
