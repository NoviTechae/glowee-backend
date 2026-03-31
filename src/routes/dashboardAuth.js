//src/routes/dashboardAuth.js
const router = require("express").Router();
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const { z } = require("zod");
const db = require("../db/knex");
const dashboardAuthRequired = require("../middleware/dashboardAuthRequired");

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) throw new Error("JWT_SECRET missing");

function issueDashboardJwt(acc) {
  return jwt.sign(
    {
      sub: acc.id,
      role: acc.role,
      salon_id: acc.salon_id || null,
      typ: "dashboard",
    },
    JWT_SECRET,
    { expiresIn: "30d" }
  );
}

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6).max(200),
});

// POST /dashboard/auth/login
router.post("/login", async (req, res, next) => {
  try {
    const { email, password } = LoginSchema.parse(req.body);

    const acc = await db("dashboard_accounts")
      .whereRaw("lower(email) = lower(?)", [email])
      .where({ is_active: true })
      .first();

    if (!acc) return res.status(401).json({ error: "Invalid credentials" });

    const ok = await bcrypt.compare(password, acc.password_hash);
    if (!ok) return res.status(401).json({ error: "Invalid credentials" });

    const token = issueDashboardJwt(acc);

    return res.json({
      token,
      account: {
        id: acc.id,
        role: acc.role,
        email: acc.email,
        salon_id: acc.salon_id || null,
      },
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
      account: {
        id: acc.id,
        role: acc.role,
        email: acc.email,
        salon_id: acc.salon_id || null,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ✅ NEW: POST /dashboard/auth/change-password
// Works for both admin and salon users
const ChangePasswordSchema = z.object({
  current_password: z.string().min(1, "Current password is required"),
  new_password: z.string().min(6, "New password must be at least 6 characters"),
});

router.post("/change-password", dashboardAuthRequired, async (req, res, next) => {
  try {
    const { current_password, new_password } = ChangePasswordSchema.parse(req.body);
    const userId = req.dashboard.sub;

    // Get user account
    const user = await db("dashboard_accounts")
      .where({ id: userId })
      .first();

    if (!user) {
      return res.status(404).json({ error: "Account not found" });
    }

    // Verify current password
    const isValid = await bcrypt.compare(current_password, user.password_hash);
    if (!isValid) {
      return res.status(401).json({ error: "Current password is incorrect" });
    }

    // Don't allow same password
    const isSamePassword = await bcrypt.compare(new_password, user.password_hash);
    if (isSamePassword) {
      return res.status(400).json({ error: "New password must be different from current password" });
    }

    // Hash new password
    const newHash = await bcrypt.hash(new_password, 10);

    // Update password
    await db("dashboard_accounts")
      .where({ id: userId })
      .update({
        password_hash: newHash,
        updated_at: db.fn.now(),
      });

    return res.json({
      ok: true,
      message: "Password changed successfully",
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;