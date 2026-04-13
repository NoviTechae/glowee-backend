//src/routes/publicBrowse.js
const router = require("express").Router();
const db = require("../db/knex");

// GET /browse/branches?type=salon|home&city=Dubai&area=...
router.get("/branches", async (req, res, next) => {
  try {
    const type = (req.query.type || "salon").toString(); // salon | home
    const city = req.query.city?.toString();
    const area = req.query.area?.toString();

    // Postgres: EXTRACT(DOW FROM NOW()) => 0 Sunday ... 6 Saturday
    const dowRaw = db.raw("EXTRACT(DOW FROM NOW())::int");

    const q = db("branches as b")
      .join("salons as s", "s.id", "b.salon_id")
      // ✅ join ساعات اليوم (اختياري، لو ما في ساعات بيرجع null)
      .leftJoin("branch_hours as bh", function () {
        this.on("bh.branch_id", "b.id").andOn("bh.day_of_week", "=", dowRaw);
      })
      .where("b.is_active", true)
      .andWhere("s.is_active", true)
      .select([
        "b.id as branch_id",
        "b.name as branch_name",
        "b.city",
        "b.area",
        "b.address_line",
        "b.lat",
        "b.lng",
        "b.supports_home_services",

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
      WHEN (NOW()::time >= bh.open_time AND NOW()::time < bh.close_time) THEN true
      ELSE false
    END as is_open_now
  `),
      ])
      .leftJoin("booking_ratings as r", "r.branch_id", "b.id")
      .groupBy("b.id", "s.id", "bh.branch_id")

    if (type === "home") q.andWhere("b.supports_home_services", true);
    else q.andWhere("b.supports_home_services", false);

    if (city) q.andWhere("b.city", city);
    if (area) q.andWhere("b.area", area);

    const rows = await q;
    res.json({ data: rows });
  } catch (e) {
    next(e);
  }
});

module.exports = router;