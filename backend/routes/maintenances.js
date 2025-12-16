// routes/maintenances.js
const express = require("express");
const router = express.Router();
const db = require("../db");

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
         notes
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

    if (!vehicleId || !maintenanceType) {
      return res
        .status(400)
        .json({ error: "Απαιτείται όχημα και τύπος συντήρησης" });
    }

    const [result] = await db.query(
      `INSERT INTO maintenances
       (user_id, vehicle_id, maintenance_type, last_date, next_date, last_mileage, next_mileage, notification_days, status, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        userId,
        vehicleId,
        maintenanceType,
        lastDate || null,
        nextDate || null,
        lastMileage || null,
        nextMileage || null,
        notificationDays || 7,
        status || "active",
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
// PUT /api/maintenances/:id - διορθωμένο
router.put("/:id", async (req, res) => {
  console.log("🔧 PUT /maintenances/:id - Request Body:", req.body);
  console.log("🔧 User ID:", req.user.id);
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

    // 🔧 ΔΙΟΡΘΩΣΗ: Μετατροπή "completed" σε "inactive"
    const dbStatus = status === "completed" ? "inactive" : status || "active";

    await db.query(
      `UPDATE maintenances
       SET vehicle_id = ?, maintenance_type = ?, last_date = ?, next_date = ?,
           last_mileage = ?, next_mileage = ?, notification_days = ?, status = ?, notes = ?
       WHERE id = ?`,
      [
        vehicleId,
        maintenanceType,
        lastDate || null,
        nextDate || null,
        lastMileage || null,
        nextMileage || null,
        notificationDays || 7,
        dbStatus, // 🔧 Χρησιμοποιούμε τη μετατρεπόμενη τιμή
        notes || null,
        maintenanceId,
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
    console.error("Update maintenance error:", err);
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

    await db.query("DELETE FROM maintenances WHERE id = ?", [maintenanceId]);

    res.json({ success: true });
  } catch (err) {
    console.error("Delete maintenance error:", err);
    res.status(500).json({ error: "Σφάλμα κατά τη διαγραφή συντήρησης" });
  }
});

module.exports = router;
