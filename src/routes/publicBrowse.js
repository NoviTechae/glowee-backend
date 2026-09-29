// src/routes/publicBrowse.js
const router = require("express").Router();
const db = require("../db/knex");
const { whereBranchCoversPoint } = require("../utils/homeCoverage");

// GET /browse/branches?type=salon|home&lat=24.45&lng=54.37&city=...&area=...
//
// Salon tab: branches customers can visit, with their address.
// Home tab:  branches that travel to customers. When lat/lng are sent, only the
//            ones whose area covers the customer, and no branch address is shown.
router.get("/branches", async (req, res, next) => {
  try {
    const type = req.query.type === "home" ? "home" : "salon";
    const mode = type === "home" ? "home" : "in_salon";
    const city = req.query.city?.toString();
    const area = req.query.area?.toString();

    const lat = Number(req.query.lat);
    const lng = Number(req.query.lng);
    const hasPoint =
      Number.isFinite(lat) && Number.isFinite(lng) && !(lat === 0 && lng === 0);

    const point = hasPoint
      ? db.raw("ST_SetSRID(ST_MakePoint(?, ?), 4326)::geography", [lng, lat])
      : null;

    // Day and time in the UAE, not the database server's timezone.
    const dubaiNow = "(NOW() AT TIME ZONE 'Asia/Dubai')";

    const q = db("branches as b")
      .join("salons as s", "s.id", "b.salon_id")
      .leftJoin("branch_hours as bh", function () {
        this.on("bh.branch_id", "b.id").andOn(
          "bh.day_of_week",
          "=",
          db.raw(`EXTRACT(DOW FROM ${dubaiNow})::int`)
        );
      })
      .leftJoin("booking_ratings as r", "r.branch_id", "b.id")
      .where("b.is_active", true)
      .andWhere("s.is_active", true)
      // Only show branches that actually have bookable services for this tab.
      .whereExists(function () {
        this.select(db.raw("1"))
          .from("service_availability as sa")
          .join("services as sv", "sv.id", "sa.service_id")
          .whereRaw("sa.branch_id = b.id")
          .andWhere("sa.mode", mode)
          .andWhere("sa.is_active", true)
          .andWhere("sv.is_active", true);
      })
      .select([
        "b.id as branch_id",
        "b.name as branch_name",
        "b.city",
        "b.area",
        "b.supports_home_services",
        "b.offers_in_salon",
        "b.home_radius_km",
        "b.home_min_order_aed",
        "b.home_min_order_aed",

        db.raw(`COALESCE(AVG(r.rating), 0)::decimal(3,2) as rating`),
        db.raw(`COUNT(r.id)::int as reviews_count`),

        "s.id as salon_id",
        "s.name as salon_name",
        "s.logo_url",
        "s.cover_url",
        "s.phone",
        "s.instagram",
        "s.is_featured",
        "s.discount_percent",
        "s.double_stamps",

        "bh.is_closed as today_is_closed",
        "bh.open_time as today_open_time",
        "bh.close_time as today_close_time",
        db.raw(`
          CASE
            WHEN bh.branch_id IS NULL THEN NULL
            WHEN bh.is_closed = true THEN false
            WHEN bh.open_time IS NULL OR bh.close_time IS NULL THEN false
            WHEN (${dubaiNow}::time >= bh.open_time AND ${dubaiNow}::time < bh.close_time) THEN true
            ELSE false
          END as is_open_now
        `),
      ])
      .groupBy("b.id", "s.id", "bh.branch_id");

    if (type === "salon") {
      q.andWhere("b.offers_in_salon", true).select([
        "b.address_line",
        "b.lat",
        "b.lng",
      ]);
    } else {
      q.andWhere("b.supports_home_services", true);

      // The starting point of a home-only business is private.
      q.select([
        db.raw("CASE WHEN b.offers_in_salon THEN b.address_line ELSE NULL END as address_line"),
        "b.lat",
        "b.lng",
      ]);

      if (hasPoint) {
        // The address the service is for (not necessarily where the customer is now).
        whereBranchCoversPoint(q, db, lng, lat);

        // The area rules that apply to this address, so the app can show days and minimums.
        const p = "ST_SetSRID(ST_MakePoint(?, ?), 4326)::geography";
        q.select(
          db.raw(
            `(
              SELECT json_agg(json_build_object(
                'area', a.name_en,
                'area_ar', a.name_ar,
                'days', z.days,
                'min_order_aed', z.min_order_aed,
                'visit_fee_aed', z.visit_fee_aed
              ))
              FROM branch_home_zones z
              JOIN service_areas a ON a.id = z.area_id
              WHERE z.branch_id = b.id AND z.is_active AND a.is_active
                AND CASE WHEN a.boundary IS NOT NULL
                  THEN ST_Covers(a.boundary, ${p})
                  ELSE ST_DWithin(a.center, ${p}, a.radius_km * 1000)
                END
            ) AS matched_zones`,
            [lng, lat, lng, lat]
          )
        );
      }
    }

    if (hasPoint) {
      q.select(db.raw("ROUND((ST_Distance(b.geo, ?) / 1000)::numeric, 1) as distance_km", [point]));
      q.orderByRaw("ST_Distance(b.geo, ?) ASC", [point]);
    }

    if (city) q.andWhere("b.city", city);
    if (area) q.andWhere("b.area", area);

    const rows = await q;

    res.json({
      data: rows.map(({ matched_zones, ...r }) => ({
        ...r,
        ...summariseZones(matched_zones, r.home_min_order_aed),
        distance_km: r.distance_km == null ? null : Number(r.distance_km),
        home_radius_km: r.home_radius_km == null ? null : Number(r.home_radius_km),
        home_min_order_aed:
          r.home_min_order_aed == null ? null : Number(r.home_min_order_aed),
        home_min_order_aed:
          r.home_min_order_aed == null ? null : Number(r.home_min_order_aed),
      })),
      meta: { type, coverage_checked: type === "home" && hasPoint },
    });
  } catch (e) {
    next(e);
  }
});

// Days and minimum order that apply to the chosen address.
// service_days: null means every day (or no area rules for this address).
function summariseZones(zones, branchMin) {
  if (!zones || !zones.length) return { service_days: null, service_areas: [] };

  const everyDay = zones.some((z) => !z.days);
  const days = everyDay ? null : [...new Set(zones.flatMap((z) => z.days))].sort();

  const mins = zones.map((z) => z.min_order_aed);
  const fees = zones.map((z) => z.visit_fee_aed);

  return {
    service_days: days,
    service_areas: [...new Set(zones.map((z) => z.area))],
    home_min_order_aed: mins.every((m) => m != null)
      ? Math.min(...mins.map(Number))
      : branchMin == null
      ? null
      : Number(branchMin),
    area_visit_fee_aed: fees.every((f) => f != null) ? Math.min(...fees.map(Number)) : null,
  };
}

module.exports = router;