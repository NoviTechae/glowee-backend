// src/routes/adminFeedback.js

const router = require("express").Router();
const db = require("../db/knex");
const dashboardAuthRequired = require("../middleware/dashboardAuthRequired");

function requireAdmin(req, res, next) {
  if (req.dashboard?.role !== "admin") {
    return res.status(403).json({ error: "Admin only" });
  }
  next();
}

router.use(dashboardAuthRequired, requireAdmin);

// GET /dashboard/admin/feedback
router.get("/", async (req, res, next) => {
  try {
    const { rating, salon_id, limit = 100 } = req.query;

    let query = db("booking_ratings as r")
      .leftJoin("users as u", "u.id", "r.user_id")
      .leftJoin("salons as s", "s.id", "r.salon_id")
      .leftJoin("branches as br", "br.id", "r.branch_id")
      .select([
        "r.id",
        "r.booking_id",
        "r.user_id",
        "r.rating",
        "r.comment",
        "r.created_at",
        "u.name as user_name",
        "s.id as salon_id",
        "s.name as salon_name",
        "br.name as branch_name",
      ])
      .orderBy("r.created_at", "desc")
      .limit(Number(limit));

    if (rating && rating !== "all") {
      if (rating === "low") {
        query = query.where("r.rating", "<=", 2);
      } else {
        query = query.where("r.rating", Number(rating));
      }
    }

    if (salon_id) {
      query = query.where("r.salon_id", salon_id);
    }

    const rows = await query;
    res.json({ data: rows });
  } catch (e) {
    next(e);
  }
});

module.exports = router;