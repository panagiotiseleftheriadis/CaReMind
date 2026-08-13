// routes/costs.js
const express = require("express");
const router = express.Router();
const db = require("../db");
const { isPositiveId, requirePositiveId } = require("../validation");

router.param("id", requirePositiveId);

function isValidDate(value) {
  const raw = String(value || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return false;
  const parsed = new Date(`${raw}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === raw;
}

async function userOwnsVehicle(userId, vehicleId) {
  const [rows] = await db.query(
    "SELECT id FROM vehicles WHERE id = ? AND user_id = ? LIMIT 1",
    [vehicleId, userId]
  );
  return rows.length > 0;
}

// GET /api/costs
router.get("/", async (req, res) => {
  try {
    const userId = req.user.id;
    const [rows] = await db.query(
      `SELECT
         id,
         vehicle_id AS vehicleId,
         category,
         amount,
         cost_date AS date,
         description,
         receipt_number AS receiptNumber,
         created_at  -- ✅ ΠΡΟΣΘΗΚΗ ΕΔΩ
       FROM costs
       WHERE user_id = ?
       ORDER BY cost_date DESC, id DESC`,
      [userId]
    );
    res.json(rows);
  } catch (err) {
    console.error("Get costs error:", err);
    res.status(500).json({ error: "Σφάλμα κατά την ανάκτηση κόστους" });
  }
});

// POST /api/costs
router.post("/", async (req, res) => {
  try {
    const userId = req.user.id;
    const { vehicleId, category, amount, date, description, receiptNumber } =
      req.body || {};

    const normalizedAmount = Number(amount);
    if (!isPositiveId(vehicleId) || !category || !Number.isFinite(normalizedAmount) || normalizedAmount <= 0 || !isValidDate(date)) {
      return res
        .status(400)
        .json({ error: "Απαιτούνται όχημα, κατηγορία, ποσό και ημερομηνία" });
    }
    if (!(await userOwnsVehicle(userId, vehicleId))) {
      return res.status(404).json({ error: "Το όχημα δεν βρέθηκε" });
    }
    if (String(category).length > 100) {
      return res.status(400).json({ error: "Η κατηγορία είναι πολύ μεγάλη" });
    }
    if (String(receiptNumber || "").length > 100 || String(description || "").length > 10000) {
      return res.status(400).json({ error: "Η περιγραφή ή ο αριθμός απόδειξης είναι πολύ μεγάλος" });
    }

    const [result] = await db.query(
      `INSERT INTO costs
       (user_id, vehicle_id, category, amount, cost_date, description, receipt_number)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        userId,
        vehicleId,
        category,
        normalizedAmount,
        date,
        description || null,
        receiptNumber || null,
      ]
    );

    const insertedId = result.insertId;

    const [rows] = await db.query(
      `SELECT
         id,
         vehicle_id AS vehicleId,
         category,
         amount,
         cost_date AS date,
         description,
         receipt_number AS receiptNumber
       FROM costs
       WHERE id = ?`,
      [insertedId]
    );

    res.status(201).json(rows[0]);
  } catch (err) {
    console.error("Add cost error:", err);
    res.status(500).json({ error: "Σφάλμα κατά την προσθήκη κόστους" });
  }
});

// PUT /api/costs/:id
router.put("/:id", async (req, res) => {
  try {
    const userId = req.user.id;
    const costId = req.params.id;
    const { vehicleId, category, amount, date, description, receiptNumber } =
      req.body || {};

    const normalizedAmount = Number(amount);
    if (
      !isPositiveId(vehicleId) ||
      !category ||
      !Number.isFinite(normalizedAmount) ||
      normalizedAmount <= 0 ||
      !isValidDate(date)
    ) {
      return res.status(400).json({ error: "Μη έγκυρα στοιχεία κόστους" });
    }
    if (!(await userOwnsVehicle(userId, vehicleId))) {
      return res.status(404).json({ error: "Το όχημα δεν βρέθηκε" });
    }
    if (
      String(category).length > 100 ||
      String(receiptNumber || "").length > 100 ||
      String(description || "").length > 10000
    ) {
      return res.status(400).json({ error: "Τα στοιχεία κόστους είναι πολύ μεγάλα" });
    }

    // Έλεγχος αν υπάρχει το κόστος
    const [existingRows] = await db.query(
      "SELECT id FROM costs WHERE id = ? AND user_id = ?",
      [costId, userId]
    );

    if (!existingRows.length) {
      return res.status(404).json({ error: "Το κόστος δεν βρέθηκε" });
    }

    // Ενημέρωση - χρησιμοποιήστε το user_id από το JWT token
    await db.query(
      `UPDATE costs 
       SET vehicle_id = ?, 
           category = ?, 
           amount = ?, 
           cost_date = ?, 
           description = ?, 
           receipt_number = ?
       WHERE id = ? AND user_id = ?`,
      [
        vehicleId,
        category,
        normalizedAmount,
        date,
        description || null,
        receiptNumber || null,
        costId,
        userId, // Από το JWT token, όχι από το request body
      ]
    );

    // Επιστροφή των ενημερωμένων δεδομένων
    const [updatedRows] = await db.query(
      `SELECT
         id,
         vehicle_id AS vehicleId,
         category,
         amount,
         cost_date AS date,
         description,
         receipt_number AS receiptNumber
       FROM costs
       WHERE id = ?`,
      [costId]
    );

    res.json(updatedRows[0]);
  } catch (err) {
    console.error("Update cost error:", err);
    res.status(500).json({ error: "Σφάλμα κατά την ενημέρωση κόστους" });
  }
});

// DELETE /api/costs/:id
router.delete("/:id", async (req, res) => {
  try {
    const userId = req.user.id;
    const costId = req.params.id;

    const [existingRows] = await db.query(
      "SELECT id FROM costs WHERE id = ? AND user_id = ?",
      [costId, userId]
    );
    if (!existingRows.length) {
      return res.status(404).json({ error: "Το κόστος δεν βρέθηκε" });
    }

    await db.query("DELETE FROM costs WHERE id = ? AND user_id = ?", [costId, userId]);

    res.json({ success: true });
  } catch (err) {
    console.error("Delete cost error:", err);
    res.status(500).json({ error: "Σφάλμα κατά τη διαγραφή κόστους" });
  }
});

module.exports = router;
