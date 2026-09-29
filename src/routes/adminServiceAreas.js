// src/routes/adminServiceAreas.js
// Mounted in dashboardAdmin.js with:  router.use(require("./adminServiceAreas"));
//
//   GET    /dashboard/admin/service-areas
//   POST   /dashboard/admin/service-areas
//   PUT    /dashboard/admin/service-areas/:id
//   DELETE /dashboard/admin/service-areas/:id
//   GET    /dashboard/admin/branches/:branchId/home-zones
//   PUT    /dashboard/admin/branches/:branchId/home-zones   (replaces the whole list)

const router = require("express").Router();
const { z } = require("zod");
const db = require("../db/knex");

function requireAdmin(req, res, next) {
  if (req.dashboard?.role !== "admin") return res.status(403).json({ error: "Admin only" });
  next();
}

const EMIRATES = [
  "Abu Dhabi",
  "Dubai",
  "Sharjah",
  "Ajman",
  "Umm Al Quwain",
  "Ras Al Khaimah",
  "Fujairah",
];

const AreaSchema = z.object({
  name_en: z.string().trim().min(2).max(80),
  name_ar: z.string().trim().max(80).nullable().optional(),
  emirate: z.enum(EMIRATES),
  lat: z.coerce.number().min(22).max(27),
  lng: z.coerce.number().min(51).max(57),
  radius_km: z.coerce.number().positive().max(200),
  is_active: z.coerce.boolean().optional(),
});

function centerRaw(lng, lat) {
  return db.raw("ST_SetSRID(ST_MakePoint(?, ?), 4326)::geography", [lng, lat]);
}

// ---------- Areas ----------

router.get("/service-areas", requireAdmin, async (req, res, next) => {
  try {
    const rows = await db("service_areas as a")
      .select(
        "a.id",
        "a.name_en",
        "a.name_ar",
        "a.emirate",
        "a.lat",
        "a.lng",
        "a.radius_km",
        "a.is_active",
        db.raw(
          "(SELECT COUNT(DISTINCT z.branch_id) FROM branch_home_zones z WHERE z.area_id = a.id AND z.is_active)::int AS branches_count"
        )
      )
      .orderBy([{ column: "a.emirate" }, { column: "a.name_en" }]);

    res.json({
      data: rows.map((r) => ({
        ...r,
        lat: Number(r.lat),
        lng: Number(r.lng),
        radius_km: Number(r.radius_km),
      })),
      emirates: EMIRATES,
    });
  } catch (e) {
    next(e);
  }
});

router.post("/service-areas", requireAdmin, async (req, res, next) => {
  try {
    const body = AreaSchema.parse(req.body);

    const [row] = await db("service_areas")
      .insert({
        name_en: body.name_en,
        name_ar: body.name_ar || null,
        emirate: body.emirate,
        lat: body.lat,
        lng: body.lng,
        center: centerRaw(body.lng, body.lat),
        radius_km: body.radius_km,
        is_active: body.is_active ?? true,
      })
      .returning(["id", "name_en", "name_ar", "emirate", "lat", "lng", "radius_km", "is_active"]);

    res.json({ area: row });
  } catch (e) {
    if (e?.code === "23505") {
      return res.status(409).json({ error: "An area with this name already exists in this emirate." });
    }
    next(e);
  }
});

router.put("/service-areas/:id", requireAdmin, async (req, res, next) => {
  try {
    const patch = AreaSchema.partial().parse(req.body);
    const update = { ...patch, updated_at: db.fn.now() };

    if (patch.lat != null || patch.lng != null) {
      const current = await db("service_areas").where({ id: req.params.id }).first("lat", "lng");
      if (!current) return res.status(404).json({ error: "Area not found" });
      const lat = patch.lat ?? Number(current.lat);
      const lng = patch.lng ?? Number(current.lng);
      update.center = centerRaw(lng, lat);
    }

    const [row] = await db("service_areas")
      .where({ id: req.params.id })
      .update(update)
      .returning(["id", "name_en", "name_ar", "emirate", "lat", "lng", "radius_km", "is_active"]);

    if (!row) return res.status(404).json({ error: "Area not found" });
    res.json({ area: row });
  } catch (e) {
    if (e?.code === "23505") {
      return res.status(409).json({ error: "An area with this name already exists in this emirate." });
    }
    next(e);
  }
});

router.delete("/service-areas/:id", requireAdmin, async (req, res, next) => {
  try {
    const used = await db("branch_home_zones").where({ area_id: req.params.id }).first("id");
    if (used) {
      return res.status(409).json({
        error: "Salons cover this area, so it can't be deleted. Turn it off instead.",
      });
    }

    const n = await db("service_areas").where({ id: req.params.id }).del();
    if (!n) return res.status(404).json({ error: "Area not found" });
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

// ---------- A branch's home zones ----------

const ZonesSchema = z.object({
  zones: z
    .array(
      z.object({
        area_id: z.string().uuid(),
        days: z.array(z.number().int().min(0).max(6)).min(1).max(7).nullable().optional(),
        min_order_aed: z.coerce.number().min(0).max(100000).nullable().optional(),
        visit_fee_aed: z.coerce.number().min(0).max(10000).nullable().optional(),
      })
    )
    .max(100),
});

async function loadZones(branchId) {
  const rows = await db("branch_home_zones as z")
    .join("service_areas as a", "a.id", "z.area_id")
    .where("z.branch_id", branchId)
    .select([
      "z.id",
      "z.area_id",
      "z.days",
      "z.min_order_aed",
      "z.visit_fee_aed",
      "z.is_active",
      "a.name_en",
      "a.name_ar",
      "a.emirate",
    ])
    .orderBy("a.name_en");

  return rows.map((r) => ({
    ...r,
    days: r.days ? r.days.map(Number) : null,
    min_order_aed: r.min_order_aed == null ? null : Number(r.min_order_aed),
    visit_fee_aed: r.visit_fee_aed == null ? null : Number(r.visit_fee_aed),
  }));
}

router.get("/branches/:branchId/home-zones", requireAdmin, async (req, res, next) => {
  try {
    res.json({ data: await loadZones(req.params.branchId) });
  } catch (e) {
    next(e);
  }
});

router.put("/branches/:branchId/home-zones", requireAdmin, async (req, res, next) => {
  try {
    const { zones } = ZonesSchema.parse(req.body);
    const branchId = req.params.branchId;

    const branch = await db("branches").where({ id: branchId }).first("id", "supports_home_services");
    if (!branch) return res.status(404).json({ error: "Branch not found" });
    if (!branch.supports_home_services && zones.length) {
      return res.status(400).json({ error: "Turn on home service for this location first." });
    }

    const areaIds = [...new Set(zones.map((z) => z.area_id))];
    if (areaIds.length !== zones.length) {
      return res.status(400).json({ error: "Each area can only be added once." });
    }

    await db.transaction(async (trx) => {
      await trx("branch_home_zones").where({ branch_id: branchId }).del();

      if (zones.length) {
        await trx("branch_home_zones").insert(
          zones.map((z) => ({
            branch_id: branchId,
            area_id: z.area_id,
            // 7 selected days is the same as every day.
            days: z.days && z.days.length < 7 ? [...new Set(z.days)].sort() : null,
            min_order_aed: z.min_order_aed ?? null,
            visit_fee_aed: z.visit_fee_aed ?? null,
          }))
        );
      }
    });

    res.json({ data: await loadZones(branchId) });
  } catch (e) {
    if (e?.code === "23503") {
      return res.status(400).json({ error: "One of the areas doesn't exist." });
    }
    next(e);
  }
});

module.exports = router;