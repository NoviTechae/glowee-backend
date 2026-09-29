// src/routes/salonHomeZones.js
// The salon's own view of home-service areas.
// Mounted in dashboardSalon.js with:  router.use(require("./salonHomeZones"));
//
//   GET /dashboard/salon/service-areas                     areas the salon can choose from
//   GET /dashboard/salon/branches/:branchId/home-zones
//   PUT /dashboard/salon/branches/:branchId/home-zones      (replaces the whole list)

const router = require("express").Router();
const { z } = require("zod");
const db = require("../db/knex");
const dashboardAuthRequired = require("../middleware/dashboardAuthRequired");

function requireSalon(req, res, next) {
  if (req.dashboard?.role !== "salon") return res.status(403).json({ error: "Salon only" });
  if (!req.dashboard?.salon_id) return res.status(401).json({ error: "Missing salon_id" });
  next();
}

router.use(dashboardAuthRequired, requireSalon);

router.get("/service-areas", async (req, res, next) => {
  try {
    const rows = await db("service_areas")
      .where({ is_active: true })
      .select(["id", "name_en", "name_ar", "emirate"])
      .orderBy([{ column: "emirate" }, { column: "name_en" }]);
    res.json({ data: rows });
  } catch (e) {
    next(e);
  }
});

async function ownBranch(req) {
  return db("branches")
    .where({ id: req.params.branchId, salon_id: req.dashboard.salon_id })
    .first("id", "supports_home_services");
}

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

router.get("/branches/:branchId/home-zones", async (req, res, next) => {
  try {
    const branch = await ownBranch(req);
    if (!branch) return res.status(404).json({ error: "Branch not found" });
    res.json({ data: await loadZones(branch.id) });
  } catch (e) {
    next(e);
  }
});

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

router.put("/branches/:branchId/home-zones", async (req, res, next) => {
  try {
    const { zones } = ZonesSchema.parse(req.body);

    const branch = await ownBranch(req);
    if (!branch) return res.status(404).json({ error: "Branch not found" });
    if (!branch.supports_home_services && zones.length) {
      return res.status(400).json({ error: "Turn on home service for this location first." });
    }

    const areaIds = [...new Set(zones.map((z) => z.area_id))];
    if (areaIds.length !== zones.length) {
      return res.status(400).json({ error: "Each area can only be added once." });
    }

    if (areaIds.length) {
      const found = await db("service_areas").whereIn("id", areaIds).andWhere({ is_active: true }).pluck("id");
      if (found.length !== areaIds.length) {
        return res.status(400).json({ error: "One of the areas isn't available." });
      }
    }

    await db.transaction(async (trx) => {
      await trx("branch_home_zones").where({ branch_id: branch.id }).del();
      if (zones.length) {
        await trx("branch_home_zones").insert(
          zones.map((z) => ({
            branch_id: branch.id,
            area_id: z.area_id,
            days: z.days && z.days.length < 7 ? [...new Set(z.days)].sort() : null,
            min_order_aed: z.min_order_aed ?? null,
            visit_fee_aed: z.visit_fee_aed ?? null,
          }))
        );
      }
    });

    res.json({ data: await loadZones(branch.id) });
  } catch (e) {
    next(e);
  }
});

module.exports = router;