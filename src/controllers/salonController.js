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

const dowRaw = knex.raw("EXTRACT(DOW FROM timezone('Asia/Dubai', now()))::int");

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

/**
 * GET /salons
 */
exports.getSalons = async (req, res, next) => {
  try {
    const page = parseIntSafe(req.query.page, 1);
    const limit = parseIntSafe(req.query.limit, 10);
    const offset = (page - 1) * limit;

    const city = req.query.city?.toString();
    const type = (req.query.type || "all").toString();

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
        knex.raw(`CASE WHEN s.salon_type = 'home' THEN 1 ELSE COUNT(b.id) END as branches_count`)
      );

    if (type === "home") salonsQ = salonsQ.andWhere("s.salon_type", "home");
    else if (type === "in_salon") salonsQ = salonsQ.andWhere("s.salon_type", "in_salon");
    else if (type === "both") salonsQ = salonsQ.andWhere("s.salon_type", "both");

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

    const branches = await knex("branches as b")
      .join("salons as s", "s.id", "b.salon_id")
      .leftJoin("branch_hours as bh", function () {
        this.on("bh.branch_id", "b.id").andOn("bh.day_of_week", "=", dowRaw);
      })
      .leftJoin("booking_ratings as r", "r.branch_id", "b.id")
      .whereIn("b.salon_id", salonIds)
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
        knex.raw(`COALESCE(AVG(r.rating), 0)::decimal(3,2) as rating`),
        knex.raw(`COUNT(r.id)::int as reviews_count`),
        "bh.is_closed as today_is_closed",
        "bh.open_time as today_open_time",
        "bh.close_time as today_close_time",
        openNowSql(),
      ])
      .groupBy(
        "b.id",
        "bh.branch_id",
        "bh.is_closed",
        "bh.open_time",
        "bh.close_time"
      ).orderBy("b.created_at", "asc");

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
      const salonBranches = branches
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
 */
exports.getSalonById = async (req, res, next) => {
  try {
    const salonId = req.params.id;

    const salon = await knex("salons")
      .where({ id: salonId, is_active: true })
      .first();

    if (!salon) {
      return res.status(404).json({ message: "Salon not found" });
    }

    const branches = await knex("branches as b")
      .leftJoin("branch_hours as bh", function () {
        this.on("bh.branch_id", "b.id").andOn("bh.day_of_week", "=", dowRaw);
      })
      .leftJoin("booking_ratings as r", "r.branch_id", "b.id")
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
        knex.raw(`COALESCE(AVG(r.rating), 0)::decimal(3,2) as rating`),
        knex.raw(`COUNT(r.id)::int as reviews_count`),
        "bh.is_closed as today_is_closed",
        "bh.open_time as today_open_time",
        "bh.close_time as today_close_time",
        openNowSql(),
      ])
      .groupBy(
        "b.id",
        "bh.branch_id",
        "bh.is_closed",
        "bh.open_time",
        "bh.close_time"
      ).orderBy("b.created_at", "asc");

    const branchIds = branches.map((b) => b.id);

    const hours = await knex("branch_hours")
      .whereIn("branch_id", branchIds)
      .select("branch_id", "day_of_week", "is_closed", "open_time", "close_time")
      .orderBy([
        { column: "branch_id", order: "asc" },
        { column: "day_of_week", order: "asc" },
      ]);

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

    return res.json({
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
 */
exports.getBranchById = async (req, res, next) => {
  try {
    const { salonId, branchId } = req.params;

    const salon = await knex("salons")
      .where({ id: salonId, is_active: true })
      .first();

    if (!salon) {
      return res.status(404).json({ message: "Salon not found" });
    }

    const branch = await knex("branches as b")
      .leftJoin("branch_hours as bh", function () {
        this.on("bh.branch_id", "b.id").andOn("bh.day_of_week", "=", dowRaw);
      })
      .leftJoin("booking_ratings as r", "r.branch_id", "b.id")
      .where({ "b.id": branchId, "b.salon_id": salonId })
      .andWhere("b.is_active", true)
      .select([
        "b.*",
        knex.raw(`COALESCE(AVG(r.rating), 0)::decimal(3,2) as rating`),
        knex.raw(`COUNT(r.id)::int as reviews_count`),
        "bh.is_closed as today_is_closed",
        "bh.open_time as today_open_time",
        "bh.close_time as today_close_time",
        openNowSql(),
      ])
      .groupBy(
        "b.id",
        "bh.branch_id",
        "bh.is_closed",
        "bh.open_time",
        "bh.close_time"
      ).first();

    if (!branch) {
      return res.status(404).json({ message: "Branch not found" });
    }

    const branch_hours = await knex("branch_hours")
      .where({ branch_id: branchId })
      .select("day_of_week", "is_closed", "open_time", "close_time")
      .orderBy("day_of_week", "asc");

    return res.json({
      salon,
      branch: {
        ...branch,
        branch_hours,
      },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /salons/:salonId/branches
 */
exports.getBranchesBySalonId = async (req, res, next) => {
  try {
    const { salonId } = req.params;

    const salon = await knex("salons")
      .where({ id: salonId, is_active: true })
      .first();

    if (!salon) {
      return res.status(404).json({ message: "Salon not found" });
    }

    const branches = await knex("branches as b")
      .leftJoin("branch_hours as bh", function () {
        this.on("bh.branch_id", "b.id").andOn("bh.day_of_week", "=", dowRaw);
      })
      .leftJoin("booking_ratings as r", "r.branch_id", "b.id")
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
        knex.raw(`COALESCE(AVG(r.rating), 0)::decimal(3,2) as rating`),
        knex.raw(`COUNT(r.id)::int as reviews_count`),
        "bh.is_closed as today_is_closed",
        "bh.open_time as today_open_time",
        "bh.close_time as today_close_time",
        openNowSql(),
      ])
      .groupBy(
        "b.id",
        "bh.branch_id",
        "bh.is_closed",
        "bh.open_time",
        "bh.close_time"
      )
    const branchIds = branches.map((b) => b.id);

    const hours = await knex("branch_hours")
      .whereIn("branch_id", branchIds)
      .select("branch_id", "day_of_week", "is_closed", "open_time", "close_time")
      .orderBy([
        { column: "branch_id", order: "asc" },
        { column: "day_of_week", order: "asc" },
      ]);

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

    const latNum = Number(lat);
    const lngNum = Number(lng);

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
      .returning("*");

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

    const patch = { ...req.body, updated_at: knex.fn.now() };

    if (patch.lat != null && patch.lng != null) {
      patch.geo = knex.raw("ST_SetSRID(ST_MakePoint(?, ?), 4326)::geography", [patch.lng, patch.lat]);
    }

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