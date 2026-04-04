// src/controllers/salonController.js
const knex = require("../db/knex");

/**
 * Helpers
 */
function parseIntSafe(v, fallback) {
  const n = parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function toBool(v) {
  if (typeof v === "boolean") return v;
  const s = String(v ?? "").toLowerCase();
  return s === "true" || s === "1" || s === "yes";
}

// Postgres: 0 Sunday ... 6 Saturday
const dowRaw = knex.raw("EXTRACT(DOW FROM timezone('Asia/Dubai', now()))::int");

// Computed open_now from today's branch_hours
function openNowSql() {
  return knex.raw(`
    CASE
      WHEN bh.branch_id IS NULL THEN NULL
      WHEN bh.is_closed = true THEN false
      WHEN bh.open_time IS NULL OR bh.close_time IS NULL THEN NULL
      WHEN (bh.close_time::time < bh.open_time::time) THEN
        (timezone('Asia/Dubai', now())::time >= bh.open_time::time 
         OR timezone('Asia/Dubai', now())::time < bh.close_time::time)
      ELSE
        (timezone('Asia/Dubai', now())::time >= bh.open_time::time 
         AND timezone('Asia/Dubai', now())::time < bh.close_time::time)
    END as open_now
  `);
}

function makeHomeBranch(salon) {
  return {
    id: `home-${salon.id}`,
    salon_id: salon.id,
    name: salon.name,
    city: null,
    area: null,
    address_line: null,
    lat: null,
    lng: null,
    supports_home_services: true,
    rating: null,
    reviews_count: null,
    today_is_closed: null,
    today_open_time: null,
    today_close_time: null,
    open_now: null,
    branch_hours: [],
  };
}

/**
 * GET /salons
 * Returns paginated salons + branches_count
 * Optionally filters by city and type
 */
exports.getSalons = async (req, res, next) => {
  try {
    const page = parseIntSafe(req.query.page, 1);
    const limit = parseIntSafe(req.query.limit, 10);
    const offset = (page - 1) * limit;

    const city = req.query.city?.toString();
    const type = (req.query.type || "all").toString();
    // type: all | in_salon | home | both

    let salonsQ = knex("salons as s")
      .leftJoin("branches as b", function () {
        this.on("b.salon_id", "s.id").andOn("b.is_active", "=", knex.raw("true"));
      })
      .where("s.is_active", true)
      .groupBy("s.id")
      .select(
        "s.id",
        "s.name",
        "s.salon_type",
        "s.logo_url",
        "s.cover_url",
        "s.about",
        "s.is_featured",
        "s.discount_percent",
        "s.double_stamps",
        // ✅ home نخليه 1 حتى UI يكون منطقي
        knex.raw(`CASE WHEN s.salon_type = 'home' THEN 1 ELSE COUNT(b.id) END as branches_count`)
      );

    if (type === "home") salonsQ = salonsQ.andWhere("s.salon_type", "home");
    else if (type === "in_salon") salonsQ = salonsQ.andWhere("s.salon_type", "in_salon");
    else if (type === "both") salonsQ = salonsQ.andWhere("s.salon_type", "both");

    // فلاتر اختيارية
    const featured = req.query.featured?.toString();
    const doubleStamps = req.query.double_stamps?.toString();
    const hasDiscount = req.query.has_discount?.toString();

    if (featured === "true") salonsQ = salonsQ.andWhere("s.is_featured", true);
    if (doubleStamps === "true") salonsQ = salonsQ.andWhere("s.double_stamps", true);
    if (hasDiscount === "true") salonsQ = salonsQ.andWhereNotNull("s.discount_percent").andWhere("s.discount_percent", ">", 0);

    if (city) {
      salonsQ = salonsQ.andWhere(function () {
        this.where("s.salon_type", "home").orWhere("b.city", city);
      });
    }

    const salons = await salonsQ.limit(limit).offset(offset).orderBy("s.created_at", "desc");

    const salonIds = salons.map((s) => s.id);

    if (salonIds.length === 0) {
      return res.json({ page, limit, data: [] });
    }

    // ✅ نجيب فروع فقط للصالونات اللي مو home
    const notHomeSalonIds = salons.filter((s) => s.salon_type !== "home").map((s) => s.id);

    const branches = notHomeSalonIds.length
      ? await knex("branches as b")
          .join("salons as s", "s.id", "b.salon_id")
          .leftJoin("branch_hours as bh", function () {
            this.on("bh.branch_id", "b.id").andOn("bh.day_of_week", "=", dowRaw);
          })
          .whereIn("b.salon_id", notHomeSalonIds)
          .andWhere("b.is_active", true)
          .andWhere("s.is_active", true)
          .select([
            "b.id",
            "b.salon_id",
            "b.name",
            "b.city",
            "b.area",
            "b.address_line",
            "b.lat",
            "b.lng",
            "b.supports_home_services",
            "b.rating",
            "b.reviews_count",
            "bh.is_closed as today_is_closed",
            "bh.open_time as today_open_time",
            "bh.close_time as today_close_time",
            openNowSql(),
          ])
          .orderBy("b.created_at", "desc")
      : [];

    const services = await knex("services as srv")
      .leftJoin("service_categories as cat", "srv.category_id", "cat.id")
      .whereIn("srv.salon_id", salonIds)
      .andWhere("srv.is_active", true)
      .select(
        "srv.id",
        "srv.salon_id",
        "srv.name",
        "srv.description",
        "srv.image_url",
        "cat.id as category_id",
        "cat.name as category_name"
      );

    const data = salons.map((salon) => {
      const salonBranches =
        salon.salon_type === "home"
          ? [makeHomeBranch(salon)] // ✅ home صار له فرع افتراضي واحد
          : branches
              .filter((b) => b.salon_id === salon.id)
              .map((b) => ({ ...b, branch_hours: [] }));

      return {
        ...salon,
        branches: salonBranches,
        services: services
          .filter((x) => x.salon_id === salon.id)
          .map((x) => ({
            id: x.id,
            name: x.name,
            description: x.description,
            image_url: x.image_url,
            category: x.category_id ? { id: x.category_id, name: x.category_name } : null,
          })),
      };
    });

    res.json({ page, limit, data });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /salons/:id
 * Returns salon + branches + services
 * Also returns full branch_hours per branch (7 rows if exists)
 */
exports.getSalonById = async (req, res, next) => {
  try {
    const salonId = req.params.id;

    const salon = await knex("salons").where({ id: salonId, is_active: true }).first();

    if (!salon) return res.status(404).json({ message: "Salon not found" });

    // ✅ لو home: رجع فرع افتراضي + services فقط
    if (salon.salon_type === "home") {
      const services = await knex("services as srv")
        .leftJoin("service_categories as cat", "srv.category_id", "cat.id")
        .where({ "srv.salon_id": salonId })
        .andWhere("srv.is_active", true)
        .select(
          "srv.id",
          "srv.name",
          "srv.description",
          "srv.image_url",
          "cat.id as category_id",
          "cat.name as category_name"
        );

      return res.json({
        ...salon,
        branches: [makeHomeBranch(salon)],
        services: services.map((s) => ({
          id: s.id,
          name: s.name,
          description: s.description,
          image_url: s.image_url,
          category: s.category_id ? { id: s.category_id, name: s.category_name } : null,
        })),
      });
    }

    // branches (with computed open_now today)
    const branches = await knex("branches as b")
      .leftJoin("branch_hours as bh", function () {
        this.on("bh.branch_id", "b.id").andOn("bh.day_of_week", "=", dowRaw);
      })
      .where({ "b.salon_id": salonId })
      .andWhere("b.is_active", true)
      .select([
        "b.id",
        "b.salon_id",
        "b.name",
        "b.city",
        "b.area",
        "b.address_line",
        "b.lat",
        "b.lng",
        "b.supports_home_services",
        "b.rating",
        "b.reviews_count",
        "bh.is_closed as today_is_closed",
        "bh.open_time as today_open_time",
        "bh.close_time as today_close_time",
        openNowSql(),
      ])
      .orderBy("b.created_at", "desc");

    const branchIds = branches.map((b) => b.id);

    // full weekly hours
    const hours = branchIds.length
      ? await knex("branch_hours")
          .whereIn("branch_id", branchIds)
          .select("branch_id", "day_of_week", "is_closed", "open_time", "close_time")
          .orderBy([
            { column: "branch_id", order: "asc" },
            { column: "day_of_week", order: "asc" },
          ])
      : [];

    const hoursByBranch = new Map();
    for (const h of hours) {
      const arr = hoursByBranch.get(h.branch_id) || [];
      arr.push(h);
      hoursByBranch.set(h.branch_id, arr);
    }

    const services = await knex("services as srv")
      .leftJoin("service_categories as cat", "srv.category_id", "cat.id")
      .where({ "srv.salon_id": salonId })
      .andWhere("srv.is_active", true)
      .select(
        "srv.id",
        "srv.name",
        "srv.description",
        "srv.image_url",
        "cat.id as category_id",
        "cat.name as category_name"
      );

    res.json({
      ...salon,
      branches: branches.map((b) => ({
        ...b,
        branch_hours: hoursByBranch.get(b.id) || [],
      })),
      services: services.map((s) => ({
        id: s.id,
        name: s.name,
        description: s.description,
        image_url: s.image_url,
        category: s.category_id ? { id: s.category_id, name: s.category_name } : null,
      })),
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /salons/:salonId/branches/:branchId
 * Returns { salon, branch } with computed open_now and full branch_hours
 */
exports.getBranchById = async (req, res, next) => {
  try {
    const { salonId, branchId } = req.params;

    const salon = await knex("salons").where({ id: salonId, is_active: true }).first();
    if (!salon) return res.status(404).json({ message: "Salon not found" });

    // ✅ home branch افتراضي
    const expectedHomeBranchId = `home-${salonId}`;
    if (salon.salon_type === "home" && String(branchId) === expectedHomeBranchId) {
      return res.json({
        salon,
        branch: makeHomeBranch(salon),
      });
    }

    const branch = await knex("branches as b")
      .leftJoin("branch_hours as bh", function () {
        this.on("bh.branch_id", "b.id").andOn("bh.day_of_week", "=", dowRaw);
      })
      .where({ "b.id": branchId, "b.salon_id": salonId })
      .andWhere("b.is_active", true)
      .select([
        "b.*",
        "bh.is_closed as today_is_closed",
        "bh.open_time as today_open_time",
        "bh.close_time as today_close_time",
        openNowSql(),
      ])
      .first();

    if (!branch) return res.status(404).json({ message: "Branch not found" });

    const branch_hours = await knex("branch_hours")
      .where({ branch_id: branchId })
      .select("day_of_week", "is_closed", "open_time", "close_time")
      .orderBy("day_of_week", "asc");

    res.json({ salon, branch: { ...branch, branch_hours } });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /salons/:salonId/branches
 * Returns branches for one salon (with computed open_now + full branch_hours)
 */
exports.getBranchesBySalonId = async (req, res, next) => {
  try {
    const { salonId } = req.params;

    const salon = await knex("salons").where({ id: salonId, is_active: true }).first();
    if (!salon) return res.status(404).json({ message: "Salon not found" });

    // ✅ home: رجع فرع افتراضي واحد
    if (salon.salon_type === "home") {
      return res.json({ salonId, branches: [makeHomeBranch(salon)] });
    }

    const branches = await knex("branches as b")
      .leftJoin("branch_hours as bh", function () {
        this.on("bh.branch_id", "b.id").andOn("bh.day_of_week", "=", dowRaw);
      })
      .where({ "b.salon_id": salonId })
      .andWhere("b.is_active", true)
      .select([
        "b.id",
        "b.salon_id",
        "b.name",
        "b.city",
        "b.area",
        "b.address_line",
        "b.lat",
        "b.lng",
        "b.supports_home_services",
        "b.rating",
        "b.reviews_count",
        "bh.is_closed as today_is_closed",
        "bh.open_time as today_open_time",
        "bh.close_time as today_close_time",
        openNowSql(),
      ])
      .orderBy("b.created_at", "desc");

    const branchIds = branches.map((b) => b.id);
    const hours = branchIds.length
      ? await knex("branch_hours")
          .whereIn("branch_id", branchIds)
          .select("branch_id", "day_of_week", "is_closed", "open_time", "close_time")
          .orderBy([
            { column: "branch_id", order: "asc" },
            { column: "day_of_week", order: "asc" },
          ])
      : [];

    const hoursByBranch = new Map();
    for (const h of hours) {
      const arr = hoursByBranch.get(h.branch_id) || [];
      arr.push(h);
      hoursByBranch.set(h.branch_id, arr);
    }

    return res.json({
      salonId,
      branches: branches.map((b) => ({
        ...b,
        branch_hours: hoursByBranch.get(b.id) || [],
      })),
    });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /salons/:salonId/branches
 * Creates branch (public/old route) — kept for compatibility
 */
exports.createBranch = async (req, res, next) => {
  try {
    const { salonId } = req.params;

    const salon = await knex("salons").where({ id: salonId }).first("id");
    if (!salon) return res.status(404).json({ message: "Salon not found" });

    const {
      name,
      city,
      area,
      address_line,
      address,
      lat,
      lng,
      supports_home_services,
      country,
      is_active,
    } = req.body;

    if (!name || !String(name).trim()) return res.status(400).json({ message: "Branch name is required" });
    if (!city || !String(city).trim()) return res.status(400).json({ message: "City is required" });
    if (!area || !String(area).trim()) return res.status(400).json({ message: "Area is required" });
    if (lat == null || lng == null) return res.status(400).json({ message: "lat and lng are required" });

    const latNum = Number(lat);
    const lngNum = Number(lng);
    if (Number.isNaN(latNum) || Number.isNaN(lngNum)) {
      return res.status(400).json({ message: "lat/lng must be numbers" });
    }

    const [inserted] = await knex("branches")
      .insert({
        salon_id: salonId,
        name: String(name).trim(),
        country: country?.trim() || "United Arab Emirates",
        city: String(city).trim(),
        area: String(area).trim(),
        address_line: (address_line ?? address ?? null) ? String(address_line ?? address).trim() : null,
        lat: latNum,
        lng: lngNum,
        geo: knex.raw("ST_SetSRID(ST_MakePoint(?, ?), 4326)::geography", [lngNum, latNum]),
        supports_home_services: toBool(supports_home_services),
        is_active: is_active == null ? true : toBool(is_active),
        created_at: knex.fn.now(),
        updated_at: knex.fn.now(),
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
        "created_at",
        "updated_at",
      ]);

    return res.status(201).json({ branch: inserted, branch_hours: [] });
  } catch (err) {
    next(err);
  }
};

exports.updateBranch = async (req, res, next) => {
  try {
    const { salonId, branchId } = req.params;

    const exists = await knex("branches").where({ id: branchId, salon_id: salonId }).first("id");
    if (!exists) return res.status(404).json({ message: "Branch not found" });

    const patch = {};
    const allowed = [
      "name",
      "country",
      "city",
      "area",
      "address_line",
      "supports_home_services",
      "is_active",
      "lat",
      "lng",
    ];

    for (const k of allowed) {
      if (req.body[k] !== undefined) patch[k] = req.body[k];
    }

    if (patch.name != null) patch.name = String(patch.name).trim();
    if (patch.city != null) patch.city = String(patch.city).trim();
    if (patch.area != null) patch.area = String(patch.area).trim();
    if (patch.country != null) patch.country = String(patch.country).trim();
    if (patch.address_line != null) patch.address_line = String(patch.address_line).trim();

    if (patch.supports_home_services != null) patch.supports_home_services = toBool(patch.supports_home_services);
    if (patch.is_active != null) patch.is_active = toBool(patch.is_active);

    if (patch.lat != null) patch.lat = Number(patch.lat);
    if (patch.lng != null) patch.lng = Number(patch.lng);

    if (patch.lat != null && patch.lng != null) {
      patch.geo = knex.raw("ST_SetSRID(ST_MakePoint(?, ?), 4326)::geography", [patch.lng, patch.lat]);
    }

    patch.updated_at = knex.fn.now();

    const [updated] = await knex("branches").where({ id: branchId }).update(patch).returning("*");

    res.json({ branch: updated });
  } catch (err) {
    next(err);
  }
};

exports.deleteBranch = async (req, res, next) => {
  try {
    const { salonId, branchId } = req.params;

    const exists = await knex("branches").where({ id: branchId, salon_id: salonId }).first("id");
    if (!exists) return res.status(404).json({ message: "Branch not found" });

    await knex("branches").where({ id: branchId }).del();
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
};