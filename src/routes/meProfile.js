// src/routes/meProfile.js
const router = require("express").Router();
const db = require("../db/knex");
const authRequired = require("../middleware/authRequired");

function toNull(v) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s ? s : null;
}

function isValidEmail(email) {
  if (!email) return true;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email).trim());
}

function isValidDob(dob) {
  if (!dob) return true;
  return /^\d{4}-\d{2}-\d{2}$/.test(String(dob).trim());
}

// GET /me/profile
router.get("/me/profile", authRequired, async (req, res, next) => {
  try {
    const userId = req.user.sub || req.user.id;

    const user = await db("users")
      .where({ id: userId })
      .first([
        "id",
        "name",
        "phone",
        "email",
        "date_of_birth",
        "created_at",
        "updated_at",
      ]);

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    res.json({
      ok: true,
      data: {
        id: user.id,
        name: user.name || "",
        phone: user.phone || "",
        email: user.email || "",
        date_of_birth: user.date_of_birth || "",
        created_at: user.created_at,
        updated_at: user.updated_at,
      },
    });
  } catch (e) {
    next(e);
  }
});

// PUT /me/profile
router.put("/me/profile", authRequired, async (req, res, next) => {
  try {
    const userId = req.user.sub || req.user.id;
    const { name, email, date_of_birth } = req.body;

    const cleanName = String(name || "").trim();
    const cleanEmail = toNull(email);
    const cleanDob = toNull(date_of_birth);

    if (cleanName.length < 2) {
      return res.status(400).json({ error: "Name must be at least 2 characters" });
    }

    if (cleanName.length > 35) {
      return res.status(400).json({ error: "Name must be 35 characters or less" });
    }

    if (!isValidEmail(cleanEmail)) {
      return res.status(400).json({ error: "Invalid email" });
    }

    if (!isValidDob(cleanDob)) {
      return res.status(400).json({
        error: "Invalid date_of_birth format. Use YYYY-MM-DD",
      });
    }

    const [updated] = await db("users")
      .where({ id: userId })
      .update({
        name: cleanName,
        email: cleanEmail,
        date_of_birth: cleanDob,
        updated_at: db.fn.now(),
      })
      .returning([
        "id",
        "name",
        "phone",
        "email",
        "date_of_birth",
        "created_at",
        "updated_at",
      ]);

    if (!updated) {
      return res.status(404).json({ error: "User not found" });
    }

    res.json({
      ok: true,
      data: {
        id: updated.id,
        name: updated.name || "",
        phone: updated.phone || "",
        email: updated.email || "",
        date_of_birth: updated.date_of_birth || "",
        created_at: updated.created_at,
        updated_at: updated.updated_at,
      },
    });
  } catch (e) {
    next(e);
  }
});

module.exports = router;