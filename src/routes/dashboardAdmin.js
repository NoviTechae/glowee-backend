// src/routes/dashboardAdmin.js
const router = require("express").Router();
const { z } = require("zod");
const bcrypt = require("bcrypt");
const db = require("../db/knex");
const dashboardAuthRequired = require("../middleware/dashboardAuthRequired");
const { syncSalonType } = require("../utils/salonType");

function requireAdmin(req, res, next) {
  if (req.dashboard?.role !== "admin") return res.status(403).json({ error: "Admin only" });
  next();
}

// Counts used by the dashboard to show whether a salon is ready for customers.
function withSalonCounts(q) {
  return q.select(
    "s.*",
    db.raw(
      `(SELECT COUNT(*) FROM branches b WHERE b.salon_id = s.id AND b.is_active = true)::int AS active_branches`
    ),
    db.raw(
      `(SELECT COUNT(*) FROM services sv WHERE sv.salon_id = s.id AND sv.is_active = true)::int AS active_services`
    ),
    db.raw(
      `(SELECT COUNT(*) FROM bookings bk WHERE bk.salon_id = s.id AND bk.status IN ('confirmed', 'completed'))::int AS bookings_count`
    ),
    db.raw(
      `(SELECT da.email FROM dashboard_accounts da WHERE da.salon_id = s.id AND da.role = 'salon' ORDER BY da.created_at LIMIT 1) AS account_email`
    )
  );
}

function geoRaw(lng, lat) {
  return db.raw(`ST_SetSRID(ST_MakePoint(?, ?), 4326)::geography`, [lng, lat]);
}

const BRANCH_COLUMNS = [
  "id",
  "salon_id",
  "name",
  "country",
  "city",
  "area",
  "address_line",
  "lat",
  "lng",
  "offers_in_salon",
  "supports_home_services",
  "home_radius_km",
  "home_min_order_aed",
  "rating",
  "reviews_count",
  "is_active",
];

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

  if (!s) return undefined;
  if (s === "home_service") return "home";
  if (s === "in-salon") return "in_salon";
  if (s === "insalon") return "in_salon";
  if (s === "homeservice") return "home";

  return s;
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
  home_branch: z
    .object({
      city: z.string().min(2),
      area: z.string().min(2),
      address_line: z.string().nullable().optional(),
      lat: z.coerce.number(),
      lng: z.coerce.number(),
      radius_km: z.coerce.number().positive().max(200).optional(),
      min_order_aed: z.coerce.number().min(0).max(100000).nullable().optional(),
      min_order_aed: z.coerce.number().positive().max(100000).nullable().optional(),
    })
    .nullable()
    .optional(),
});

// POST /dashboard/admin/salons  (creates the salon + its dashboard login)
router.post("/salons", dashboardAuthRequired, requireAdmin, async (req, res, next) => {
  try {
    const { salon, account, home_branch } = CreateSalonSchema.parse(req.body);

    const existing = await db("dashboard_accounts")
      .where({ email: account.email.toLowerCase() })
      .first("id");

    if (existing) {
      return res.status(409).json({
        error: "This email already has a Glowee dashboard account. Use a different email.",
      });
    }

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

      // Home-only businesses get a private starting point that home visits are measured from.
      if (s.salon_type === "home") {
        const [branch] = await trx("branches")
          .insert({
            salon_id: s.id,
            name: "Home Service",
            country: "United Arab Emirates",
            city: home_branch?.city ?? "UAE",
            area: home_branch?.area ?? "Home Service",
            address_line: home_branch?.address_line ?? null,
            lat: home_branch?.lat ?? 0,
            lng: home_branch?.lng ?? 0,
            geo: geoRaw(home_branch?.lng ?? 0, home_branch?.lat ?? 0),
            offers_in_salon: false,
            supports_home_services: true,
            home_radius_km: home_branch?.radius_km ?? 25,
            home_min_order_aed: home_branch?.min_order_aed ?? null,
            home_min_order_aed: home_branch?.min_order_aed ?? null,
            is_active: true,
            created_at: trx.fn.now(),
            updated_at: trx.fn.now(),
          })
          .returning(["id", "name", "salon_id"]);

        await trx("branch_hours").insert(
          [0, 1, 2, 3, 4, 5, 6].map((day) => ({
            branch_id: branch.id,
            day_of_week: day,
            is_closed: false,
            open_time: "10:00",
            close_time: "22:00",
            updated_at: trx.fn.now(),
          }))
        );
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
    const type = (req.query.type || "").toString();

    let q = withSalonCounts(db("salons as s")).orderBy("s.created_at", "desc");

    if (type === "in_salon") q = q.where("s.salon_type", "in_salon");
    if (type === "home") q = q.where("s.salon_type", "home");
    if (type === "both") q = q.where("s.salon_type", "both");
    if (type === "salons_only") q = q.whereIn("s.salon_type", ["in_salon", "both"]);
    if (type === "home_only") q = q.where("s.salon_type", "home");

    const rows = await q;
    res.json({ data: rows });
  } catch (e) {
    next(e);
  }
});

// GET /dashboard/admin/salons/:id
router.get("/salons/:id", dashboardAuthRequired, requireAdmin, async (req, res, next) => {
  try {
    const salon = await withSalonCounts(db("salons as s"))
      .where("s.id", req.params.id)
      .first();

    if (!salon) return res.status(404).json({ error: "Salon not found" });
    res.json({ salon });
  } catch (e) {
    next(e);
  }
});

// PUT /dashboard/admin/salons/:id  (Update)
// salon_type is no longer edited here: it follows the salon's branches.
const UpdateSalonSchema = z.object({
  name: z.string().min(2).optional(),
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

    const hasBookings = await db("bookings").where({ salon_id: id }).first("id");
    if (hasBookings) {
      return res.status(409).json({
        error: "This salon has bookings, so it can't be deleted. Deactivate it instead.",
      });
    }

    await db.transaction(async (trx) => {
      await trx("branches").where({ salon_id: id }).del();
      await trx("services").where({ salon_id: id }).del();
      await trx("dashboard_accounts").where({ salon_id: id }).del();
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

const BranchFields = z.object({
  name: z.string().min(2),
  country: z.string().min(2).default("United Arab Emirates"),
  city: z.string().min(2),
  area: z.string().min(2),
  address_line: z.string().nullable().optional(),
  lat: z.coerce.number(),
  lng: z.coerce.number(),

  offers_in_salon: z.coerce.boolean().optional().default(true),
  supports_home_services: z.coerce.boolean().optional().default(false),
  home_radius_km: z.coerce.number().positive().max(200).nullable().optional(),
  home_min_order_aed: z.coerce.number().positive().max(100000).nullable().optional(),
  is_active: z.coerce.boolean().optional().default(true),
});

const OFFERS_SOMETHING = "A location must offer in-salon visits, home service, or both.";

const AdminCreateBranchSchema = BranchFields.refine(
  (b) => b.offers_in_salon || b.supports_home_services,
  { message: OFFERS_SOMETHING }
);

const AdminUpdateBranchSchema = BranchFields.partial();

// GET /dashboard/admin/salons/:salonId/branches
router.get("/salons/:salonId/branches", dashboardAuthRequired, requireAdmin, async (req, res, next) => {
  try {
    const rows = await db("branches")
      .where({ salon_id: req.params.salonId })
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

    const s = await db("salons").where({ id: salonId }).first("id");
    if (!s) return res.status(404).json({ error: "Salon not found" });

    const b = await db.transaction(async (trx) => {
      const [branch] = await trx("branches")
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
          offers_in_salon: body.offers_in_salon,
          supports_home_services: body.supports_home_services,
          home_radius_km: body.supports_home_services ? body.home_radius_km ?? 15 : null,
          home_min_order_aed: body.supports_home_services ? body.home_min_order_aed ?? null : null,
          is_active: body.is_active,
          created_at: trx.fn.now(),
          updated_at: trx.fn.now(),
        })
        .returning(BRANCH_COLUMNS);

      // Default hours: Sunday closed, Monday to Saturday 10:00 to 22:00. The salon can change them.
      await trx("branch_hours").insert(
        [0, 1, 2, 3, 4, 5, 6].map((day) => ({
          branch_id: branch.id,
          day_of_week: day,
          is_closed: day === 0,
          open_time: day === 0 ? null : "10:00",
          close_time: day === 0 ? null : "22:00",
          updated_at: trx.fn.now(),
        }))
      );

      await syncSalonType(salonId, trx);
      return branch;
    });

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

    const current = await db("branches")
      .where({ id: branchId })
      .first("id", "salon_id", "offers_in_salon", "supports_home_services", "home_radius_km");
    if (!current) return res.status(404).json({ error: "Branch not found" });

    const next_offers_in_salon = patch.offers_in_salon ?? current.offers_in_salon;
    const next_home = patch.supports_home_services ?? current.supports_home_services;

    if (!next_offers_in_salon && !next_home) {
      return res.status(400).json({ error: OFFERS_SOMETHING });
    }

    const update = { ...patch, updated_at: db.fn.now() };

    if (patch.lat != null && patch.lng != null) {
      update.geo = geoRaw(patch.lng, patch.lat);
    }

    if (!next_home) {
      update.home_radius_km = null;
      update.home_min_order_aed = null;
    } else if (update.home_radius_km == null && current.home_radius_km == null) {
      update.home_radius_km = 15;
    }

    const updated = await db.transaction(async (trx) => {
      const [row] = await trx("branches")
        .where({ id: branchId })
        .update(update)
        .returning(BRANCH_COLUMNS);

      await syncSalonType(current.salon_id, trx);
      return row;
    });

    res.json({ branch: updated });
  } catch (e) {
    next(e);
  }
});

// DELETE /dashboard/admin/branches/:branchId  (Hard delete)
router.delete("/branches/:branchId", dashboardAuthRequired, requireAdmin, async (req, res, next) => {
  try {
    const branchId = req.params.branchId;

    const current = await db("branches").where({ id: branchId }).first("id", "salon_id");
    if (!current) return res.status(404).json({ error: "Branch not found" });

    await db.transaction(async (trx) => {
      await trx("branches").where({ id: branchId }).del();
      await syncSalonType(current.salon_id, trx);
    });

    res.json({ ok: true, deleted_branch_id: branchId });
  } catch (e) {
    next(e);
  }
});

// GET /dashboard/admin/branches/:branchId
router.get("/branches/:branchId", dashboardAuthRequired, requireAdmin, async (req, res, next) => {
  try {
    const branch = await db("branches").where({ id: req.params.branchId }).first();
    if (!branch) return res.status(404).json({ error: "Branch not found" });

    res.json({ branch });
  } catch (e) {
    next(e);
  }
});

// GET /dashboard/admin/stats
router.get("/stats", dashboardAuthRequired, requireAdmin, async (req, res, next) => {
  try {
    const [{ total_salons }] = await db("salons").count("* as total_salons");
    const [{ active_salons }] = await db("salons")
      .where({ is_active: true })
      .count("* as active_salons");

    const [{ in_salon_salons }] = await db("salons")
      .where({ is_active: true, salon_type: "in_salon" })
      .count("* as in_salon_salons");

    const [{ home_salons }] = await db("salons")
      .where({ is_active: true, salon_type: "home" })
      .count("* as home_salons");

    const [{ both_salons }] = await db("salons")
      .where({ is_active: true, salon_type: "both" })
      .count("* as both_salons");

    let userStats = null;
    try {
      const [{ total_users }] = await db("users").count("* as total_users");
      const [{ active_users }] = await db("users")
        .where({ is_active: true })
        .count("* as active_users");

      userStats = { total: Number(total_users), active: Number(active_users) };
    } catch (e) {
      // users table might not exist
    }

    let bookingStats = null;
    try {
      const [{ total_bookings }] = await db("bookings").count("* as total_bookings");

      const [{ today_bookings }] = await db("bookings")
        .whereRaw(`
          (scheduled_at AT TIME ZONE 'Asia/Dubai')::date =
          (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Dubai')::date
        `)
        .count("* as today_bookings");

      const [{ month_bookings }] = await db("bookings")
        .whereRaw(`
          DATE_TRUNC('month', scheduled_at AT TIME ZONE 'Asia/Dubai') =
          DATE_TRUNC('month', CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Dubai')
        `)
        .count("* as month_bookings");

      bookingStats = {
        total: Number(total_bookings),
        today: Number(today_bookings),
        thisMonth: Number(month_bookings),
      };
    } catch (e) {
      // bookings table might not exist
    }

    res.json({
      salons: { total: Number(total_salons), active: Number(active_salons) },
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
router.use("/partner-requests", require("./adminPartnerRequests"));

module.exports = router;