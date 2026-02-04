// server.js
const path = require("path");
const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser"); // <-- ΠΡΟΣΘΗΚΗ
const adminUsersRoutes = require("./routes/adminUsers");
const notificationsRoutes = require("./routes/notifications");
const authRoutes = require("./routes/auth");
const vehicleRoutes = require("./routes/vehicles");
const maintenanceRoutes = require("./routes/maintenances");
const costRoutes = require("./routes/costs");
const interestRoutes = require("./routes/interest");
const cronRoutes = require("./routes/cron");

const { authenticateToken } = require("./middleware");

const app = express();
const PORT = process.env.PORT || 3000;

/* ======================
   BODY PARSERS
====================== */
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser()); // <-- ΠΡΟΣΘΗΚΗ
/* ======================
   CORS
====================== */
const allowedOrigins = new Set([
  "http://localhost:5173",
  "https://car-remind.gr",
  "https://www.car-remind.gr",
]);

const corsOptions = {
  origin: (origin, cb) => {
    // ... (κρατάς τον κώδικα που έχεις για το allowedOrigins) ...
    // Σιγουρέψου ότι το allowedOrigins περιέχει το frontend URL σου ακριβώς
    if (!origin) return cb(null, true);
    const isAllowed = allowedOrigins.has(origin) || origin.endsWith(".vercel.app");
    return isAllowed ? cb(null, true) : cb(new Error("Not allowed by CORS"));
  },
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true, // <-- ΑΛΛΑΓΗ: Πρέπει να είναι true για να περάσουν τα cookies
};

app.use(cors(corsOptions));
app.options(/.*/, cors(corsOptions));

/* ======================
   ROUTES
====================== */
app.use("/api", authRoutes); // /api/login, /api/logout

app.use("/api/vehicles", authenticateToken, vehicleRoutes);
app.use("/api/maintenances", authenticateToken, maintenanceRoutes);
app.use("/api/notifications", notificationsRoutes);
app.use("/api/costs", authenticateToken, costRoutes);
app.use("/api/interest", interestRoutes);
app.use("/api/users", adminUsersRoutes);
app.use("/api/cron", cronRoutes);

/* ======================
   HEALTH CHECK
====================== */
app.get("/", (req, res) => {
  res.json({ message: "CarCare backend is running" });
});

/* ======================
   START SERVER
====================== */
app.listen(PORT, () => {
  console.log(`CarCare backend listening on port ${PORT}`);
});
