require("dotenv").config();

const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const helmet = require("helmet");
const { rateLimit } = require("express-rate-limit");

const adminUsersRoutes = require("./routes/adminUsers");
const notificationsRoutes = require("./routes/notifications");
const authRoutes = require("./routes/auth");
const accountRoutes = require("./routes/account");
const vehicleRoutes = require("./routes/vehicles");
const maintenanceRoutes = require("./routes/maintenances");
const costRoutes = require("./routes/costs");
const interestRoutes = require("./routes/interest");
const cronRoutes = require("./routes/cron");
const { authenticateToken } = require("./middleware");
const db = require("./db");

const app = express();
const PORT = process.env.PORT || 3000;

app.set("trust proxy", 1);
app.use(helmet());
app.use(express.json({ limit: "100kb" }));
app.use(express.urlencoded({ extended: true, limit: "100kb" }));
app.use(cookieParser());

const allowedOrigins = new Set([
  "http://localhost:5173",
  "http://localhost:5500",
  "http://127.0.0.1:5500",
  "http://localhost:3000",
  "https://car-remind.gr",
  "https://www.car-remind.gr",
  ...String(process.env.CORS_ORIGINS || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
]);

const corsOptions = {
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.has(origin)) {
      return callback(null, true);
    }

    return callback(new Error("Not allowed by CORS"));
  },
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Cron-Secret"],
  credentials: true,
};

app.use(cors(corsOptions));
app.options(/.*/, cors(corsOptions));

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Πάρα πολλές προσπάθειες. Δοκιμάστε ξανά αργότερα." },
});

const verificationLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Έγιναν πάρα πολλά αιτήματα επιβεβαίωσης." },
});

const publicFormLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Έγιναν πάρα πολλά αιτήματα. Δοκιμάστε ξανά αργότερα." },
});

app.use("/api/login", loginLimiter);
app.use(
  [
    "/api/register",
    "/api/verify-email",
    "/api/resend-verification",
    "/api/forgot-password",
    "/api/verify-reset-code",
    "/api/reset-password",
    "/api/account/send-code",
    "/api/account/verify-code",
  ],
  verificationLimiter
);
app.use("/api/interest", publicFormLimiter);

app.get("/api/health", async (req, res) => {
  try {
    await db.query("SELECT 1 AS database_ok");
    return res.json({ status: "ok", service: "CaReMind API", database: "ok" });
  } catch (error) {
    console.error("Health check database error:", error.message);
    return res.status(503).json({
      status: "error",
      service: "CaReMind API",
      database: "unavailable",
    });
  }
});

app.use("/api", authRoutes);
app.use("/api/vehicles", authenticateToken, vehicleRoutes);
app.use("/api/maintenances", authenticateToken, maintenanceRoutes);
app.use("/api/notifications", authenticateToken, notificationsRoutes);
app.use("/api/costs", authenticateToken, costRoutes);
app.use("/api/account", authenticateToken, accountRoutes);
app.use("/api/interest", interestRoutes);
app.use("/api/users", adminUsersRoutes);
app.use("/api/cron", cronRoutes);

app.get("/", (req, res) => {
  res.json({ status: "ok", service: "CaReMind API" });
});

app.use((req, res) => {
  res.status(404).json({ error: "Route not found" });
});

app.use((err, req, res, next) => {
  if (err?.message === "Not allowed by CORS") {
    return res.status(403).json({ error: "Origin not allowed" });
  }

  console.error("Unhandled server error:", err);
  return res.status(500).json({ error: "Internal server error" });
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`CaReMind API listening on port ${PORT}`);
  });
}

module.exports = app;
