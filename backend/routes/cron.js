// routes/cron.js
const express = require("express");
const crypto = require("crypto");
const sendMail = require("../emailService");
const db = require("../db");

const router = express.Router();

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;",
  })[character]);
}

router.get("/maintenance", async (req, res) => {
  const expectedSecret = String(process.env.CRON_SECRET || "");
  const providedSecret = String(req.headers["x-cron-secret"] || "");

  if (!expectedSecret) {
    return res.status(503).json({ error: "Cron service is not configured" });
  }

  const validSecret =
    providedSecret.length === expectedSecret.length &&
    crypto.timingSafeEqual(Buffer.from(providedSecret), Buffer.from(expectedSecret));

  if (!validSecret) {
    return res.status(401).json({ error: "Unauthorized" });
  }

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
        u.user_number,
        v.model,
        v.chassis_number
      FROM maintenances m
      JOIN users u ON u.id = m.user_id
      JOIN vehicles v ON v.id = m.vehicle_id
      WHERE 
        m.next_date IS NOT NULL
        AND m.notification_days IS NOT NULL
        AND DATE(m.next_date) - INTERVAL m.notification_days DAY = CURDATE();
    `);

    let sent = 0;
    let skipped = 0;

    if (rows.length > 0) {
      for (const item of rows) {
        // Build recipient list: user's main email + any extra notification recipients
        const primaryEmail = String(item.email || "")
          .trim()
          .toLowerCase();
        let recipients = [];
        if (primaryEmail) recipients.push(primaryEmail);

        try {
          const [extra] = await db.query(
            `SELECT value FROM notification_recipients
             WHERE user_id = ? AND type = 'email' AND is_active = 1`,
            [item.user_id]
          );
          for (const r of extra) {
            const e = String(r.value || "")
              .trim()
              .toLowerCase();
            if (e && !recipients.includes(e)) recipients.push(e);
          }
        } catch (_) {
          // If table doesn't exist or query fails, we still send to primary
        }

        if (recipients.length === 0) {
          skipped++;
          continue;
        }

        const typeLabels = {
          oil: "Αλλαγή Λαδιών",
          service: "Γενικό Σέρβις",
          insurance: "Ανανέωση Ασφάλειας",
          kteo: "ΚΤΕΟ",
          tires: "Αλλαγή Λαστίχων",
          brakes: "Αλλαγή Φρένων",
          battery: "Αλλαγή Μπαταρίας",
          other: "Άλλο",
        };

        const maintenanceName =
          typeLabels[item.maintenance_type] || item.maintenance_type;

        const dateObj = new Date(item.next_date);
        const dateStr = dateObj.toLocaleDateString("el-GR", {
          day: "2-digit",
          month: "2-digit",
          year: "numeric",
        });

        const vehicleLabel = item.model
          ? `${item.model} (${item.chassis_number || ""})`
          : item.chassis_number || "Όχημα";

        const safeMaintenanceName = escapeHtml(maintenanceName);
        const safeVehicleLabel = escapeHtml(vehicleLabel);
        const subject = `Υπενθύμιση: ${maintenanceName} — ${vehicleLabel}`.replace(/[\r\n]/g, " ");

        const messageHtml = `
<div style="font-family: Arial, sans-serif; background:#F4F5F7; padding:25px 0;">
  <div style="max-width:560px; background:#ffffff; margin:0 auto; border-radius:12px; border:1px solid #E2E4E8; padding:24px 26px; box-shadow:0 6px 18px rgba(0,0,0,0.04);">
    
    <!-- LOGO -->
    <div style="text-align:center; margin-bottom:18px;">
      <img src="https://i.imgur.com/1KsMfep.png" style="height:60px;" alt="CaReMind" />

    </div>

    <!-- ΤΙΤΛΟΣ -->
    <h2 style="text-align:center; color:#111827; margin:0; font-size:22px; font-weight:700; letter-spacing:0.3px;">
      Υπενθύμιση Συντήρησης Οχήματος
    </h2>

    <p style="text-align:center; margin:6px 0 22px; color:#6B7280; font-size:13px;">
      <span style="color:#FF7777; font-weight:600;">CaReMind</span> · Vehicle Maintenance Reminder
    </p>

    <!-- ΚΕΙΜΕΝΟ -->
    <p style="font-size:14px; color:#1F2933; line-height:1.7; margin:0 0 14px;">
      Καλημέρα,
    </p>
    <p style="font-size:14px; color:#1F2933; line-height:1.7; margin:0 0 14px;">
      Σας υπενθυμίζουμε ότι πλησιάζει προγραμματισμένη συντήρηση για το όχημά σας.
    </p>

    <!-- ΚΑΡΤΑ ΠΛΗΡΟΦΟΡΙΩΝ -->
    <div style="background:linear-gradient(135deg,#FF7777 0%,#F7B0B0 55%,#999999 100%); border-radius:10px; padding:1px; margin:18px 0 16px;">
      <div style="background:#FFFFFF; border-radius:9px; padding:14px 16px;">
        <p style="font-size:14px; margin:0 0 6px; color:#111827;">
          <strong style="color:#FF0000;">Όχημα:</strong> ${safeVehicleLabel}
        </p>
        <p style="font-size:14px; margin:0 0 6px; color:#111827;">
          <strong style="color:#FF0000;">Τύπος συντήρησης:</strong> ${safeMaintenanceName}
        </p>
        <p style="font-size:14px; margin:0; color:#111827;">
          <strong style="color:#FF0000;">Ημερομηνία συντήρησης:</strong> ${dateStr}
        </p>
      </div>
    </div>

    <p style="font-size:13px; color:#4B5563; line-height:1.7; margin:0 0 20px;">
      Αν η συντήρηση έχει ήδη πραγματοποιηθεί, αγνοήσετε αυτό το μήνυμα.
    </p>

    <!-- ΚΟΥΜΠΙ -->
    <div style="text-align:center; margin-top:6px;">
      <a href="https://www.car-remind.gr/"


         style="display:inline-block; background:#FF7777; color:#FFFFFF; padding:10px 26px; border-radius:999px; text-decoration:none; font-size:13px; font-weight:600; letter-spacing:0.3px;">
        Δείτε τις συντηρήσεις σας
      </a>
    </div>

    <!-- ΥΠΟΓΡΑΦΗ -->
    <p style="text-align:center; margin-top:26px; color:#9CA3AF; font-size:12px;">
      Με εκτίμηση,<br/>
      <strong style="color:#FF7777;">CaReMind</strong>
    </p>
  </div>
<div style="display:none; color:transparent; opacity:0; height:0; width:0;">
  ref:${safeMaintenanceName}
</div>

  <p style="text-align:center; font-size:11px; color:#9CA3AF; margin-top:14px;">
    Αυτό το email στάλθηκε αυτόματα από το σύστημα υπενθυμίσεων <strong>CaReMind</strong>.
  </p>
</div>
`;

        for (const to of recipients) {
          await sendMail(to, subject, messageHtml, []);
          await new Promise((r) => setTimeout(r, 500));
          sent++;
        }
      }
    } else {
    }

    return res.json({ ok: true, total: rows.length, sent, skipped });
  } catch (err) {
    console.error("❌ Σφάλμα:", err);
    return res
      .status(500)
      .json({ ok: false, error: String(err?.message || err) });
  }
});

module.exports = router;
