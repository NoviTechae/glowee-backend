// src/routes/salonReviews.js

const router = require("express").Router();
const db = require("../db/knex");
const dashboardAuthRequired = require("../middleware/dashboardAuthRequired");

function requireSalon(req, res, next) {
  if (req.dashboard?.role !== "salon") {
    return res.status(403).json({ error: "Salon only" });
  }
  next();
}

router.use(dashboardAuthRequired, requireSalon);

function getSalonId(req) {
  return req.dashboard?.salon_id || req.dashboard?.salonId;
}

router.get("/stats", async (req, res, next) => {
  try {
    const salonId = getSalonId(req);
    if (!salonId) return res.status(400).json({ error: "Salon account is not linked to a salon" });

    const [{ avg_rating, total_reviews }] = await db("booking_ratings")
      .where("salon_id", salonId)
      .avg("rating as avg_rating")
      .count("* as total_reviews");

    const ratingBreakdown = await db("booking_ratings")
      .where("salon_id", salonId)
      .groupBy("rating")
      .select(["rating", db.raw("COUNT(*) as count")])
      .orderBy("rating", "desc");

    res.json({
      avg_rating: Number(avg_rating || 0),
      total_reviews: Number(total_reviews || 0),
      breakdown: ratingBreakdown.map((r) => ({
        rating: Number(r.rating),
        count: Number(r.count || 0),
      })),
    });
  } catch (e) {
    next(e);
  }
});

router.get("/", async (req, res, next) => {
  try {
    const salonId = getSalonId(req);
    const { rating, search, limit = 100 } = req.query;

    if (!salonId) return res.status(400).json({ error: "Salon account is not linked to a salon" });

    let query = db("booking_ratings as r")
      .leftJoin("users as u", "u.id", "r.user_id")
      .leftJoin("branches as br", "br.id", "r.branch_id")
      .leftJoin("bookings as b", "b.id", "r.booking_id")
      .where("r.salon_id", salonId)
      .select([
        "r.id",
        "r.booking_id",
        "r.rating",
        "r.comment",
        "r.created_at",
        "u.name as user_name",
        "u.phone as user_phone",
        "br.name as branch_name",
        "b.scheduled_at",
        "b.total_aed",
      ])
      .orderBy("r.created_at", "desc")
      .limit(Number(limit));

    if (rating && rating !== "all") {
      query = query.where("r.rating", Number(rating));
    }

    if (search) {
      query = query.where(function () {
        this.whereILike("u.name", `%${search}%`)
          .orWhereILike("u.phone", `%${search}%`)
          .orWhereILike("r.comment", `%${search}%`)
          .orWhereILike("br.name", `%${search}%`);
      });
    }

    const rows = await query;

    res.json({
      data: rows.map((r) => ({
        ...r,
        rating: Number(r.rating || 0),
        total_aed: Number(r.total_aed || 0),
      })),
    });
  } catch (e) {
    next(e);
  }
});

module.exports = router;