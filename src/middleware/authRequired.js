// src/middleware/authRequired.js
// Customer app auth. Checks the token, and that the account still exists and
// isn't blocked (a token lasts a year, so blocking must take effect without it).
const jwt = require("jsonwebtoken");
const db = require("../db/knex");

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) throw new Error("JWT_SECRET missing");

// Short cache so every request doesn't hit the database.
const CACHE_MS = 60 * 1000;
const cache = new Map(); // userId -> { ok, at }

async function userAllowed(userId) {
  const hit = cache.get(userId);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.ok;

  const u = await db("users").where({ id: userId }).first("id", "is_blocked", "is_active");
  const ok = Boolean(u) && !u.is_blocked && u.is_active !== false;
  cache.set(userId, { ok, at: Date.now() });
  if (cache.size > 20000) cache.clear();
  return ok;
}

// Call after blocking/unblocking so it applies immediately.
authRequired.forget = (userId) => cache.delete(String(userId));

async function authRequired(req, res, next) {
  const h = req.headers.authorization || "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Missing token" });

  let payload;
  try {
    payload = jwt.verify(token, JWT_SECRET, { algorithms: ["HS256"] });
  } catch (err) {
    return res.status(401).json({ error: err.name === "TokenExpiredError" ? "Session expired" : "Invalid token" });
  }

  // A dashboard token must never act as a customer.
  if (payload?.typ === "dashboard" || !payload?.sub) {
    return res.status(401).json({ error: "Invalid token" });
  }

  try {
    if (!(await userAllowed(String(payload.sub)))) {
      return res.status(403).json({ error: "This account is not available", code: "ACCOUNT_BLOCKED" });
    }
  } catch (e) {
    return next(e);
  }

  req.user = payload;
  return next();
}

module.exports = authRequired;