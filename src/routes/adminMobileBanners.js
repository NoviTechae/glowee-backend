// src/routes/adminMobileBanners.js
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

const bannerUploadDir = path.join(process.cwd(), "public", "uploads", "mobile-banners");
fs.mkdirSync(bannerUploadDir, { recursive: true });

const bannerStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, bannerUploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || "").toLowerCase() || ".jpg";
    const name = `mobile_banner_${Date.now()}_${Math.random().toString(16).slice(2)}${ext}`;
    cb(null, name);
  },
});

const bannerUpload = multer({
  storage: bannerStorage,
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = ["image/jpeg", "image/png", "image/webp"].includes(file.mimetype);
    cb(ok ? null : new Error("Only JPG/PNG/WEBP allowed"), ok);
  },
});

// GET /dashboard/admin/mobile-banners
router.get("/", async (req, res, next) => {
  try {
    const placement = req.query.placement?.toString();

    let query = db("mobile_banners")
      .select("*")
      .orderBy("placement", "asc")
      .orderBy("sort_order", "asc")
      .orderBy("created_at", "desc");

    if (placement) {
      query = query.where({ placement });
    }

    const rows = await query;
    res.json({ data: rows });
  } catch (e) {
    next(e);
  }
});

// GET /dashboard/admin/mobile-banners/:id
router.get("/:id", async (req, res, next) => {
  try {
    const { id } = req.params;

    const banner = await db("mobile_banners")
      .where({ id })
      .first();

    if (!banner) {
      return res.status(404).json({ error: "Banner not found" });
    }

    res.json({ banner });
  } catch (e) {
    next(e);
  }
});

// POST /dashboard/admin/mobile-banners
router.post("/", async (req, res, next) => {
  try {
    const {
      title,
      image_url,
      placement,
      is_active,
      starts_at,
      ends_at,
      action_type,
      action_value,
    } = req.body;

    if (!image_url) {
      return res.status(400).json({ error: "image_url is required" });
    }

    const finalPlacement = placement || "home";

    const [{ max_order }] = await db("mobile_banners")
      .where({ placement: finalPlacement })
      .max("sort_order as max_order");

    const [created] = await db("mobile_banners")
      .insert({
        title: title || null,
        image_url,
        placement: finalPlacement,
        is_active: is_active !== false,
        sort_order: Number(max_order || 0) + 1,
        starts_at: starts_at || null,
        ends_at: ends_at || null,
        action_type: action_type || null,
        action_value: action_value || null,
        created_at: db.fn.now(),
        updated_at: db.fn.now(),
      })
      .returning("*");

    res.status(201).json({ banner: created });
  } catch (e) {
    next(e);
  }
});

// PUT /dashboard/admin/mobile-banners/:id
router.put("/:id", async (req, res, next) => {
  try {
    const { id } = req.params;
    const {
      title,
      image_url,
      placement,
      is_active,
      starts_at,
      ends_at,
      action_type,
      action_value,
      sort_order,
    } = req.body;

    const exists = await db("mobile_banners").where({ id }).first("id");
    if (!exists) {
      return res.status(404).json({ error: "Banner not found" });
    }

    const patch = {
      updated_at: db.fn.now(),
    };

    if (title !== undefined) patch.title = title || null;
    if (image_url !== undefined) patch.image_url = image_url || null;
    if (placement !== undefined) patch.placement = placement || "home";
    if (is_active !== undefined) patch.is_active = is_active;
    if (starts_at !== undefined) patch.starts_at = starts_at || null;
    if (ends_at !== undefined) patch.ends_at = ends_at || null;
    if (action_type !== undefined) patch.action_type = action_type || null;
    if (action_value !== undefined) patch.action_value = action_value || null;
    if (sort_order !== undefined) patch.sort_order = Number(sort_order || 0);

    const [updated] = await db("mobile_banners")
      .where({ id })
      .update(patch)
      .returning("*");

    res.json({ banner: updated });
  } catch (e) {
    next(e);
  }
});

// DELETE /dashboard/admin/mobile-banners/:id
router.delete("/:id", async (req, res, next) => {
  try {
    const { id } = req.params;

    const exists = await db("mobile_banners").where({ id }).first("id");
    if (!exists) {
      return res.status(404).json({ error: "Banner not found" });
    }

    await db("mobile_banners").where({ id }).del();

    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

// POST /dashboard/admin/mobile-banners/reorder
router.post("/reorder", async (req, res, next) => {
  try {
    const { items } = req.body;

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: "items array is required" });
    }

    await db.transaction(async (trx) => {
      for (const item of items) {
        if (!item?.id) continue;

        await trx("mobile_banners")
          .where({ id: item.id })
          .update({
            sort_order: Number(item.sort_order || 0),
            updated_at: trx.fn.now(),
          });
      }
    });

    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

// POST /dashboard/admin/mobile-banners/upload
router.post("/upload", bannerUpload.single("file"), async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    const image_url = `/uploads/mobile-banners/${req.file.filename}`;

    res.json({
      ok: true,
      image_url,
    });
  } catch (e) {
    next(e);
  }
});

module.exports = router;