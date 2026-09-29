// src/utils/homeCoverage.js
// Does a branch's home service reach an address, and on which days?
//
// A branch that has home zones covers the areas in those zones.
// A branch without zones falls back to its home_radius_km circle.

// SQL that is true when area "a" contains the point bound as ?.
const AREA_CONTAINS = `
  CASE WHEN a.boundary IS NOT NULL
    THEN ST_Covers(a.boundary, %P)
    ELSE ST_DWithin(a.center, %P, a.radius_km * 1000)
  END`;

function pointSql(db, lng, lat) {
  return db.raw("ST_SetSRID(ST_MakePoint(?, ?), 4326)::geography", [lng, lat]);
}

// For list queries on branches aliased "b": true when b covers the point.
function whereBranchCoversPoint(qb, db, lng, lat) {
  const p = "ST_SetSRID(ST_MakePoint(?, ?), 4326)::geography";
  qb.whereRaw(
    `(
      EXISTS (
        SELECT 1 FROM branch_home_zones z
        JOIN service_areas a ON a.id = z.area_id
        WHERE z.branch_id = b.id AND z.is_active AND a.is_active
          AND ${AREA_CONTAINS.replaceAll("%P", p)}
      )
      OR (
        NOT EXISTS (SELECT 1 FROM branch_home_zones z2 WHERE z2.branch_id = b.id AND z2.is_active)
        AND b.home_radius_km IS NOT NULL
        AND ST_DWithin(b.geo, ${p}, b.home_radius_km * 1000)
      )
    )`,
    [lng, lat, lng, lat, lng, lat]
  );
}

// Full answer for one branch and one address.
// Returns { covered, days: number[] | null (null = every day), zones: [...] }
async function coverageForPoint(db, branchId, lng, lat) {
  const p = "ST_SetSRID(ST_MakePoint(?, ?), 4326)::geography";

  const zones = await db("branch_home_zones as z")
    .join("service_areas as a", "a.id", "z.area_id")
    .where("z.branch_id", branchId)
    .andWhere("z.is_active", true)
    .andWhere("a.is_active", true)
    .whereRaw(AREA_CONTAINS.replaceAll("%P", p), [lng, lat, lng, lat])
    .select([
      "z.id",
      "z.days",
      "z.min_order_aed",
      "z.visit_fee_aed",
      "a.name_en",
      "a.name_ar",
    ]);

  if (zones.length) {
    const everyDay = zones.some((z) => !z.days);
    const days = everyDay
      ? null
      : [...new Set(zones.flatMap((z) => z.days.map(Number)))].sort();
    return { covered: true, days, zones, usesZones: true };
  }

  const hasZones = await db("branch_home_zones")
    .where({ branch_id: branchId, is_active: true })
    .first("id");

  if (hasZones) return { covered: false, days: [], zones: [], usesZones: true };

  const inRadius = await db("branches")
    .where({ id: branchId })
    .whereNotNull("home_radius_km")
    .whereRaw(`ST_DWithin(geo, ${p}, home_radius_km * 1000)`, [lng, lat])
    .first("id");

  return { covered: !!inRadius, days: null, zones: [], usesZones: false };
}

// The zone rules that apply on a given day (0 = Sunday). When several areas
// match, the customer gets the most favourable minimum order and visit fee.
function rulesForDay(coverage, day) {
  const zones = coverage.zones.filter((z) => !z.days || z.days.map(Number).includes(day));
  if (coverage.usesZones && zones.length === 0) return { allowed: false };

  const mins = zones.map((z) => z.min_order_aed).filter((v) => v != null).map(Number);
  const fees = zones.map((z) => z.visit_fee_aed).filter((v) => v != null).map(Number);

  return {
    allowed: true,
    // A zone without its own minimum means "no area-specific minimum".
    minOrder: zones.length && mins.length === zones.length ? Math.min(...mins) : null,
    visitFee: zones.length && fees.length === zones.length ? Math.min(...fees) : null,
  };
}

module.exports = { pointSql, whereBranchCoversPoint, coverageForPoint, rulesForDay };