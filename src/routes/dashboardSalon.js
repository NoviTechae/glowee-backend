//src/routes/dashboardSalon.js
const router = require("express").Router();
const { z } = require("zod");
const db = require("../db/knex");
const dashboardAuthRequired = require("../middleware/dashboardAuthRequired");
const path = require("path");
const fs = require("fs");
const multer = require("multer");
const { completeBooking } = require("../controllers/bookingController");

const uploadDir = path.join(process.cwd(), "public", "uploads", "salons");
fs.mkdirSync(uploadDir, { recursive: true });

const serviceUploadDir = path.join(process.cwd(), "public", "uploads", "services");
fs.mkdirSync(serviceUploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || "").toLowerCase() || ".jpg";
    const safe = file.fieldname === "logo" ? "logo" : "cover";
    const name = `${safe}_${Date.now()}_${Math.random().toString(16).slice(2)}${ext}`;
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

const serviceStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, serviceUploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || "").toLowerCase() || ".jpg";
    const name = `service_${Date.now()}_${Math.random().toString(16).slice(2)}${ext}`;
    cb(null, name);
  },
});

const serviceUpload = multer({
  storage: serviceStorage,
  limits: { fileSize: 6 * 1024 * 1024 }, // 6MB
  fileFilter: (req, file, cb) => {
    const ok = ["image/jpeg", "image/png", "image/webp"].includes(file.mimetype);
    cb(ok ? null : new Error("Only JPG/PNG/WEBP allowed"), ok);
  },
});

// ---------------------------
// Guards
// ---------------------------

function requireSalon(req, res, next) {
  if (req.dashboard?.role !== "salon") return res.status(403).json({ error: "Salon only" });
  if (!req.dashboard?.salon_id) return res.status(401).json({ error: "Missing salon_id" });
  next();
}

function geoRaw(lng, lat) {
  return db.raw(`ST_SetSRID(ST_MakePoint(?, ?), 4326)::geography`, [lng, lat]);
}

// ---------------------------
// Schemas
// ---------------------------
const UpdateSalonSchema = z.object({
  name: z.string().min(2).optional(),
  about: z.string().nullable().optional(),
  logo_url: z.string().url().nullable().optional(),
  cover_url: z.string().url().nullable().optional(),
  phone: z.string().nullable().optional(),
  email: z.string().email().nullable().optional(),
  instagram: z.string().nullable().optional(),
  website: z.string().nullable().optional(),
  is_featured: z.boolean().optional(),
  double_stamps: z.boolean().optional(),
  discount_percent: z.number().int().min(0).max(100).nullable().optional(),
}).strict();

const BranchCreateSchema = z.object({
  name: z.string().min(2),
  phone: z.string().nullable().optional(),
  email: z.string().email().nullable().optional(),
  whatsapp: z.string().nullable().optional(),
  instagram: z.string().nullable().optional(),
  country: z.string().min(2).default("United Arab Emirates"),
  city: z.string().min(2),
  area: z.string().min(2),
  address_line: z.string().nullable().optional(),
  lat: z.coerce.number(),
  lng: z.coerce.number(),
  supports_home_services: z.coerce.boolean().optional().default(false),
  is_active: z.coerce.boolean().optional().default(true),
}).strict();

const BranchUpdateSchema = BranchCreateSchema.partial();
const HoursUpsertSchema = z.object({
  // 0=Sunday ... 6=Saturday
  day_of_week: z.coerce.number().min(0).max(6),
  is_closed: z.coerce.boolean().optional().default(false),
  open_time: z.string().regex(/^\d\d:\d\d$/).nullable().optional(),  // "09:00"
  close_time: z.string().regex(/^\d\d:\d\d$/).nullable().optional(), // "22:00"
}).strict();

const CategoryCreateSchema = z.object({
  name: z.string().min(2),
}).strict();

const CategoryUpdateSchema = CategoryCreateSchema.partial();

const ServiceCreateSchema = z.object({
  category_id: z.string().uuid().nullable().optional(),
  name: z.string().min(2),
  description: z.string().nullable().optional(),
  image_url: z.string().url().nullable().optional(),
  is_active: z.coerce.boolean().optional().default(true),
}).strict();

const ServiceUpdateSchema = ServiceCreateSchema.partial();

const AvailabilityUpsertSchema = z.object({
  mode: z.enum(["in_salon", "home"]),
  duration_mins: z.coerce.number().int().min(5),
  price_aed: z.coerce.number().min(0),
  travel_fee_aed: z.coerce.number().min(0).optional().default(0),
  is_active: z.coerce.boolean().optional().default(true),
}).strict();

// =====================================================
// Salon: Staff
// =====================================================

const StaffCreateSchema = z.object({
  branch_id: z.string().uuid(),
  name: z.string().min(2),
  phone: z.string().nullable().optional(),
  is_active: z.coerce.boolean().optional().default(true),
}).strict();

const StaffUpdateSchema = z.object({
  branch_id: z.string().uuid().optional(),
  name: z.string().min(2).optional(),
  phone: z.string().nullable().optional(),
  is_active: z.coerce.boolean().optional(),
}).strict();

const StaffServicesUpsertSchema = z.object({
  service_ids: z.array(z.string().uuid()).default([]),
}).strict();

// GET /dashboard/salon/staff
router.get("/staff", dashboardAuthRequired, requireSalon, async (req, res, next) => {
  try {
    const salon_id = req.dashboard.salon_id;

    const rows = await db("staff as st")
      .leftJoin("branch_staff as bs", function () {
        this.on("bs.staff_id", "st.id").andOn("bs.is_active", "=", db.raw("true"));
      })
      .leftJoin("branches as b", "b.id", "bs.branch_id")
      .where("st.salon_id", salon_id)
      .select([
        "st.id",
        "st.name",
        "st.phone",
        "bs.branch_id",
        "b.name as branch_name",
        "st.is_active",
        "st.created_at",
      ])
      .orderBy("st.created_at", "desc");

    // services لكل staff (للواجهة)
    const staffIds = rows.map((r) => r.id);
    const svcRows = staffIds.length
      ? await db("staff_services as ss")
        .join("services as s", "s.id", "ss.service_id")
        .whereIn("ss.staff_id", staffIds)
        .select(["ss.staff_id", "s.id as service_id", "s.name as service_name"])
      : [];

    const svcMap = new Map();
    for (const r of svcRows) {
      if (!svcMap.has(r.staff_id)) svcMap.set(r.staff_id, []);
      svcMap.get(r.staff_id).push({ service_id: r.service_id, service_name: r.service_name });
    }

    const data = rows.map((r) => ({
      ...r,
      services: svcMap.get(r.id) || [],
    }));

    res.json({ data });
  } catch (e) {
    next(e);
  }
});

// POST /dashboard/salon/staff
router.post("/staff", dashboardAuthRequired, requireSalon, async (req, res, next) => {
  try {
    const salon_id = req.dashboard.salon_id;
    const body = StaffCreateSchema.parse(req.body);

    // ✅ تأكد الفرع تابع للصالون
    const branch = await db("branches").where({ id: body.branch_id, salon_id }).first("id");
    if (!branch) return res.status(404).json({ error: "Branch not found" });

    const result = await db.transaction(async (trx) => {
      const [staff] = await trx("staff")
        .insert({
          salon_id,
          name: body.name,
          phone: body.phone ?? null,
          is_active: body.is_active,
          created_at: trx.fn.now(),
          updated_at: trx.fn.now(),
        })
        .returning(["id", "name", "phone", "is_active", "created_at", "updated_at"]);

      await trx("branch_staff")
        .insert({
          branch_id: body.branch_id,
          staff_id: staff.id,
          is_active: true,
          created_at: trx.fn.now(),
        })
        .onConflict(["branch_id", "staff_id"])
        .ignore();

      return {
        ...staff,
        branch_id: body.branch_id,
      };
    });

    res.json({ staff: result });
  } catch (e) {
    next(e);
  }
});

// GET /dashboard/salon/staff/:staffId
router.get("/staff/:staffId", dashboardAuthRequired, requireSalon, async (req, res, next) => {
  try {
    const salon_id = req.dashboard.salon_id;
    const { staffId } = req.params;

    const staff = await db("staff as st")
      .leftJoin("branch_staff as bs", function () {
        this.on("bs.staff_id", "st.id").andOn("bs.is_active", "=", db.raw("true"));
      })
      .leftJoin("branches as b", "b.id", "bs.branch_id")
      .where("st.id", staffId)
      .andWhere("st.salon_id", salon_id)
      .select([
        "st.id",
        "st.name",
        "st.phone",
        "bs.branch_id",
        "b.name as branch_name",
        "st.is_active",
      ])
      .first();

    if (!staff) {
      return res.status(404).json({ error: "Staff not found" });
    }

    // Get services
    const services = await db("staff_services as ss")
      .join("services as s", "s.id", "ss.service_id")
      .where("ss.staff_id", staffId)
      .select(["s.id as service_id", "s.name as service_name"]);

    res.json({
      staff: {
        ...staff,
        services: services || []
      }
    });
  } catch (e) {
    next(e);
  }
});

// PUT /dashboard/salon/staff/:staffId
router.put("/staff/:staffId", dashboardAuthRequired, requireSalon, async (req, res, next) => {
  try {
    const salon_id = req.dashboard.salon_id;
    const { staffId } = req.params;
    const patch = StaffUpdateSchema.parse(req.body);

    if (patch.branch_id) {
      const branch = await db("branches").where({ id: patch.branch_id, salon_id }).first("id");
      if (!branch) return res.status(404).json({ error: "Branch not found" });
    }

    const result = await db.transaction(async (trx) => {
      const staffPatch = { ...patch };
      delete staffPatch.branch_id;

      const [staff] = await trx("staff")
        .where({ id: staffId, salon_id })
        .update({ ...staffPatch, updated_at: trx.fn.now() })
        .returning(["id", "name", "phone", "is_active", "created_at", "updated_at"]);

      if (!staff) return null;

      if (patch.branch_id) {
        await trx("branch_staff").where({ staff_id: staffId }).del();

        await trx("branch_staff").insert({
          branch_id: patch.branch_id,
          staff_id: staffId,
          is_active: true,
          created_at: trx.fn.now(),
        });
      }

      const link = await trx("branch_staff")
        .where({ staff_id: staffId })
        .first("branch_id");

      return {
        ...staff,
        branch_id: link?.branch_id ?? null,
      };
    });

    if (!result) return res.status(404).json({ error: "Staff not found" });
    res.json({ staff: result });

  } catch (e) {
    next(e);
  }
});

// POST /dashboard/salon/staff/:staffId/services  (replace)
router.post("/staff/:staffId/services", dashboardAuthRequired, requireSalon, async (req, res, next) => {
  try {
    const salon_id = req.dashboard.salon_id;
    const { staffId } = req.params;
    const body = StaffServicesUpsertSchema.parse(req.body);

    const st = await db("staff").where({ id: staffId, salon_id }).first(["id", "salon_id"]);
    if (!st) return res.status(404).json({ error: "Staff not found" });

    // تأكد الخدمات للصالون
    if (body.service_ids.length > 0) {
      const ok = await db("services")
        .where({ salon_id })
        .whereIn("id", body.service_ids)
        .count("* as c")
        .first();

      if (Number(ok?.c || 0) !== body.service_ids.length) {
        return res.status(400).json({ error: "One or more services are invalid" });
      }
    }

    await db.transaction(async (trx) => {
      await trx("staff_services").where({ staff_id: staffId }).del();
      if (body.service_ids.length > 0) {
        await trx("staff_services").insert(body.service_ids.map((sid) => ({
          staff_id: staffId,
          service_id: sid,
        })));
      }
    });

    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

// DELETE /dashboard/salon/staff/:staffId
router.delete("/staff/:staffId", dashboardAuthRequired, requireSalon, async (req, res, next) => {
  try {
    const salon_id = req.dashboard.salon_id;
    const { staffId } = req.params;

    const exists = await db("staff").where({ id: staffId, salon_id }).first("id");
    if (!exists) return res.status(404).json({ error: "Staff not found" });

    await db("staff").where({ id: staffId }).del();
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

// =====================================================
// Salon: Profile
// =====================================================

// GET /dashboard/salon/me
router.get("/me", dashboardAuthRequired, requireSalon, async (req, res, next) => {
  try {
    const salon_id = req.dashboard.salon_id;
    const salon = await db("salons").where({ id: salon_id }).first();
    if (!salon) return res.status(404).json({ error: "Salon not found" });
    res.json({ salon });
  } catch (e) {
    next(e);
  }
});

// PUT /dashboard/salon/me
router.put("/me", dashboardAuthRequired, requireSalon, async (req, res, next) => {
  try {
    const salon_id = req.dashboard.salon_id;
    const patch = UpdateSalonSchema.parse(req.body);

    const [updated] = await db("salons")
      .where({ id: salon_id })
      .update({ ...patch, updated_at: db.fn.now() })
      .returning(["id", "name", "about", "logo_url", "cover_url", "phone", "email", "instagram", "website", "is_featured", "double_stamps", "discount_percent", "updated_at"]);

    res.json({ salon: updated });
  } catch (e) {
    next(e);
  }
});

// PATCH /dashboard/salon/me/flags — toggle is_featured / double_stamps / discount_percent
router.patch("/me/flags", dashboardAuthRequired, requireSalon, async (req, res, next) => {
  try {
    const salon_id = req.dashboard.salon_id;

    const FlagsSchema = z.object({
      is_featured: z.boolean().optional(),
      double_stamps: z.boolean().optional(),
      discount_percent: z.number().int().min(0).max(100).nullable().optional(),
    }).strict();

    const patch = FlagsSchema.parse(req.body);

    if (Object.keys(patch).length === 0) {
      return res.status(400).json({ error: "No flags provided" });
    }

    const [updated] = await db("salons")
      .where({ id: salon_id })
      .update({ ...patch, updated_at: db.fn.now() })
      .returning(["id", "is_featured", "double_stamps", "discount_percent", "updated_at"]);

    res.json({ ok: true, salon: updated });
  } catch (e) {
    next(e);
  }
});

// POST /dashboard/salon/me/logo
router.post(
  "/me/logo",
  dashboardAuthRequired,
  requireSalon,
  upload.single("file"),
  async (req, res, next) => {
    try {
      const salon_id = req.dashboard.salon_id;

      if (!req.file) {
        return res.status(400).json({ error: "Missing file" });
      }

      const logo_url = `/uploads/salons/${req.file.filename}`;

      const [updated] = await db("salons")
        .where({ id: salon_id })
        .update({
          logo_url,
          updated_at: db.fn.now(),
        })
        .returning(["id", "logo_url", "updated_at"]);

      res.json({ ok: true, logo_url, salon: updated });
    } catch (e) {
      next(e);
    }
  }
);

// POST /dashboard/salon/me/cover
router.post(
  "/me/cover",
  dashboardAuthRequired,
  requireSalon,
  upload.single("file"),
  async (req, res, next) => {
    try {
      const salon_id = req.dashboard.salon_id;

      if (!req.file) {
        return res.status(400).json({ error: "Missing file" });
      }

      const cover_url = `/uploads/salons/${req.file.filename}`;

      const [updated] = await db("salons")
        .where({ id: salon_id })
        .update({
          cover_url,
          updated_at: db.fn.now(),
        })
        .returning(["id", "cover_url", "updated_at"]);

      res.json({ ok: true, cover_url, salon: updated });
    } catch (e) {
      next(e);
    }
  }
);

// =====================================================
// Salon: Branches
// =====================================================

// GET /dashboard/salon/branches
router.get("/branches", dashboardAuthRequired, requireSalon, async (req, res, next) => {
  try {
    const salon_id = req.dashboard.salon_id;
    const rows = await db("branches").where({ salon_id }).orderBy("created_at", "desc");
    res.json({ data: rows });
  } catch (e) {
    next(e);
  }
});


// POST /dashboard/salon/branches
router.post("/branches", dashboardAuthRequired, requireSalon, async (req, res, next) => {
  try {
    const salon_id = req.dashboard.salon_id;

    // ✅ هذا المكان الصحيح
    const salon = await db("salons")
      .where({ id: salon_id })
      .first("id", "salon_type");

    if (!salon) {
      return res.status(404).json({ error: "Salon not found" });
    }

    if (salon.salon_type === "home") {
      const existingCount = await db("branches")
        .where({ salon_id })
        .count("* as c")
        .first();

      if (Number(existingCount?.c || 0) >= 1) {
        return res.status(400).json({
          error: "Home service salons can only have one internal branch",
        });
      }
    }

    // 👇 بعدها يكمل الكود الطبيعي
    const body = BranchCreateSchema.parse(req.body);

    const [b] = await db("branches")
      .insert({
        salon_id,
        name: body.name,
        phone: body.phone ?? null,
        email: body.email ?? null,
        whatsapp: body.whatsapp ?? null,
        instagram: body.instagram ?? null,
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
      .returning("*");

    res.json({ branch: b });

  } catch (e) {
    next(e);
  }
});

// GET /dashboard/salon/branches/:branchId
router.get("/branches/:branchId", dashboardAuthRequired, requireSalon, async (req, res, next) => {
  try {
    const salon_id = req.dashboard.salon_id;
    const { branchId } = req.params;

    const branch = await db("branches").where({ id: branchId, salon_id }).first();
    if (!branch) return res.status(404).json({ error: "Branch not found" });

    res.json({ branch });
  } catch (e) {
    next(e);
  }
});

// PUT /dashboard/salon/branches/:branchId
router.put("/branches/:branchId", dashboardAuthRequired, requireSalon, async (req, res, next) => {
  try {
    const salon_id = req.dashboard.salon_id;
    const { branchId } = req.params;
    const patch = BranchUpdateSchema.parse(req.body);

    const exists = await db("branches").where({ id: branchId, salon_id }).first("id");
    if (!exists) return res.status(404).json({ error: "Branch not found" });

    const update = { ...patch, updated_at: db.fn.now() };
    if (patch.lat != null && patch.lng != null) update.geo = geoRaw(patch.lng, patch.lat);

    const [updated] = await db("branches").where({ id: branchId }).update(update).returning("*");
    res.json({ branch: updated });
  } catch (e) {
    next(e);
  }
});

// DELETE /dashboard/salon/branches/:branchId  (HARD delete)
router.delete("/branches/:branchId", dashboardAuthRequired, requireSalon, async (req, res, next) => {
  try {
    const salon_id = req.dashboard.salon_id;
    const { branchId } = req.params;

    // تأكيد الملكية
    const exists = await db("branches").where({ id: branchId, salon_id }).first("id");
    if (!exists) return res.status(404).json({ error: "Branch not found" });

    await db("branches").where({ id: branchId }).del(); // branch_hours ON DELETE CASCADE
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

// =====================================================
// Salon: Branch Hours
// =====================================================

// GET /dashboard/salon/branches/:branchId/hours
router.get("/branches/:branchId/hours", dashboardAuthRequired, requireSalon, async (req, res, next) => {
  try {
    const salon_id = req.dashboard.salon_id;
    const { branchId } = req.params;

    const branch = await db("branches").where({ id: branchId, salon_id }).first("id");
    if (!branch) return res.status(404).json({ error: "Branch not found" });

    const rows = await db("branch_hours").where({ branch_id: branchId }).orderBy("day_of_week", "asc");
    res.json({ data: rows });
  } catch (e) {
    next(e);
  }
});

// PUT /dashboard/salon/branches/:branchId/hours  (upsert list)
router.put("/branches/:branchId/hours", dashboardAuthRequired, requireSalon, async (req, res, next) => {
  try {
    const salon_id = req.dashboard.salon_id;
    const { branchId } = req.params;

    const branch = await db("branches").where({ id: branchId, salon_id }).first("id");
    if (!branch) return res.status(404).json({ error: "Branch not found" });

    const arr = Array.isArray(req.body) ? req.body : [];
    const items = arr.map((x) => HoursUpsertSchema.parse(x));

    await db.transaction(async (trx) => {
      for (const h of items) {
        await trx("branch_hours")
          .insert({
            branch_id: branchId,
            day_of_week: h.day_of_week,
            is_closed: h.is_closed,
            open_time: h.is_closed ? null : (h.open_time ?? null),
            close_time: h.is_closed ? null : (h.close_time ?? null),
            updated_at: trx.fn.now(),
          })
          .onConflict(["branch_id", "day_of_week"])
          .merge({
            is_closed: h.is_closed,
            open_time: h.is_closed ? null : (h.open_time ?? null),
            close_time: h.is_closed ? null : (h.close_time ?? null),
            updated_at: trx.fn.now(),
          });
      }
    });

    const rows = await db("branch_hours").where({ branch_id: branchId }).orderBy("day_of_week", "asc");
    res.json({ ok: true, data: rows });
  } catch (e) {
    next(e);
  }
});

// =====================================================
// Salon: Categories
// =====================================================

// GET /dashboard/salon/categories
router.get("/categories", dashboardAuthRequired, requireSalon, async (req, res, next) => {
  try {
    const salon_id = req.dashboard.salon_id;
    const rows = await db("service_categories").where({ salon_id }).orderBy("created_at", "desc");
    res.json({ data: rows });
  } catch (e) {
    next(e);
  }
});

// POST /dashboard/salon/categories
router.post("/categories", dashboardAuthRequired, requireSalon, async (req, res, next) => {
  try {
    const salon_id = req.dashboard.salon_id;
    const body = CategoryCreateSchema.parse(req.body);

    const [row] = await db("service_categories")
      .insert({ salon_id, name: body.name, created_at: db.fn.now(), updated_at: db.fn.now() })
      .returning("*");

    res.json({ category: row });
  } catch (e) {
    next(e);
  }
});

// GET /dashboard/salon/categories/:categoryId
router.get(
  "/categories/:categoryId",
  dashboardAuthRequired,
  requireSalon,
  async (req, res, next) => {
    try {
      const salon_id = req.dashboard.salon_id;
      const { categoryId } = req.params;

      const row = await db("service_categories")
        .where({ id: categoryId, salon_id })
        .first();

      if (!row) {
        return res.status(404).json({ error: "Category not found" });
      }

      res.json({ category: row });
    } catch (e) {
      next(e);
    }
  }
);

// PUT /dashboard/salon/categories/:categoryId
router.put("/categories/:categoryId", dashboardAuthRequired, requireSalon, async (req, res, next) => {
  try {
    const salon_id = req.dashboard.salon_id;
    const { categoryId } = req.params;
    const patch = CategoryUpdateSchema.parse(req.body);

    const [row] = await db("service_categories")
      .where({ id: categoryId, salon_id })
      .update({ ...patch, updated_at: db.fn.now() })
      .returning("*");

    if (!row) return res.status(404).json({ error: "Category not found" });
    res.json({ category: row });
  } catch (e) {
    next(e);
  }
});

// DELETE /dashboard/salon/categories/:categoryId
router.delete("/categories/:categoryId", dashboardAuthRequired, requireSalon, async (req, res, next) => {
  try {
    const salon_id = req.dashboard.salon_id;
    const { categoryId } = req.params;

    const exists = await db("service_categories")
      .where({ id: categoryId, salon_id })
      .first("id");

    if (!exists) return res.status(404).json({ error: "Category not found" });

    await db.transaction(async (trx) => {
      await trx("services")
        .where({ salon_id, category_id: categoryId })
        .update({
          category_id: null,
          updated_at: trx.fn.now(),
        });

      await trx("service_categories")
        .where({ id: categoryId, salon_id })
        .del();
    });

    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});
// =====================================================
// Salon: Services + Availability
// =====================================================

// GET /dashboard/salon/services
router.get("/services", dashboardAuthRequired, requireSalon, async (req, res, next) => {
  try {
    const salon_id = req.dashboard.salon_id;

    const rows = await db("services as s")
      .leftJoin("service_categories as c", "c.id", "s.category_id")
      .where("s.salon_id", salon_id)
      .select([
        "s.id",
        "s.name",
        "s.description",
        "s.image_url",
        "s.category_id",
        "c.name as category_name",
        "s.is_active",
        "s.created_at",
      ])
      .orderBy("s.created_at", "desc");

    res.json({ data: rows });
  } catch (e) {
    next(e);
  }
});

// POST /dashboard/salon/services
router.post("/services", dashboardAuthRequired, requireSalon, async (req, res, next) => {
  try {
    const salon_id = req.dashboard.salon_id;
    const body = ServiceCreateSchema.parse(req.body);

    const [row] = await db("services")
      .insert({
        salon_id,
        category_id: body.category_id ?? null,
        name: body.name,
        description: body.description ?? null,
        image_url: body.image_url ?? null,
        is_active: body.is_active,
        created_at: db.fn.now(),
        updated_at: db.fn.now(),
      })
      .returning("*");

    res.json({ service: row });
} catch (e) {
  if (e.code === "23505") {
    return res.status(400).json({
      error: "Service with this name already exists",
    });
  }
  next(e);
}
});

// POST /dashboard/salon/services/:serviceId/image
router.post(
  "/services/:serviceId/image",
  dashboardAuthRequired,
  requireSalon,
  serviceUpload.single("file"),
  async (req, res, next) => {
    try {
      console.log("UPLOAD HIT");
      console.log("serviceId:", req.params.serviceId);
      console.log("file:", req.file);

      const salon_id = req.dashboard.salon_id;
      const { serviceId } = req.params;

      const service = await db("services")
        .where({ id: serviceId, salon_id })
        .first("id", "image_url");

      if (!service) {
        return res.status(404).json({ error: "Service not found" });
      }

      if (!req.file) {
        return res.status(400).json({ error: "Missing file" });
      }

      const image_url = `/uploads/services/${req.file.filename}`;

      const [updated] = await db("services")
        .where({ id: serviceId, salon_id })
        .update({
          image_url,
          updated_at: db.fn.now(),
        })
        .returning([
          "id",
          "name",
          "description",
          "image_url",
          "category_id",
          "is_active",
          "updated_at",
        ]);

      return res.json({
        ok: true,
        image_url,
        service: updated,
      });
    } catch (e) {
      console.error("UPLOAD ERROR:", e);
      next(e);
    }
  }
);

// GET /dashboard/salon/services/:serviceId
router.get(
  "/services/:serviceId",
  dashboardAuthRequired,
  requireSalon,
  async (req, res, next) => {
    try {
      const salon_id = req.dashboard.salon_id;
      const { serviceId } = req.params;

      const row = await db("services as s")
        .leftJoin("service_categories as c", "c.id", "s.category_id")
        .where("s.salon_id", salon_id)
        .where("s.id", serviceId)
        .select([
          "s.id",
          "s.name",
          "s.description",
          "s.image_url",
          "s.category_id",
          "c.name as category_name",
          "s.is_active",
          "s.created_at",
        ])
        .first();

      if (!row) {
        return res.status(404).json({ error: "Service not found" });
      }

      res.json({ service: row });
    } catch (e) {
      next(e);
    }
  }
);

// PUT /dashboard/salon/services/:serviceId
router.put("/services/:serviceId", dashboardAuthRequired, requireSalon, async (req, res, next) => {
  try {
    const salon_id = req.dashboard.salon_id;
    const { serviceId } = req.params;
    const patch = ServiceUpdateSchema.parse(req.body);

    const [row] = await db("services")
      .where({ id: serviceId, salon_id })
      .update({ ...patch, updated_at: db.fn.now() })
      .returning("*");

    if (!row) return res.status(404).json({ error: "Service not found" });
    res.json({ service: row });
  } catch (e) {
    next(e);
  }
});

// DELETE /dashboard/salon/services/:serviceId
// If service has booking history, archive it instead of hard delete
router.delete("/services/:serviceId", dashboardAuthRequired, requireSalon, async (req, res, next) => {
  try {
    const salon_id = req.dashboard.salon_id;
    const { serviceId } = req.params;

    const service = await db("services")
      .where({ id: serviceId, salon_id })
      .first();

    if (!service) {
      return res.status(404).json({ error: "Service not found" });
    }

    const availabilityIds = await db("service_availability")
      .where({ service_id: serviceId })
      .pluck("id");

    let hasBookings = false;

    if (availabilityIds.length > 0) {
      const linkedBooking = await db("booking_items")
        .whereIn("service_availability_id", availabilityIds)
        .first("id");

      hasBookings = !!linkedBooking;
    }

    await db.transaction(async (trx) => {
      if (hasBookings) {
        // archive instead of delete
        await trx("service_availability")
          .where({ service_id: serviceId })
          .update({
            is_active: false,
            updated_at: trx.fn.now(),
          });

        await trx("services")
          .where({ id: serviceId, salon_id })
          .update({
            is_active: false,
            updated_at: trx.fn.now(),
          });
      } else {
        // safe hard delete if no booking history
        await trx("service_availability")
          .where({ service_id: serviceId })
          .del();

        await trx("services")
          .where({ id: serviceId, salon_id })
          .del();
      }
    });

    return res.json({
      ok: true,
      mode: hasBookings ? "archived" : "deleted",
      message: hasBookings
        ? "Service archived because it has booking history"
        : "Service deleted successfully",
    });
  } catch (e) {
    next(e);
  }
});

// GET /dashboard/salon/services/:serviceId/availability
router.get("/services/:serviceId/availability", dashboardAuthRequired, requireSalon, async (req, res, next) => {
  try {
    const salon_id = req.dashboard.salon_id;
    const { serviceId } = req.params;

    const svc = await db("services").where({ id: serviceId, salon_id }).first("id");
    if (!svc) return res.status(404).json({ error: "Service not found" });

    const rows = await db("service_availability as sa")
      .join("branches as b", "b.id", "sa.branch_id")
      .where("sa.service_id", serviceId)
      .andWhere("b.salon_id", salon_id)
      .select([
        "sa.id",
        "sa.branch_id",
        "b.name as branch_name",
        "sa.mode",
        "sa.duration_mins",
        "sa.price_aed",
        "sa.travel_fee_aed",
        "sa.is_active",
      ])
      .orderBy("b.created_at", "desc");

    res.json({ data: rows });
  } catch (e) {
    next(e);
  }
});

// PUT /dashboard/salon/branches/:branchId/services/:serviceId/availability
router.put("/branches/:branchId/services/:serviceId/availability", dashboardAuthRequired, requireSalon, async (req, res, next) => {
  try {
    const salon_id = req.dashboard.salon_id;
    const { branchId, serviceId } = req.params;
    const body = AvailabilityUpsertSchema.parse(req.body);

    // تأكد الفرع + الخدمة تابعين لنفس الصالون
    const branch = await db("branches").where({ id: branchId, salon_id }).first("id");
    if (!branch) return res.status(404).json({ error: "Branch not found" });

    const svc = await db("services").where({ id: serviceId, salon_id }).first("id");
    if (!svc) return res.status(404).json({ error: "Service not found" });

    const [row] = await db("service_availability")
      .insert({
        branch_id: branchId,
        service_id: serviceId,
        mode: body.mode,
        duration_mins: body.duration_mins,
        price_aed: body.price_aed,
        travel_fee_aed: body.travel_fee_aed ?? 0,
        is_active: body.is_active,
        created_at: db.fn.now(),
        updated_at: db.fn.now(),
      })
      .onConflict(["branch_id", "service_id", "mode"])
      .merge({
        duration_mins: body.duration_mins,
        price_aed: body.price_aed,
        travel_fee_aed: body.travel_fee_aed ?? 0,
        is_active: body.is_active,
        updated_at: db.fn.now(),
      })
      .returning("*");

    res.json({ availability: row });
  } catch (e) {
    next(e);
  }
});

// =====================================================
// Salon: Stats
// =====================================================

// GET /dashboard/salon/stats
router.get("/stats", dashboardAuthRequired, requireSalon, async (req, res, next) => {
  try {
    const salon_id = req.dashboard.salon_id;

    // Total bookings for this salon
    const [{ total_bookings }] = await db("bookings")
      .where({ salon_id })
      .count("* as total_bookings");

    // Active bookings (pending + confirmed)
    const [{ active_bookings }] = await db("bookings")
      .where({ salon_id })
      .whereIn("status", ["pending", "confirmed"])
      .count("* as active_bookings");

    // Completed bookings
    const [{ completed_bookings }] = await db("bookings")
      .where({ salon_id, status: "completed" })
      .count("* as completed_bookings");

    // Pending bookings
    const [{ pending_bookings }] = await db("bookings")
      .where({ salon_id, status: "pending" })
      .count("* as pending_bookings");

    // Today's bookings
    const [{ today_bookings }] = await db("bookings")
      .where({ salon_id })
      .whereRaw("DATE(scheduled_at) = CURRENT_DATE")
      .count("* as today_bookings");

    // Total revenue (completed bookings only)
    const [{ total_revenue }] = await db("bookings")
      .where({ salon_id, status: "completed" })
      .sum("total_aed as total_revenue");

    // This month's revenue (completed bookings)
    const [{ this_month_revenue }] = await db("bookings")
      .where({ salon_id, status: "completed" })
      .whereRaw("DATE_TRUNC('month', scheduled_at) = DATE_TRUNC('month', CURRENT_DATE)")
      .sum("total_aed as this_month_revenue");

    res.json({
      total_bookings: Number(total_bookings || 0),
      active_bookings: Number(active_bookings || 0),
      completed_bookings: Number(completed_bookings || 0),
      pending_bookings: Number(pending_bookings || 0),
      today_bookings: Number(today_bookings || 0),
      total_revenue: Number(total_revenue || 0),
      this_month_revenue: Number(this_month_revenue || 0),
    });
  } catch (e) {
    next(e);
  }
});

// =====================================================
// Salon: Bookings
// =====================================================

// GET /dashboard/salon/bookings
router.get("/bookings", dashboardAuthRequired, requireSalon, async (req, res, next) => {
  try {
    const salon_id = req.dashboard.salon_id;

    const rows = await db("bookings as b")
      .leftJoin("branches as br", "br.id", "b.branch_id")
      .leftJoin("users as u", "u.id", "b.user_id")
      .where("b.salon_id", salon_id)
      .select([
        "b.id",
        "b.status",
        "b.total_aed",
        "b.subtotal_aed",
        "b.fees_aed",
        "b.scheduled_at",
        "b.created_at",
        "b.updated_at",
        "b.mode",
        "br.name as branch_name",
        "u.name as customer_name",
        "u.phone as customer_phone",
      ])
      .orderBy("b.scheduled_at", "desc");

    res.json({ data: rows });
  } catch (e) {
    next(e);
  }
});

// GET /dashboard/salon/bookings/:bookingId
router.get("/bookings/:bookingId", dashboardAuthRequired, requireSalon, async (req, res, next) => {
  try {
    const salon_id = req.dashboard.salon_id;
    const { bookingId } = req.params;

    const booking = await db("bookings as b")
      .leftJoin("branches as br", "br.id", "b.branch_id")
      .leftJoin("users as u", "u.id", "b.user_id")
      .where("b.id", bookingId)
      .andWhere("b.salon_id", salon_id)
      .select([
        "b.id",
        "b.status",
        "b.total_aed",
        "b.subtotal_aed",
        "b.fees_aed",
        "b.scheduled_at",
        "b.created_at",
        "b.updated_at",
        "b.mode",
        "b.customer_note",
        "br.name as branch_name",
        "u.name as user_name",
        "u.phone as user_phone",
      ])
      .first();

    if (!booking) {
      return res.status(404).json({ error: "Booking not found" });
    }

    const items = await db("booking_items as bi")
      .where("bi.booking_id", bookingId)
      .select([
        "bi.id",
        "bi.service_name",
        "bi.unit_price_aed",
        "bi.duration_mins",
        "bi.qty",
      ]);

    res.json({
      booking,
      items: items.map((item) => ({
        ...item,
        unit_price_aed: Number(item.unit_price_aed || 0),
        duration_mins: Number(item.duration_mins || 0),
        qty: Number(item.qty || 1),
        staff_name: null,
      })),
    });
  } catch (e) {
    next(e);
  }
});

// PUT /dashboard/salon/bookings/:bookingId/status
router.put("/bookings/:bookingId/status", dashboardAuthRequired, requireSalon, async (req, res, next) => {
  try {
    const salon_id = req.dashboard.salon_id;
    const { bookingId } = req.params;
    const { status } = req.body;

    const allowed = ["pending", "confirmed", "completed", "cancelled", "no_show"];

    if (!allowed.includes(status)) {
      return res.status(400).json({ error: "Invalid status" });
    }

    const booking = await db("bookings")
      .where({ id: bookingId, salon_id })
      .first(["id", "status"]);

    if (!booking) {
      return res.status(404).json({ error: "Booking not found" });
    }

    // 🔥🔥🔥 أهم جزء
    if (status === "completed") {
      const result = await completeBooking(bookingId);

      return res.json({
        ok: true,
        type: "completed",
        ...result,
      });
    }

    // باقي الحالات عادي
    const [row] = await db("bookings")
      .where({ id: bookingId, salon_id })
      .update({
        status,
        updated_at: db.fn.now(),
      })
      .returning("*");

    res.json({ booking: row });

  } catch (e) {
    next(e);
  }
});

// PUT /dashboard/salon/bookings/:bookingId/cancel
router.put("/bookings/:bookingId/cancel", dashboardAuthRequired, requireSalon, async (req, res, next) => {
  try {
    const salon_id = req.dashboard.salon_id;
    const { bookingId } = req.params;

    const booking = await db("bookings")
      .where({ id: bookingId, salon_id })
      .first(["id", "status"]);

    if (!booking) {
      return res.status(404).json({ error: "Booking not found" });
    }

    if (booking.status === "completed") {
      return res.status(400).json({ error: "Completed booking cannot be cancelled" });
    }

    if (booking.status === "cancelled") {
      return res.status(400).json({ error: "Booking already cancelled" });
    }

    const [row] = await db("bookings")
      .where({ id: bookingId, salon_id })
      .update({
        status: "cancelled",
        updated_at: db.fn.now(),
      })
      .returning("*");

    res.json({ booking: row });
  } catch (e) {
    next(e);
  }
});

// =====================================================
// Salon: Reviews
// =====================================================

// GET /dashboard/salon/reviews
router.get("/reviews", dashboardAuthRequired, requireSalon, async (req, res, next) => {
  try {
    const salon_id = req.dashboard.salon_id;
    const { rating, branch_id } = req.query;

    let query = db("booking_ratings as r")
      .leftJoin("users as u", "u.id", "r.user_id")
      .leftJoin("branches as br", "br.id", "r.branch_id")
      .where("r.salon_id", salon_id)
      .select([
        "r.id",
        "r.booking_id",
        "r.rating",
        "r.comment",
        "r.created_at",
        "u.name as user_name",
        "u.phone as user_phone",
        "br.id as branch_id",
        "br.name as branch_name",
      ])
      .orderBy("r.created_at", "desc");

    if (rating && rating !== "all") {
      query = query.where("r.rating", Number(rating));
    }

    if (branch_id && branch_id !== "all") {
      query = query.where("r.branch_id", branch_id);
    }

    const rows = await query;

    res.json({ data: rows });
  } catch (e) {
    next(e);
  }
});

// GET /dashboard/salon/reviews/stats
router.get("/reviews/stats", dashboardAuthRequired, requireSalon, async (req, res, next) => {
  try {
    const salon_id = req.dashboard.salon_id;

    const [{ total_reviews }] = await db("booking_ratings")
      .where({ salon_id })
      .count("* as total_reviews");

    const [{ avg_rating }] = await db("booking_ratings")
      .where({ salon_id })
      .avg("rating as avg_rating");

    const [{ five_star }] = await db("booking_ratings")
      .where({ salon_id, rating: 5 })
      .count("* as five_star");

    const [{ four_star }] = await db("booking_ratings")
      .where({ salon_id, rating: 4 })
      .count("* as four_star");

    const [{ three_star }] = await db("booking_ratings")
      .where({ salon_id, rating: 3 })
      .count("* as three_star");

    const [{ two_star }] = await db("booking_ratings")
      .where({ salon_id, rating: 2 })
      .count("* as two_star");

    const [{ one_star }] = await db("booking_ratings")
      .where({ salon_id, rating: 1 })
      .count("* as one_star");

    res.json({
      total_reviews: Number(total_reviews || 0),
      avg_rating: Number(avg_rating || 0),
      breakdown: {
        5: Number(five_star || 0),
        4: Number(four_star || 0),
        3: Number(three_star || 0),
        2: Number(two_star || 0),
        1: Number(one_star || 0),
      },
    });
  } catch (e) {
    next(e);
  }
});

router.use("/blocked-slots", require("./blockedTimeSlots"));  // ← Here! ✅

module.exports = router;