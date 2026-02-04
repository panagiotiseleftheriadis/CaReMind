// middleware.js
const jwt = require("jsonwebtoken");
const db = require("./db");

// Χρήση του env variable ή fallback για ασφάλεια κατά την ανάπτυξη
const JWT_SECRET = process.env.JWT_SECRET || "mysecretkey";

async function authenticateToken(req, res, next) {
  const authHeader = req.headers["authorization"];
  
  // Έλεγχος αν υπάρχει header
  if (!authHeader) {
    return res.status(401).json({ error: "Missing Authorization header" });
  }

  // Έλεγχος αν υπάρχει token (Format: "Bearer <token>")
  const token = authHeader.split(" ")[1];
  if (!token) {
    return res.status(401).json({ error: "Missing token" });
  }

  try {
    // 1. Επαλήθευση Token
    const payload = jwt.verify(token, JWT_SECRET);

    // 2. Έλεγχος αν υπάρχει ID
    const userId = payload.id || payload.userId;
    if (!userId) {
      return res.status(401).json({ error: "Invalid token payload" });
    }

    // 3. (Προαιρετικό αλλά Ασφαλές) Έλεγχος στη βάση
    // Αυτό εξασφαλίζει ότι αν διαγράψεις/απενεργοποιήσεις έναν χρήστη,
    // θα χάσει πρόσβαση ΑΜΕΣΩΣ, όχι όταν λήξει το 15λεπτο token.
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

    // Περνάμε τον χρήστη στο request για να τον βλέπουν τα routes
    req.user = user; 
    next();

  } catch (err) {
    // ⚠️ ΑΛΛΑΓΗ ΕΔΩ: Επιστρέφουμε 401 αντί για 403
    // Αυτό λέει στο Frontend: "Το token έληξε, προσπάθησε να κάνεις refresh"
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

module.exports = {
  authenticateToken,
  JWT_SECRET,
};