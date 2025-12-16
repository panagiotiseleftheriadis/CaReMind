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
const corsOptions = {
  origin: [
    "https://caremind2025.netlify.app",
    "https://ca-re-mind-jl1oqqwhe-panos17s-projects.vercel.app",
  ],
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
};

app.use(cors(corsOptions));
app.options(/.*/, cors(corsOptions));

// Routes
app.use("/api", authRoutes);
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

app.listen(PORT, () => {
  console.log(`CarCare backend listening on http://localhost:${PORT}`);
});
