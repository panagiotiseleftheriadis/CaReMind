// db.js
const mysql = require("mysql2/promise");

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT), // ✅ πρόσθεσέ το
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  enableKeepAlive: true, // <--- ΠΡΟΣΘΕΣΕ ΑΥΤΟ ΟΠΩΣΔΗΠΟΤΕ
  keepAliveInitialDelay: 0,
});

module.exports = pool;
