// routes/costs.js
const express = require("express");
const router = express.Router();
const db = require("../db");

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
         receipt_number AS receiptNumber
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

    if (!vehicleId || !category || !amount || !date) {
      return res
        .status(400)
        .json({ error: "Απαιτούνται όχημα, κατηγορία, ποσό και ημερομηνία" });
    }

    const [result] = await db.query(
      `INSERT INTO costs
       (user_id, vehicle_id, category, amount, cost_date, description, receipt_number)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        userId,
        vehicleId,
        category,
        amount,
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
        amount,
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

    await db.query("DELETE FROM costs WHERE id = ?", [costId]);

    res.json({ success: true });
  } catch (err) {
    console.error("Delete cost error:", err);
    res.status(500).json({ error: "Σφάλμα κατά τη διαγραφή κόστους" });
  }
});

module.exports = router;
