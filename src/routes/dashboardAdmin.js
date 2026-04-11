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

router.use("/notifications", require("./adminNotifications"));
router.use("/payments", require("./adminPayments"));
router.use("/wallet", require("./adminWallet"));
router.use("/bookings", require("./adminBookings"));
router.use("/users", require("./adminUsers"));
router.use("/gift-themes", require("./adminGiftThemes"));
router.use("/mobile-banners", require("./adminMobileBanners"));
router.use("/feedback", require("./adminFeedback"));

module.exports = router;
