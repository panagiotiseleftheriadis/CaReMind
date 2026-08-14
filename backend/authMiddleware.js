const jwt = require("jsonwebtoken");
const db = require("./db");

const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
  throw new Error("Missing required environment variable: JWT_SECRET");
}

async function authenticateToken(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Missing Authorization header" });
  }

  const token = authHeader.slice(7).trim();
  if (!token) {
    return res.status(401).json({ error: "Missing token" });
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const userId = payload.id || payload.userId;

    if (!userId) {
      return res.status(401).json({ error: "Invalid token payload" });
    }

    const [rows] = await db.query(
      "SELECT id, username, email, role, is_active, email_verified, company_id FROM users WHERE id = ? LIMIT 1",
      [userId]
    );

    if (!rows.length) {
      return res.status(401).json({ error: "User not found" });
    }

    const user = rows[0];
    if (!user.is_active) {
      return res.status(403).json({ error: "User inactive" });
    }

    req.user = user;
    return next();
  } catch (err) {
    if (
      err?.name === "JsonWebTokenError" ||
      err?.name === "TokenExpiredError" ||
      err?.name === "NotBeforeError"
    ) {
      return res.status(401).json({ error: "Invalid or expired token" });
    }

    console.error("Authentication service error:", err);
    return res.status(500).json({ error: "Authentication service unavailable" });
  }
}

module.exports = {
  authenticateToken,
  JWT_SECRET,
};
