// routes/vehicles.js
const express = require("express");
const router = express.Router();
const db = require("../db");
const { requirePositiveId } = require("../validation");

router.param("id", requirePositiveId);

function validateVehicleInput({ vehicleType, chassisNumber, model, year, currentMileage }) {
  if (!vehicleType || !chassisNumber) {
    return "Τύπος οχήματος και αριθμός πλαισίου είναι υποχρεωτικά";
  }
  if (String(vehicleType).length > 100 || String(chassisNumber).length > 50) {
    return "Τα στοιχεία του οχήματος είναι πολύ μεγάλα";
  }
  if (model != null && String(model).length > 100) {
    return "Το μοντέλο είναι πολύ μεγάλο";
  }
  const maxYear = new Date().getFullYear() + 1;
  if (year != null && year !== "" && (!Number.isInteger(Number(year)) || Number(year) < 1886 || Number(year) > maxYear)) {
    return "Μη έγκυρο έτος οχήματος";
  }
  if (
    currentMileage != null &&
    currentMileage !== "" &&
    (!Number.isInteger(Number(currentMileage)) || Number(currentMileage) < 0)
  ) {
    return "Τα χιλιόμετρα πρέπει να είναι μη αρνητικός ακέραιος";
  }
  return null;
}

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
         u.company_id      AS companyId,
         v.created_at      -- ✅ ΠΡΟΣΘΗΚΗ ΕΔΩ (με το v. μπροστά)
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

    const validationError = validateVehicleInput({
      vehicleType,
      chassisNumber,
      model,
      year,
      currentMileage,
    });
    if (validationError) {
      return res.status(400).json({ error: validationError });
    }

    const [duplicates] = await db.query(
      "SELECT id FROM vehicles WHERE user_id = ? AND chassis_number = ? LIMIT 1",
      [userId, String(chassisNumber).trim()]
    );
    if (duplicates.length) {
      return res.status(409).json({ error: "Υπάρχει ήδη όχημα με αυτόν τον αριθμό πλαισίου" });
    }

    const [result] = await db.query(
      `INSERT INTO vehicles (user_id, vehicle_type, chassis_number, model, year, current_mileage)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        userId,
        vehicleType,
        String(chassisNumber).trim(),
        model || null,
        year === "" || year == null ? null : Number(year),
        currentMileage === "" || currentMileage == null ? null : Number(currentMileage),
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

    const validationError = validateVehicleInput({
      vehicleType,
      chassisNumber,
      model,
      year,
      currentMileage,
    });
    if (validationError) {
      return res.status(400).json({ error: validationError });
    }

    const [existingRows] = await db.query(
      "SELECT id FROM vehicles WHERE id = ? AND user_id = ?",
      [vehicleId, userId]
    );
    if (!existingRows.length) {
      return res.status(404).json({ error: "Το όχημα δεν βρέθηκε" });
    }

    const [duplicates] = await db.query(
      `SELECT id FROM vehicles
       WHERE user_id = ? AND chassis_number = ? AND id <> ?
       LIMIT 1`,
      [userId, String(chassisNumber).trim(), vehicleId]
    );
    if (duplicates.length) {
      return res.status(409).json({ error: "Υπάρχει ήδη όχημα με αυτόν τον αριθμό πλαισίου" });
    }

    await db.query(
      `UPDATE vehicles
       SET vehicle_type = ?, chassis_number = ?, model = ?, year = ?, current_mileage = ?
       WHERE id = ? AND user_id = ?`,
      [
        vehicleType,
        String(chassisNumber).trim(),
        model || null,
        year === "" || year == null ? null : Number(year),
        currentMileage === "" || currentMileage == null ? null : Number(currentMileage),
        vehicleId,
        userId,
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

    await db.query("DELETE FROM vehicles WHERE id = ? AND user_id = ?", [vehicleId, userId]);

    res.json({ success: true });
  } catch (err) {
    console.error("Delete vehicle error:", err);
    res.status(500).json({ error: "Σφάλμα κατά τη διαγραφή οχήματος" });
  }
});

module.exports = router;
