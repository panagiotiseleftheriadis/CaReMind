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
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email).trim())) {
      return res.status(400).json({ error: "Μη έγκυρο email" });
    }
    if (String(fullName).length > 100 || String(message || "").length > 2000) {
      return res.status(400).json({ error: "Το αίτημα υπερβαίνει το επιτρεπτό μέγεθος" });
    }
    if (fleetSize != null && fleetSize !== "" && (!Number.isInteger(Number(fleetSize)) || Number(fleetSize) < 0)) {
      return res.status(400).json({ error: "Μη έγκυρο μέγεθος στόλου" });
    }

    await db.query(
      `INSERT INTO interest_requests
       (full_name, email, phone, company_name, fleet_size, message)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        String(fullName).trim(),
        String(email).trim().toLowerCase(),
        phone || null,
        companyName || null,
        fleetSize === "" || fleetSize == null ? null : Number(fleetSize),
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
