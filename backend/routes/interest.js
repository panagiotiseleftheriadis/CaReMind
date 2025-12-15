// routes/interest.js
const express = require("express");
const router = express.Router();
const db = require("../db");

// POST /api/interest
router.post("/", async (req, res) => {
  try {
    const { fullName, email, phone, companyName, fleetSize, message } =
      req.body || {};

    if (!fullName || !email) {
      return res
        .status(400)
        .json({ error: "Ονοματεπώνυμο και email είναι υποχρεωτικά" });
    }

    await db.query(
      `INSERT INTO interest_requests
       (full_name, email, phone, company_name, fleet_size, message)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        fullName,
        email,
        phone || null,
        companyName || null,
        fleetSize || null,
        message || null,
      ]
    );

    res.status(201).json({ success: true });
  } catch (err) {
    console.error("Interest request error:", err);
    res
      .status(500)
      .json({ error: "Σφάλμα κατά την αποθήκευση του ενδιαφέροντος" });
  }
});

module.exports = router;
