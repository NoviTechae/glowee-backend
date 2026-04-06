// src/routes/dashboardAdmin.js
const router = require("express").Router();
const { z } = require("zod");
const bcrypt = require("bcrypt");
const db = require("../db/knex");
const dashboardAuthRequired = require("../middleware/dashboardAuthRequired");


function requireAdmin(req, res, next) {
  if (req.dashboard?.role !== "admin") return res.status(403).json({ error: "Admin only" });
  next();
}

// GET /gift/themes - For mobile app
router.get("/gift/themes", async (req, res) => {
  try {
    const themes = await db("gift_themes")
      .where({ is_active: true })
      .select(["id", "title", "category", "front_image_url", "back_image_url", "sort_order"])
      .orderBy("sort_order", "asc");
    res.json({ ok: true, data: themes });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

// PROTECTED ROUTES (require auth)
router.use(dashboardAuthRequired);

// ---------------------------
// Admin: Salons
// ---------------------------

const SalonTypeSchema = z.preprocess((v) => {
  const s = String(v ?? "").trim().toLowerCase();

  if (!s) return undefined;              // يخليها تروح للـ default
  if (s === "home_service") return "home";
  if (s === "in-salon") return "in_salon";
  if (s === "insalon") return "in_salon";
  if (s === "homeservice") return "home";

  return s; // لو كانت أصلاً home/both/in_salon
}, z.enum(["in_salon", "home", "both"]));

const CreateSalonSchema = z.object({
  salon: z.object({
    name: z.string().min(2),
    salon_type: SalonTypeSchema.optional().default("in_salon"),
    about: z.string().optional().nullable(),
    logo_url: z.string().url().optional().nullable(),
    cover_url: z.string().url().optional().nullable(),
    phone: z.string().optional().nullable(),
    email: z.string().email().optional().nullable(),
    instagram: z.string().optional().nullable(),
    website: z.string().optional().nullable(),
  }),
  account: z.object({
    email: z.string().email(),
    password: z.string().min(6),
  }),
});

// POST /dashboard/admin/salons  (ينشئ الصالون + حساب الصالون)
router.post("/salons", dashboardAuthRequired, requireAdmin, async (req, res, next) => {
  try {
    const { salon, account } = CreateSalonSchema.parse(req.body);

    const created = await db.transaction(async (trx) => {
      const [s] = await trx("salons")
        .insert({
          name: salon.name,
          salon_type: salon.salon_type ?? "in_salon",
          about: salon.about ?? null,
          logo_url: salon.logo_url ?? null,
          cover_url: salon.cover_url ?? null,
          phone: salon.phone ?? null,
          email: salon.email ?? null,
          instagram: salon.instagram ?? null,
          website: salon.website ?? null,
          is_active: true,
          created_at: trx.fn.now(),
          updated_at: trx.fn.now(),
        })
        .returning(["id", "name", "salon_type", "is_active"]);

      const password_hash = await bcrypt.hash(account.password, 10);

      const [acc] = await trx("dashboard_accounts")
        .insert({
          role: "salon",
          email: account.email.toLowerCase(),
          password_hash,
          salon_id: s.id,
          is_active: true,
          created_at: trx.fn.now(),
          updated_at: trx.fn.now(),
        })
        .returning(["id", "email", "role", "salon_id", "is_active"]);

      // ✅ auto-create internal branch for home salons
      if (s.salon_type === "home") {
        const [branch] = await trx("branches")
          .insert({
            salon_id: s.id,
            name: "Home Service",
            country: "United Arab Emirates",
            city: "UAE",
            area: "Home Service",
            address_line: null,
            lat: 0,
            lng: 0,
            geo: geoRaw(0, 0),
            supports_home_services: true,
            is_active: true,
            created_at: trx.fn.now(),
            updated_at: trx.fn.now(),
          })
          .returning(["id", "name", "salon_id"]);

        await trx("branch_hours").insert([
          { branch_id: branch.id, day_of_week: 0, is_closed: false, open_time: "10:00", close_time: "22:00", updated_at: trx.fn.now() },
          { branch_id: branch.id, day_of_week: 1, is_closed: false, open_time: "10:00", close_time: "22:00", updated_at: trx.fn.now() },
          { branch_id: branch.id, day_of_week: 2, is_closed: false, open_time: "10:00", close_time: "22:00", updated_at: trx.fn.now() },
          { branch_id: branch.id, day_of_week: 3, is_closed: false, open_time: "10:00", close_time: "22:00", updated_at: trx.fn.now() },
          { branch_id: branch.id, day_of_week: 4, is_closed: false, open_time: "10:00", close_time: "22:00", updated_at: trx.fn.now() },
          { branch_id: branch.id, day_of_week: 5, is_closed: false, open_time: "10:00", close_time: "22:00", updated_at: trx.fn.now() },
          { branch_id: branch.id, day_of_week: 6, is_closed: false, open_time: "10:00", close_time: "22:00", updated_at: trx.fn.now() },
        ]);
      }

      return { salon: s, account: acc };
    });

    res.json(created);
  } catch (err) {
    next(err);
  }
});

// GET /dashboard/admin/salons  (List)
router.get("/salons", dashboardAuthRequired, requireAdmin, async (req, res, next) => {
  try {
    const type = (req.query.type || "").toString(); // in_salon | home | both

    let q = db("salons").orderBy("created_at", "desc");

    if (type === "in_salon") q = q.where("salon_type", "in_salon");
    if (type === "home") q = q.where("salon_type", "home");
    if (type === "both") q = q.where("salon_type", "both");

    // لو تبين صفحة Salons تعرض in_salon + both
    if (type === "salons_only") q = q.whereIn("salon_type", ["in_salon", "both"]);

    // لو تبين صفحة Home Service تعرض home فقط (مثل طلبك)
    if (type === "home_only") q = q.where("salon_type", "home");

    const rows = await q;
    res.json({ data: rows });
  } catch (e) {
    next(e);
  }
});

// --- Admin: Get salon by id ---
router.get("/salons/:id", dashboardAuthRequired, requireAdmin, async (req, res, next) => {
  try {
    const id = req.params.id;
    const salon = await db("salons").where({ id }).first();
    if (!salon) return res.status(404).json({ error: "Salon not found" });
    res.json({ salon });
  } catch (e) {
    next(e);
  }
});

// PUT /dashboard/admin/salons/:id  (Update)
const UpdateSalonSchema = z.object({
  name: z.string().min(2).optional(),
  salon_type: SalonTypeSchema.optional(),
  about: z.string().nullable().optional(),
  logo_url: z.string().url().nullable().optional(),
  cover_url: z.string().url().nullable().optional(),
  phone: z.string().nullable().optional(),
  email: z.string().email().nullable().optional(),
  instagram: z.string().nullable().optional(),
  website: z.string().nullable().optional(),
  is_active: z.boolean().optional(),
});

router.put("/salons/:id", dashboardAuthRequired, requireAdmin, async (req, res, next) => {
  try {
    const id = req.params.id;
    const patch = UpdateSalonSchema.parse(req.body);

    const [updated] = await db("salons")
      .where({ id })
      .update({ ...patch, updated_at: db.fn.now() })
      .returning(["id", "name", "salon_type", "is_active", "updated_at"]);
    if (!updated) return res.status(404).json({ error: "Salon not found" });
    res.json({ salon: updated });
  } catch (e) {
    next(e);
  }
});

// DELETE /dashboard/admin/salons/:id  (Hard delete - permanent)
router.delete("/salons/:id", dashboardAuthRequired, requireAdmin, async (req, res, next) => {
  try {
    const id = req.params.id;

    const salon = await db("salons").where({ id }).first("id");
    if (!salon) return res.status(404).json({ error: "Salon not found" });

    await db.transaction(async (trx) => {
      // 1) delete dependent rows first
      await trx("branches").where({ salon_id: id }).del();

      // 2) services (you have services in salonController)
      await trx("services").where({ salon_id: id }).del();

      // 3) dashboard accounts related to this salon
      await trx("dashboard_accounts").where({ salon_id: id }).del();

      // 4) finally delete salon
      await trx("salons").where({ id }).del();
    });

    res.json({ ok: true, deleted_salon_id: id });
  } catch (e) {
    next(e);
  }
});

// ---------------------------
// Admin: Branches
// ---------------------------

function geoRaw(lng, lat) {
  return db.raw(`ST_SetSRID(ST_MakePoint(?, ?), 4326)::geography`, [lng, lat]);
}

const AdminCreateBranchSchema = z.object({
  name: z.string().min(2),
  country: z.string().min(2).default("United Arab Emirates"),
  city: z.string().min(2),
  area: z.string().min(2),
  address_line: z.string().nullable().optional(),
  lat: z.coerce.number(),
  lng: z.coerce.number(),

  supports_home_services: z.coerce.boolean().optional().default(false),
  is_active: z.coerce.boolean().optional().default(true),
});

const AdminUpdateBranchSchema = AdminCreateBranchSchema.partial();

// GET /dashboard/admin/salons/:salonId/branches
router.get("/salons/:salonId/branches", dashboardAuthRequired, requireAdmin, async (req, res, next) => {
  try {
    const salonId = req.params.salonId;

    const rows = await db("branches")
      .where({ salon_id: salonId })
      .orderBy("created_at", "desc");

    res.json({ data: rows });
  } catch (e) {
    next(e);
  }
});

// POST /dashboard/admin/salons/:salonId/branches
router.post("/salons/:salonId/branches", dashboardAuthRequired, requireAdmin, async (req, res, next) => {
  try {
    const salonId = req.params.salonId;
    const body = AdminCreateBranchSchema.parse(req.body);

    const s = await db("salons").where({ id: salonId }).first("id", "salon_type");
    if (!s) return res.status(404).json({ error: "Salon not found" });

    if (s.salon_type === "home") {
      const existingCount = await db("branches")
        .where({ salon_id: salonId })
        .count("* as c")
        .first();

      if (Number(existingCount?.c || 0) >= 1) {
        return res.status(400).json({
          error: "Home salons can only have one internal home-service branch",
        });
      }
    }
    const [b] = await db("branches")
      .insert({
        salon_id: salonId,
        name: body.name,
        country: body.country,
        city: body.city,
        area: body.area,
        address_line: body.address_line ?? null,
        lat: body.lat,
        lng: body.lng,
        geo: geoRaw(body.lng, body.lat),
        supports_home_services: body.supports_home_services,
        is_active: body.is_active,
        created_at: db.fn.now(),
        updated_at: db.fn.now(),
      })
      .returning([
        "id",
        "salon_id",
        "name",
        "country",
        "city",
        "area",
        "address_line",
        "lat",
        "lng",
        "supports_home_services",
        "rating",
        "reviews_count",
        "is_active",
      ]);

    // Default hours (Mon-Sat 10:00-22:00, Sun closed) - اختياري
    await db("branch_hours").insert([
      { branch_id: b.id, day_of_week: 0, is_closed: true, open_time: null, close_time: null, updated_at: db.fn.now() },
      { branch_id: b.id, day_of_week: 1, is_closed: false, open_time: "10:00", close_time: "22:00", updated_at: db.fn.now() },
      { branch_id: b.id, day_of_week: 2, is_closed: false, open_time: "10:00", close_time: "22:00", updated_at: db.fn.now() },
      { branch_id: b.id, day_of_week: 3, is_closed: false, open_time: "10:00", close_time: "22:00", updated_at: db.fn.now() },
      { branch_id: b.id, day_of_week: 4, is_closed: false, open_time: "10:00", close_time: "22:00", updated_at: db.fn.now() },
      { branch_id: b.id, day_of_week: 5, is_closed: false, open_time: "10:00", close_time: "22:00", updated_at: db.fn.now() },
      { branch_id: b.id, day_of_week: 6, is_closed: false, open_time: "10:00", close_time: "22:00", updated_at: db.fn.now() },
    ]);

    res.json({ branch: b });
  } catch (e) {
    next(e);
  }
});

// PUT /dashboard/admin/branches/:branchId
router.put("/branches/:branchId", dashboardAuthRequired, requireAdmin, async (req, res, next) => {
  try {
    const branchId = req.params.branchId;
    const patch = AdminUpdateBranchSchema.parse(req.body);

    const exists = await db("branches").where({ id: branchId }).first("id");
    if (!exists) return res.status(404).json({ error: "Branch not found" });

    const update = { ...patch, updated_at: db.fn.now() };

    if (patch.lat != null && patch.lng != null) {
      update.geo = geoRaw(patch.lng, patch.lat);
    }

    const [updated] = await db("branches")
      .where({ id: branchId })
      .update(update)
      .returning([
        "id",
        "salon_id",
        "name",
        "country",
        "city",
        "area",
        "address_line",
        "lat",
        "lng",
        "supports_home_services",
        "rating",
        "reviews_count",
        "is_active",
      ]);

    res.json({ branch: updated });
  } catch (e) {
    next(e);
  }
});

// DELETE /dashboard/admin/branches/:branchId  (Hard delete)
router.delete("/branches/:branchId", dashboardAuthRequired, requireAdmin, async (req, res, next) => {
  try {
    const branchId = req.params.branchId;

    const exists = await db("branches").where({ id: branchId }).first("id");
    if (!exists) return res.status(404).json({ error: "Branch not found" });

    await db("branches").where({ id: branchId }).del();
    res.json({ ok: true, deleted_branch_id: branchId });
  } catch (e) {
    next(e);
  }
});


// GET /dashboard/admin/branches/:branchId
router.get("/branches/:branchId", dashboardAuthRequired, requireAdmin, async (req, res, next) => {
  try {
    const branchId = req.params.branchId;

    const branch = await db("branches").where({ id: branchId }).first();
    if (!branch) return res.status(404).json({ error: "Branch not found" });

    res.json({ branch });
  } catch (e) {
    next(e);
  }
});


// ---------------------------
// Admin: Gift Themes
// (mounted under /dashboard/admin)
// final paths:
// GET    /dashboard/admin/gift-themes
// POST   /dashboard/admin/gift-themes
// PATCH  /dashboard/admin/gift-themes/:id
// DELETE /dashboard/admin/gift-themes/:id
// POST   /dashboard/admin/gift-themes/upload
// POST   /dashboard/admin/gift-themes/reorder
// ---------------------------

const path = require("path");
const fs = require("fs");
const multer = require("multer");

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
  limits: { fileSize: 6 * 1024 * 1024 }, // 6MB
  fileFilter: (req, file, cb) => {
    const ok = ["image/jpeg", "image/png", "image/webp"].includes(file.mimetype);
    cb(ok ? null : new Error("Only JPG/PNG/WEBP allowed"), ok);
  },
});

// Gift Themes Routes - Fixed for Knex
// Replace the gift themes section in your dashboardAdmin.js

// Remove this line:
// const pool = require("../db");  // ❌ DELETE THIS

// You already have this at the top:
// const db = require("../db/knex");  // ✅ USE THIS

// ---------------------------
// Admin: Gift Themes (using Knex)
// ---------------------------

// PUBLIC ROUTES (no auth required)

// GET ALL gift themes
router.get("/gift-themes", dashboardAuthRequired, requireAdmin, async (req, res, next) => {
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

// GET single gift theme
router.get("/gift-themes/:id", dashboardAuthRequired, requireAdmin, async (req, res, next) => {
  try {
    const { id } = req.params;

    const theme = await db("gift_themes")
      .select("id", "title", "category", "front_image_url", "back_image_url", "is_active", "sort_order", "created_at")
      .where({ id })
      .first();

    if (!theme) {
      return res.status(404).json({ ok: false, error: "Gift theme not found" });
    }

    res.json({ ok: true, data: theme });
  } catch (error) {
    console.error("Error fetching gift theme:", error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

// CREATE gift theme
router.post("/gift-themes", dashboardAuthRequired, requireAdmin, async (req, res, next) => {
  try {
    const { title, category, front_image_url, back_image_url, is_active } = req.body;

    // Validation
    if (!title || !front_image_url || !back_image_url) {
      return res.status(400).json({
        ok: false,
        error: "Title, front image, and back image are required"
      });
    }

    // Get max sort_order and add 1
    const maxOrder = await db("gift_themes")
      .max("sort_order as max_order")
      .first();

    const nextOrder = (maxOrder?.max_order || 0) + 1;

    const [created] = await db("gift_themes")
      .insert({
        title,
        category: category || 'Other',
        front_image_url,
        back_image_url,
        is_active: is_active !== false,
        sort_order: nextOrder,
        created_at: db.fn.now(),
        updated_at: db.fn.now(),
      })
      .returning(["id", "title", "category", "front_image_url", "back_image_url", "is_active", "sort_order", "created_at"]);

    res.status(201).json({ ok: true, data: created });
  } catch (error) {
    console.error("Error creating gift theme:", error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

// UPDATE gift theme (PATCH)
router.patch("/gift-themes/:id", dashboardAuthRequired, requireAdmin, async (req, res, next) => {
  try {
    const { id } = req.params;
    const { title, category, front_image_url, back_image_url, is_active } = req.body;

    // Build update object
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
      .returning(["id", "title", "category", "front_image_url", "back_image_url", "is_active", "sort_order", "created_at"]);

    if (!updated) {
      return res.status(404).json({ ok: false, error: "Gift theme not found" });
    }

    res.json({ ok: true, data: updated });
  } catch (error) {
    console.error("Error updating gift theme:", error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

// DELETE gift theme
router.delete("/gift-themes/:id", dashboardAuthRequired, requireAdmin, async (req, res, next) => {
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
    console.error("Error deleting gift theme:", error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

// UPLOAD image (keep as is - this one is fine)
router.post("/gift-themes/upload", upload.single("file"), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ ok: false, error: "No file uploaded" });
    }

    const url = `/uploads/gift-themes/${req.file.filename}`;
    res.json({ ok: true, url });
  } catch (error) {
    console.error("Error uploading gift theme image:", error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

// REORDER gift themes
router.post("/gift-themes/reorder", dashboardAuthRequired, requireAdmin, async (req, res, next) => {
  try {
    const { ids } = req.body;

    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ ok: false, error: "Invalid IDs array" });
    }

    // Update sort_order for each theme
    await db.transaction(async (trx) => {
      for (let i = 0; i < ids.length; i++) {
        await trx("gift_themes")
          .where({ id: ids[i] })
          .update({ sort_order: i + 1 });
      }
    });

    res.json({ ok: true, message: "Themes reordered successfully" });
  } catch (error) {
    console.error("Error reordering gift themes:", error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

module.exports = router;

// Enhanced stats endpoint (replace existing one)
router.get("/stats", dashboardAuthRequired, requireAdmin, async (req, res, next) => {
  try {
    // Salon stats
    const [{ total_salons }] = await db("salons").count("* as total_salons");
    const [{ active_salons }] = await db("salons")
      .where({ is_active: true })
      .count("* as active_salons");

    // Salon types
    const [{ in_salon_salons }] = await db("salons")
      .where({ is_active: true, salon_type: "in_salon" })
      .count("* as in_salon_salons");

    const [{ home_salons }] = await db("salons")
      .where({ is_active: true, salon_type: "home" })
      .count("* as home_salons");

    const [{ both_salons }] = await db("salons")
      .where({ is_active: true, salon_type: "both" })
      .count("* as both_salons");

    // User stats (optional - if you have users table)
    let userStats = null;
    try {
      const [{ total_users }] = await db("users").count("* as total_users");
      const [{ active_users }] = await db("users")
        .where({ is_active: true })
        .count("* as active_users");

      userStats = {
        total: Number(total_users),
        active: Number(active_users),
      };
    } catch (e) {
      // Users table might not exist yet
    }

    // Booking stats (optional - if you have bookings table)
    let bookingStats = null;
    try {
      const [{ total_bookings }] = await db("bookings").count("* as total_bookings");

      const [{ today_bookings }] = await db("bookings")
        .whereRaw("DATE(created_at) = CURRENT_DATE")
        .count("* as today_bookings");

      const [{ month_bookings }] = await db("bookings")
        .whereRaw("DATE_TRUNC('month', created_at) = DATE_TRUNC('month', CURRENT_DATE)")
        .count("* as month_bookings");

      bookingStats = {
        total: Number(total_bookings),
        today: Number(today_bookings),
        thisMonth: Number(month_bookings),
      };
    } catch (e) {
      // Bookings table might not exist yet
    }

    res.json({
      salons: {
        total: Number(total_salons),
        active: Number(active_salons),
      },
      types: {
        in_salon: Number(in_salon_salons),
        home: Number(home_salons),
        both: Number(both_salons),
      },
      ...(userStats && { users: userStats }),
      ...(bookingStats && { bookings: bookingStats }),
    });
  } catch (e) {
    next(e);
  }
});

// Add to dashboardAdmin.js

// GET /dashboard/admin/bookings - List all bookings
router.get("/bookings", dashboardAuthRequired, requireAdmin, async (req, res, next) => {
  try {
    const { status, search, date, mode, limit = 100 } = req.query;

    let query = db("bookings as b")
      .leftJoin("users as u", "u.id", "b.user_id")
      .leftJoin("salons as s", "s.id", "b.salon_id")
      .leftJoin("branches as br", "br.id", "b.branch_id")
      .select([
        "b.id",
        "b.user_id",
        "b.salon_id",
        "b.branch_id",
        "b.scheduled_at",
        "b.mode",
        "b.status",
        "b.total_aed",
        "b.subtotal_aed",
        "b.fees_aed",
        "b.customer_note",
        "b.created_at",
        "u.name as user_name",
        "u.phone as user_phone",
        "s.name as salon_name",
        "br.name as branch_name",
      ])
      .orderBy("b.created_at", "desc")
      .limit(Number(limit));

    if (search) {
      query = query.where(function () {
        this.whereILike("u.name", `%${search}%`)
          .orWhereILike("u.phone", `%${search}%`)
          .orWhereILike("s.name", `%${search}%`)
          .orWhereILike("br.name", `%${search}%`)
          .orWhereILike("b.id", `%${search}%`);
      });
    }

    if (status && status !== "all") {
      query = query.where("b.status", status);
    }

    if (mode && mode !== "all") {
      query = query.where("b.mode", mode);
    }

    if (date) {
      query = query.whereRaw("DATE(b.scheduled_at) = ?", [date]);
    }

    const bookings = await query;
    res.json({ data: bookings });
  } catch (e) {
    next(e);
  }
});

// GET /dashboard/admin/bookings/stats - Get booking statistics
router.get("/bookings/stats", dashboardAuthRequired, requireAdmin, async (req, res, next) => {
  try {
    const [{ total }] = await db("bookings").count("* as total");

    const [{ pending }] = await db("bookings").where({ status: "pending" }).count("* as pending");

    const [{ confirmed }] = await db("bookings")
      .where({ status: "confirmed" })
      .count("* as confirmed");

    const [{ completed }] = await db("bookings")
      .where({ status: "completed" })
      .count("* as completed");

    const [{ cancelled }] = await db("bookings")
      .where({ status: "cancelled" })
      .count("* as cancelled");

    const [{ today }] = await db("bookings")
      .whereRaw("DATE(scheduled_at) = CURRENT_DATE")
      .count("* as today");

    const [{ this_month }] = await db("bookings")
      .whereRaw("DATE_TRUNC('month', scheduled_at) = DATE_TRUNC('month', CURRENT_DATE)")
      .count("* as this_month");

    res.json({
      total: Number(total),
      pending: Number(pending),
      confirmed: Number(confirmed),
      completed: Number(completed),
      cancelled: Number(cancelled),
      today: Number(today),
      thisMonth: Number(this_month),
    });
  } catch (e) {
    next(e);
  }
});

// POST /dashboard/admin/bookings/:id/cancel - Cancel a booking
router.post("/bookings/:id/cancel", dashboardAuthRequired, requireAdmin, async (req, res, next) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;

    const booking = await db("bookings").where({ id }).first();
    if (!booking) {
      return res.status(404).json({ error: "Booking not found" });
    }

    if (booking.status === "cancelled" || booking.status === "completed") {
      return res.status(400).json({
        error: `Cannot cancel ${booking.status} booking`
      });
    }

    await db("bookings")
      .where({ id })
      .update({
        status: "cancelled",
        updated_at: db.fn.now(),
      });

    res.json({
      ok: true,
      message: "Booking cancelled successfully"
    });
  } catch (e) {
    next(e);
  }
});

// GET /dashboard/admin/users - List all users
router.get("/users", dashboardAuthRequired, requireAdmin, async (req, res, next) => {
  try {
    const { search, status, sort = "created_desc", limit = 100 } = req.query;

    let query = db("users as u")
      .select([
        "u.id",
        "u.name",
        "u.phone",
        "u.email",
        "u.wallet_balance_aed",
        "u.is_active",
        "u.is_blocked",
        "u.created_at",
        db.raw("COUNT(DISTINCT b.id) as total_bookings"),
        db.raw("COALESCE(SUM(b.total_aed), 0) as total_spent_aed"),
        db.raw("MAX(b.scheduled_at) as last_booking_at"),
      ])
      .leftJoin("bookings as b", "b.user_id", "u.id")
      .groupBy("u.id")
      .limit(Number(limit));

    if (search) {
      query = query.where(function () {
        this.whereILike("u.name", `%${search}%`)
          .orWhereILike("u.phone", `%${search}%`)
          .orWhereILike("u.email", `%${search}%`);
      });
    }

    if (status === "active") {
      query = query.where("u.is_blocked", false);
    } else if (status === "blocked") {
      query = query.where("u.is_blocked", true);
    }

    if (sort === "created_desc") query = query.orderBy("u.created_at", "desc");
    else if (sort === "created_asc") query = query.orderBy("u.created_at", "asc");
    else if (sort === "bookings_desc") query = query.orderByRaw("COUNT(DISTINCT b.id) DESC");
    else if (sort === "spent_desc") query = query.orderByRaw("COALESCE(SUM(b.total_aed), 0) DESC");
    else if (sort === "name_asc") query = query.orderBy("u.name", "asc");

    const users = await query;

    const formatted = users.map((u) => ({
      ...u,
      wallet_balance_aed: Number(u.wallet_balance_aed || 0),
      total_bookings: Number(u.total_bookings || 0),
      total_spent_aed: Number(u.total_spent_aed || 0),
      is_active: Boolean(u.is_active),
      is_blocked: Boolean(u.is_blocked),
    }));

    res.json({ data: formatted });
  } catch (e) {
    next(e);
  }
});

// GET /dashboard/admin/users/stats - Get user statistics
router.get("/users/stats", dashboardAuthRequired, requireAdmin, async (req, res, next) => {
  try {
    const [{ total_users }] = await db("users").count("* as total_users");

    const [{ active_users }] = await db("users")
      .where({ is_blocked: false })
      .count("* as active_users");

    const [{ blocked_users }] = await db("users")
      .where({ is_blocked: true })
      .count("* as blocked_users");

    const [{ new_this_month }] = await db("users")
      .whereRaw("DATE_TRUNC('month', created_at) = DATE_TRUNC('month', CURRENT_DATE)")
      .count("* as new_this_month");

    res.json({
      total_users: Number(total_users),
      active_users: Number(active_users),
      blocked_users: Number(blocked_users),
      new_this_month: Number(new_this_month),
    });
  } catch (e) {
    next(e);
  }
});

// POST /dashboard/admin/users/:id/toggle-block - Block/unblock user
router.post("/users/:id/toggle-block", dashboardAuthRequired, requireAdmin, async (req, res, next) => {
  try {
    const { id } = req.params;

    const user = await db("users").where({ id }).first(["id", "is_blocked"]);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const newStatus = !user.is_blocked;

    await db("users")
      .where({ id })
      .update({
        is_blocked: newStatus,
        updated_at: db.fn.now(),
      });

    res.json({
      ok: true,
      is_blocked: newStatus,
      message: `User ${newStatus ? "blocked" : "unblocked"} successfully`,
    });
  } catch (e) {
    next(e);
  }
});

// GET /dashboard/admin/users/:id
router.get("/users/:id", dashboardAuthRequired, requireAdmin, async (req, res, next) => {
  try {
    const { id } = req.params;

    // User profile with aggregated stats
    const user = await db("users as u")
      .where("u.id", id)
      .select([
        "u.id",
        "u.name",
        "u.phone",
        "u.email",
        "u.wallet_balance_aed",
        "u.is_active",
        "u.is_blocked",
        "u.created_at",
        db.raw("COUNT(DISTINCT b.id) as total_bookings"),
        db.raw("COALESCE(SUM(b.total_aed), 0) as total_spent_aed"),
        db.raw("MAX(b.scheduled_at) as last_booking_at"),
      ])
      .leftJoin("bookings as b", "b.user_id", "u.id")
      .groupBy("u.id")
      .first();

    if (!user) return res.status(404).json({ error: "User not found" });

    // Recent bookings (last 20)
    const bookings = await db("bookings as b")
      .where("b.user_id", id)
      .leftJoin("salons as s", "s.id", "b.salon_id")
      .leftJoin("branches as br", "br.id", "b.branch_id")
      .select([
        "b.id",
        "b.scheduled_at",
        "b.mode",
        "b.status",
        "b.total_aed",
        "b.created_at",
        "s.name as salon_name",
        "br.name as branch_name",
      ])
      .orderBy("b.created_at", "desc")
      .limit(20);

    res.json({
      user: {
        ...user,
        wallet_balance_aed: Number(user.wallet_balance_aed || 0),
        total_bookings: Number(user.total_bookings || 0),
        total_spent_aed: Number(user.total_spent_aed || 0),
        is_active: Boolean(user.is_active),
        is_blocked: Boolean(user.is_blocked),
      },
      bookings,
    });
  } catch (e) {
    next(e);
  }
});

// GET /dashboard/admin/bookings/:id
router.get("/bookings/:id", dashboardAuthRequired, requireAdmin, async (req, res, next) => {
  try {
    const { id } = req.params;

    const booking = await db("bookings as b")
      .where("b.id", id)
      .leftJoin("users as u", "u.id", "b.user_id")
      .leftJoin("salons as s", "s.id", "b.salon_id")
      .leftJoin("branches as br", "br.id", "b.branch_id")
      .select([
        "b.id",
        "b.user_id",
        "b.salon_id",
        "b.branch_id",
        "b.scheduled_at",
        "b.mode",
        "b.status",
        "b.total_aed",
        "b.subtotal_aed",
        "b.fees_aed",
        "b.customer_note",
        "b.created_at",
        "b.updated_at",
        "u.name as user_name",
        "u.phone as user_phone",
        "u.email as user_email",
        "s.name as salon_name",
        "br.name as branch_name",
        "br.city as branch_city",
        "br.area as branch_area",
        "br.address_line as branch_address",
      ])
      .first();

    if (!booking) return res.status(404).json({ error: "Booking not found" });

    // Line items
    const items = await db("booking_items")
      .where({ booking_id: id })
      .select([
        "id",
        "service_name",
        "qty",
        "unit_price_aed",
        "duration_mins",
      ]);

    res.json({
      booking: {
        ...booking,
        total_aed: Number(booking.total_aed || 0),
        subtotal_aed: Number(booking.subtotal_aed || 0),
        fees_aed: Number(booking.fees_aed || 0),
      },
      items: items.map((it) => ({
        ...it,
        qty: Number(it.qty || 1),
        unit_price_aed: Number(it.unit_price_aed || 0),
        duration_mins: Number(it.duration_mins || 0),
      })),
    });
  } catch (e) {
    next(e);
  }
});

// GET /dashboard/admin/feedback
router.get("/feedback", dashboardAuthRequired, requireAdmin, async (req, res, next) => {
  try {
    const { rating, salon_id, limit = 100 } = req.query;

    let query = db("booking_ratings as r")
      .leftJoin("users as u", "u.id", "r.user_id")
      .leftJoin("salons as s", "s.id", "r.salon_id")
      .leftJoin("branches as br", "br.id", "r.branch_id")
      .select([
        "r.id",
        "r.booking_id",
        "r.user_id",
        "r.rating",
        "r.comment",
        "r.created_at",
        "u.name as user_name",
        "s.id as salon_id",
        "s.name as salon_name",
        "br.name as branch_name",
      ])
      .orderBy("r.created_at", "desc")
      .limit(Number(limit));

    // Filter by exact rating
    if (rating && rating !== "all") {
      if (rating === "low") {
        query = query.where("r.rating", "<=", 2);
      } else {
        query = query.where("r.rating", Number(rating));
      }
    }

    // Filter by salon
    if (salon_id) {
      query = query.where("r.salon_id", salon_id);
    }

    const rows = await query;

    res.json({ data: rows });
  } catch (e) {
    next(e);
  }
});

// ---------------------------
// Admin: Mobile Banners
// mounted under /dashboard/admin
// final paths:
// GET    /dashboard/admin/mobile-banners
// GET    /dashboard/admin/mobile-banners/:id
// POST   /dashboard/admin/mobile-banners
// PUT    /dashboard/admin/mobile-banners/:id
// DELETE /dashboard/admin/mobile-banners/:id
// POST   /dashboard/admin/mobile-banners/reorder
// POST   /dashboard/admin/mobile-banners/upload
// ---------------------------

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
  limits: { fileSize: 8 * 1024 * 1024 }, // 8MB
  fileFilter: (req, file, cb) => {
    const ok = ["image/jpeg", "image/png", "image/webp"].includes(file.mimetype);
    cb(ok ? null : new Error("Only JPG/PNG/WEBP allowed"), ok);
  },
});

// GET /dashboard/admin/mobile-banners
router.get("/mobile-banners", dashboardAuthRequired, requireAdmin, async (req, res, next) => {
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
router.get("/mobile-banners/:id", dashboardAuthRequired, requireAdmin, async (req, res, next) => {
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
router.post("/mobile-banners", dashboardAuthRequired, requireAdmin, async (req, res, next) => {
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
router.put("/mobile-banners/:id", dashboardAuthRequired, requireAdmin, async (req, res, next) => {
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
router.delete("/mobile-banners/:id", dashboardAuthRequired, requireAdmin, async (req, res, next) => {
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
router.post("/mobile-banners/reorder", dashboardAuthRequired, requireAdmin, async (req, res, next) => {
  try {
    const { items } = req.body;
    // expected:
    // items: [{ id: "...", sort_order: 1 }, { id: "...", sort_order: 2 }]

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
router.post(
  "/mobile-banners/upload",
  dashboardAuthRequired,
  requireAdmin,
  bannerUpload.single("file"),
  async (req, res, next) => {
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
  }
);
router.use("/notifications", require("./adminNotifications"));

module.exports = router;
