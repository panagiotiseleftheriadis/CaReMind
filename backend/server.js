// server.js
const path = require("path");
const express = require("express");
const cors = require("cors");

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

/* ======================
   CORS (Vercel only)
====================== */
const corsOptions = {
  origin: (origin, cb) => {
    if (!origin) return cb(null, true);

    const ok =
      origin === "http://localhost:5173" || origin.endsWith(".vercel.app");

    return ok ? cb(null, true) : cb(new Error("Not allowed by CORS"));
  },
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true,
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
