const express = require("express");
const router = express.Router();
const db = require("../db");

// GET /api/notifications
// Only upcoming or overdue reminders owned by the authenticated user.
router.get("/", async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT
         m.id,
         m.maintenance_type AS maintenanceType,
         m.next_date AS dueDate,
         DATEDIFF(m.next_date, CURDATE()) AS daysUntilDue,
         v.model,
         v.chassis_number AS chassisNumber
       FROM maintenances m
       JOIN vehicles v ON v.id = m.vehicle_id AND v.user_id = m.user_id
       WHERE m.user_id = ?
         AND m.next_date IS NOT NULL
         AND m.status <> 'completed'
         AND DATEDIFF(m.next_date, CURDATE()) <= COALESCE(m.notification_days, 7)
       ORDER BY m.next_date ASC
       LIMIT 50`,
      [req.user.id]
    );

    return res.json(
      rows.map((row) => {
        const daysUntilDue = Number(row.daysUntilDue);
        return {
          id: row.id,
          maintenanceType: row.maintenanceType,
          dueDate: row.dueDate,
          daysUntilDue,
          vehicleLabel: row.model || row.chassisNumber || "Όχημα",
          severity:
            daysUntilDue < 0
              ? "danger"
              : daysUntilDue <= 3
                ? "warning"
                : "info",
        };
      })
    );
  } catch (err) {
    console.error("Notifications query error:", err);
    return res.status(500).json({ error: "Σφάλμα φόρτωσης ειδοποιήσεων" });
  }
});

module.exports = router;
