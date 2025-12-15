// routes/vehicles.js
const express = require("express");
const router = express.Router();
const db = require("../db");

// GET /api/vehicles
// GET /api/vehicles
router.get("/", async (req, res) => {
  try {
    const userId = req.user.id;

    const [rows] = await db.query(
      `SELECT
         v.id,
         v.vehicle_type    AS vehicleType,
         v.chassis_number  AS chassisNumber,
         v.model,
         v.year,
         v.current_mileage AS currentMileage,
         u.company_id      AS companyId
       FROM vehicles v
       JOIN users u ON v.user_id = u.id
       WHERE v.user_id = ?
       ORDER BY v.id DESC`,
      [userId]
    );

    res.json(rows);
  } catch (err) {
    console.error("Get vehicles error:", err);
    res.status(500).json({ error: "Σφάλμα κατά την ανάκτηση οχημάτων" });
  }
});

// POST /api/vehicles
router.post("/", async (req, res) => {
  try {
    const userId = req.user.id;
    const { vehicleType, chassisNumber, model, year, currentMileage } =
      req.body || {};

    if (!vehicleType || !chassisNumber) {
      return res.status(400).json({
        error: "Τύπος οχήματος και αριθμός πλαισίου είναι υποχρεωτικά",
      });
    }

    const [result] = await db.query(
      `INSERT INTO vehicles (user_id, vehicle_type, chassis_number, model, year, current_mileage)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        userId,
        vehicleType,
        chassisNumber,
        model || null,
        year || null,
        currentMileage || null,
      ]
    );

    const insertedId = result.insertId;

    const [rows] = await db.query(
      `SELECT
     v.id,
     v.vehicle_type    AS vehicleType,
     v.chassis_number  AS chassisNumber,
     v.model,
     v.year,
     v.current_mileage AS currentMileage,
     u.company_id      AS companyId
   FROM vehicles v
   JOIN users u ON v.user_id = u.id
   WHERE v.id = ?`,
      [insertedId]
    );

    res.status(201).json(rows[0]);
  } catch (err) {
    console.error("Add vehicle error:", err);
    res.status(500).json({ error: "Σφάλμα κατά την προσθήκη οχήματος" });
  }
});

// PUT /api/vehicles/:id
router.put("/:id", async (req, res) => {
  try {
    const userId = req.user.id;
    const vehicleId = req.params.id;
    const { vehicleType, chassisNumber, model, year, currentMileage } =
      req.body || {};

    const [existingRows] = await db.query(
      "SELECT id FROM vehicles WHERE id = ? AND user_id = ?",
      [vehicleId, userId]
    );
    if (!existingRows.length) {
      return res.status(404).json({ error: "Το όχημα δεν βρέθηκε" });
    }

    await db.query(
      `UPDATE vehicles
       SET vehicle_type = ?, chassis_number = ?, model = ?, year = ?, current_mileage = ?
       WHERE id = ?`,
      [
        vehicleType,
        chassisNumber,
        model || null,
        year || null,
        currentMileage || null,
        vehicleId,
      ]
    );

    const [rows] = await db.query(
      `SELECT
     v.id,
     v.vehicle_type    AS vehicleType,
     v.chassis_number  AS chassisNumber,
     v.model,
     v.year,
     v.current_mileage AS currentMileage,
     u.company_id      AS companyId
   FROM vehicles v
   JOIN users u ON v.user_id = u.id
   WHERE v.id = ?`,
      [vehicleId]
    );

    res.json(rows[0]);
  } catch (err) {
    console.error("Update vehicle error:", err);
    res.status(500).json({ error: "Σφάλμα κατά την ενημέρωση οχήματος" });
  }
});

// DELETE /api/vehicles/:id
router.delete("/:id", async (req, res) => {
  try {
    const userId = req.user.id;
    const vehicleId = req.params.id;

    const [existingRows] = await db.query(
      "SELECT id FROM vehicles WHERE id = ? AND user_id = ?",
      [vehicleId, userId]
    );
    if (!existingRows.length) {
      return res.status(404).json({ error: "Το όχημα δεν βρέθηκε" });
    }

    await db.query("DELETE FROM vehicles WHERE id = ?", [vehicleId]);

    res.json({ success: true });
  } catch (err) {
    console.error("Delete vehicle error:", err);
    res.status(500).json({ error: "Σφάλμα κατά τη διαγραφή οχήματος" });
  }
});

module.exports = router;
