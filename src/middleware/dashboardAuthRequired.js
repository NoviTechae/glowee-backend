//src/middleware/dashboardAuthRequired.js
const jwt = require("jsonwebtoken");

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) throw new Error("JWT_SECRET missing");

module.exports = function dashboardAuthRequired(req, res, next) {
  try {
    const h = req.headers.authorization || "";
    const token = h.startsWith("Bearer ") ? h.slice(7) : null;
    if (!token) return res.status(401).json({ error: "Missing token" });

    const payload = jwt.verify(token, JWT_SECRET);

    // نتأكد أنه توكن داشبورد (عشان ما يمر توكن الـ OTP بالغلط)
    if (payload?.typ !== "dashboard") {
      return res.status(401).json({ error: "Invalid token type" });
    }

    req.dashboard = payload; // { sub, role, salon_id, typ }
    next();
  } catch (e) {
    return res.status(401).json({ error: "Unauthorized" });
  }
};