const express = require("express");
const router = express.Router();
const db = require("../db");

// ========= TEST ROUTE ========= //
router.get("/test", async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT 
        m.id AS maintenance_id,
        m.user_id,
        m.vehicle_id,
        m.maintenance_type,
        m.next_date,
        m.notification_days,
        u.email,
        u.user_number
      FROM maintenances m
      JOIN users u ON u.id = m.user_id
      WHERE 
        m.next_date IS NOT NULL
        AND m.notification_days IS NOT NULL
        AND DATE(m.next_date) - INTERVAL m.notification_days DAY = CURDATE();
    `);

    return res.json(rows);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Query failed" });
  }
});

module.exports = router;
