// src/routes/adminGiftThemes.js
const router = require("express").Router();
const db = require("../db/knex");
const dashboardAuthRequired = require("../middleware/dashboardAuthRequired");
const path = require("path");
const fs = require("fs");
const multer = require("multer");

function requireAdmin(req, res, next) {
  if (req.dashboard?.role !== "admin") {
    return res.status(403).json({ error: "Admin only" });
  }
  next();
}

router.use(dashboardAuthRequired, requireAdmin);

// uploads dir: backend/public/uploads/gift-themes
const uploadDir = path.join(process.cwd(), "public", "uploads", "gift-themes");
fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || "").toLowerCase() || ".jpg";
    const name = `theme_${Date.now()}_${Math.random().toString(16).slice(2)}${ext}`;
    cb(null, name);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 6 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = ["image/jpeg", "image/png", "image/webp"].includes(file.mimetype);
    cb(ok ? null : new Error("Only JPG/PNG/WEBP allowed"), ok);
  },
});

// GET /dashboard/admin/gift-themes
router.get("/", async (req, res, next) => {
  try {
    const themes = await db("gift_themes")
      .select("*")
      .orderBy("sort_order", "asc")
      .orderBy("created_at", "desc");

    res.json({ data: themes });
  } catch (err) {
    next(err);
  }
});

// GET /dashboard/admin/gift-themes/:id
router.get("/:id", async (req, res, next) => {
  try {
    const { id } = req.params;

    const theme = await db("gift_themes")
      .select(
        "id",
        "title",
        "category",
        "front_image_url",
        "back_image_url",
        "is_active",
        "sort_order",
        "created_at"
      )
      .where({ id })
      .first();

    if (!theme) {
      return res.status(404).json({ ok: false, error: "Gift theme not found" });
    }

    res.json({ ok: true, data: theme });
  } catch (error) {
    next(error);
  }
});

// POST /dashboard/admin/gift-themes
router.post("/", async (req, res, next) => {
  try {
    const { title, category, front_image_url, back_image_url, is_active } = req.body;

    if (!title || !front_image_url || !back_image_url) {
      return res.status(400).json({
        ok: false,
        error: "Title, front image, and back image are required",
      });
    }

    const maxOrder = await db("gift_themes")
      .max("sort_order as max_order")
      .first();

    const nextOrder = (maxOrder?.max_order || 0) + 1;

    const [created] = await db("gift_themes")
      .insert({
        title,
        category: category || "Other",
        front_image_url,
        back_image_url,
        is_active: is_active !== false,
        sort_order: nextOrder,
        created_at: db.fn.now(),
        updated_at: db.fn.now(),
      })
      .returning([
        "id",
        "title",
        "category",
        "front_image_url",
        "back_image_url",
        "is_active",
        "sort_order",
        "created_at",
      ]);

    res.status(201).json({ ok: true, data: created });
  } catch (error) {
    next(error);
  }
});

// PATCH /dashboard/admin/gift-themes/:id
router.patch("/:id", async (req, res, next) => {
  try {
    const { id } = req.params;
    const { title, category, front_image_url, back_image_url, is_active } = req.body;

    const updates = {};
    if (title !== undefined) updates.title = title;
    if (category !== undefined) updates.category = category;
    if (front_image_url !== undefined) updates.front_image_url = front_image_url;
    if (back_image_url !== undefined) updates.back_image_url = back_image_url;
    if (is_active !== undefined) updates.is_active = is_active;

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ ok: false, error: "No fields to update" });
    }

    updates.updated_at = db.fn.now();

    const [updated] = await db("gift_themes")
      .where({ id })
      .update(updates)
      .returning([
        "id",
        "title",
        "category",
        "front_image_url",
        "back_image_url",
        "is_active",
        "sort_order",
        "created_at",
      ]);

    if (!updated) {
      return res.status(404).json({ ok: false, error: "Gift theme not found" });
    }

    res.json({ ok: true, data: updated });
  } catch (error) {
    next(error);
  }
});

// DELETE /dashboard/admin/gift-themes/:id
router.delete("/:id", async (req, res, next) => {
  try {
    const { id } = req.params;

    const deleted = await db("gift_themes")
      .where({ id })
      .del();

    if (deleted === 0) {
      return res.status(404).json({ ok: false, error: "Gift theme not found" });
    }

    res.json({ ok: true, message: "Gift theme deleted successfully" });
  } catch (error) {
    next(error);
  }
});

// POST /dashboard/admin/gift-themes/upload
router.post("/upload", upload.single("file"), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ ok: false, error: "No file uploaded" });
    }

    const url = `/uploads/gift-themes/${req.file.filename}`;
    res.json({ ok: true, url });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

// POST /dashboard/admin/gift-themes/reorder
router.post("/reorder", async (req, res, next) => {
  try {
    const { ids } = req.body;

    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ ok: false, error: "Invalid IDs array" });
    }

    await db.transaction(async (trx) => {
      for (let i = 0; i < ids.length; i++) {
        await trx("gift_themes")
          .where({ id: ids[i] })
          .update({
            sort_order: i + 1,
            updated_at: trx.fn.now(),
          });
      }
    });

    res.json({ ok: true, message: "Themes reordered successfully" });
  } catch (error) {
    next(error);
  }
});

module.exports = router;