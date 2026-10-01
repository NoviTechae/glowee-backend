// src/routes/dashboardAuth.js
const router = require("express").Router();
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const rateLimit = require("express-rate-limit");
const { z } = require("zod");
const db = require("../db/knex");
const dashboardAuthRequired = require("../middleware/dashboardAuthRequired");

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) throw new Error("JWT_SECRET missing");

function issueDashboardJwt(acc) {
  return jwt.sign(
    { sub: acc.id, role: acc.role, salon_id: acc.salon_id || null, typ: "dashboard" },
    JWT_SECRET,
    { expiresIn: "30d", algorithm: "HS256" }
  );
}

// Slows down password guessing: per IP, and per email across IPs.
const LOGIN_LIMIT_IP = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many attempts. Try again in 15 minutes." },
});

const LOGIN_LIMIT_EMAIL = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 8,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `email:${String(req.body?.email || "").trim().toLowerCase()}`,
  message: { error: "Too many attempts. Try again in 15 minutes." },
});

// A real hash to compare against when the email doesn't exist, so a wrong
// email and a wrong password take the same time.
const DUMMY_HASH = bcrypt.hashSync("not-a-real-password", 10);

const LoginSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(1).max(200),
});

// POST /dashboard/auth/login
router.post("/login", LOGIN_LIMIT_IP, LOGIN_LIMIT_EMAIL, async (req, res, next) => {
  try {
    const parsed = LoginSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Enter your email and password" });
    const { email, password } = parsed.data;

    const acc = await db("dashboard_accounts")
      .whereRaw("lower(email) = lower(?)", [email])
      .where({ is_active: true })
      .first();

    const ok = await bcrypt.compare(password, acc?.password_hash || DUMMY_HASH);
    if (!acc || !ok) return res.status(401).json({ error: "Invalid credentials" });

    return res.json({
      token: issueDashboardJwt(acc),
      account: { id: acc.id, role: acc.role, email: acc.email, salon_id: acc.salon_id || null },
    });
  } catch (err) {
    next(err);
  }
});

// GET /dashboard/auth/me
router.get("/me", dashboardAuthRequired, async (req, res, next) => {
  try {
    const acc = await db("dashboard_accounts").where({ id: req.dashboard.sub }).first();
    if (!acc) return res.status(404).json({ error: "Account not found" });
    return res.json({
      account: { id: acc.id, role: acc.role, email: acc.email, salon_id: acc.salon_id || null },
    });
  } catch (err) {
    next(err);
  }
});

const ChangePasswordSchema = z.object({
  current_password: z.string().min(1, "Enter your current password"),
  new_password: z.string().min(8, "Use at least 8 characters").max(200),
});

// POST /dashboard/auth/change-password
// Signs out every other session and returns a fresh token for this one.
router.post("/change-password", dashboardAuthRequired, async (req, res, next) => {
  try {
    const parsed = ChangePasswordSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || "Invalid input" });
    const { current_password, new_password } = parsed.data;

    const acc = await db("dashboard_accounts").where({ id: req.dashboard.sub }).first();
    if (!acc) return res.status(404).json({ error: "Account not found" });

    if (!(await bcrypt.compare(current_password, acc.password_hash))) {
      return res.status(400).json({ error: "Current password is incorrect" }); // 400, not 401: a 401 logs the dashboard out
    }
    if (await bcrypt.compare(new_password, acc.password_hash)) {
      return res.status(400).json({ error: "Choose a different password from your current one" });
    }

    const [updated] = await db("dashboard_accounts")
      .where({ id: acc.id })
      .update({
        password_hash: await bcrypt.hash(new_password, 10),
        password_changed_at: db.fn.now(),
        updated_at: db.fn.now(),
      })
      .returning(["id", "role", "salon_id", "email"]);

    return res.json({ ok: true, message: "Password changed", token: issueDashboardJwt(updated) });
  } catch (err) {
    next(err);
  }
});

module.exports = router;