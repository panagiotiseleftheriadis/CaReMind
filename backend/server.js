// server.js
const path = require("path");
const adminUsersRoutes = require("./routes/adminUsers");
const express = require("express");
const cors = require("cors");
const sendMail = require("./emailService");
const notificationsRoutes = require("./routes/notifications");
const { authenticateToken } = require("./middleware");
const authRoutes = require("./routes/auth");
const vehicleRoutes = require("./routes/vehicles");
const maintenanceRoutes = require("./routes/maintenances");
const costRoutes = require("./routes/costs");
const interestRoutes = require("./routes/interest");
const cronRoutes = require("./routes/cron");
const app = express();
const PORT = process.env.PORT || 3000;
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Middlewares
app.use(
  cors({
    origin: "https://caremind2025.netlify.app",
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

app.use(express.json());

// Routes
app.use("/api", authRoutes); // /api/login, /api/logout
app.use("/api/vehicles", authenticateToken, vehicleRoutes);
app.use("/api/maintenances", authenticateToken, maintenanceRoutes);
app.use("/api/notifications", notificationsRoutes);
app.use("/api/costs", authenticateToken, costRoutes);
app.use("/api/interest", interestRoutes);
app.use("/api/users", adminUsersRoutes);
app.use("/api/cron", cronRoutes);

// Health check
app.get("/", (req, res) => {
  res.json({ message: "CarCare backend is running" });
});

// Start server
app.listen(PORT, () => {
  console.log(`CarCare backend listening on http://localhost:${PORT}`);
});
