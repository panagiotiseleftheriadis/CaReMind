const jwt = require("jsonwebtoken");
const db = require("../db"); // ⚠️ βάλε το σωστό path (π.χ. ../db ή ./db ανάλογα που είναι)

const JWT_SECRET = process.env.JWT_SECRET;

async function authenticateToken(req, res, next) {
  const authHeader = req.headers["authorization"];
  if (!authHeader) {
    return res.status(401).json({ error: "Missing Authorization header" });
  }

  const token = authHeader.split(" ")[1];
  if (!token) {
    return res.status(401).json({ error: "Missing token" });
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET);

    // Συνήθως στο token έχεις payload.id ή payload.userId
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

    req.user = user; // ✅ τώρα role έρχεται από DB
    next();
  } catch (err) {
    return res.status(403).json({ error: "Invalid or expired token" });
  }
}

module.exports = {
  authenticateToken,
  JWT_SECRET,
};
