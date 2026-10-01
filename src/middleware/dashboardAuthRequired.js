// src/middleware/dashboardAuthRequired.js
// Dashboard auth. Role and salon come from the database, not the token, so
// deactivating an account or moving it takes effect straight away.
const jwt = require("jsonwebtoken");
const db = require("../db/knex");

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) throw new Error("JWT_SECRET missing");

module.exports = async function dashboardAuthRequired(req, res, next) {
  const h = req.headers.authorization || "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Missing token" });

  let payload;
  try {
    payload = jwt.verify(token, JWT_SECRET, { algorithms: ["HS256"] });
  } catch {
    return res.status(401).json({ error: "Unauthorized" });
  }

  // Only dashboard tokens (a customer OTP token must not get in here).
  if (payload?.typ !== "dashboard" || !payload.sub) {
    return res.status(401).json({ error: "Invalid token type" });
  }

  try {
    const acc = await db("dashboard_accounts")
      .where({ id: payload.sub })
      .first("id", "role", "salon_id", "is_active", "password_changed_at");

    if (!acc || !acc.is_active) return res.status(401).json({ error: "Unauthorized" });

    // Tokens issued before a password change stop working.
    if (acc.password_changed_at && payload.iat * 1000 < new Date(acc.password_changed_at).getTime() - 1000) {
      return res.status(401).json({ error: "Session expired. Please log in again." });
    }

    req.dashboard = { ...payload, role: acc.role, salon_id: acc.salon_id || null };
    return next();
  } catch (e) {
    return next(e);
  }
};