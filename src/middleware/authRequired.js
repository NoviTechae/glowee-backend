// src/middleware/authRequired.js
const jwt = require("jsonwebtoken");

const JWT_SECRET = process.env.JWT_SECRET;

function authRequired(req, res, next) {
  try {
    const h = req.headers.authorization || "";
    const token = h.startsWith("Bearer ") ? h.slice(7) : null;

    if (!token) {
      return res.status(401).json({ error: "Missing token" });
    }

    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload;
    next();
  } catch {
    return res.status(401).json({ error: "Invalid token" });
  }
}

module.exports = authRequired;