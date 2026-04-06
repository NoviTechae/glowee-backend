// src/routes/publicMobile.js
const router = require("express").Router();
const db = require("../db/knex");

// GET /mobile/banners?placement=home
router.get("/banners", async (req, res, next) => {
  try {
    const placement = String(req.query.placement || "home");
    const now = new Date();

    const rows = await db("mobile_banners")
      .where({ is_active: true, placement })
      .andWhere((qb) => {
        qb.whereNull("starts_at").orWhere("starts_at", "<=", now);
      })
      .andWhere((qb) => {
        qb.whereNull("ends_at").orWhere("ends_at", ">=", now);
      })
      .select([
        "id",
        "title",
        "image_url",
        "placement",
        "sort_order",
        "action_type",
        "action_value",
      ])
      .orderBy("sort_order", "asc");

    res.json({ data: rows });
  } catch (e) {
    next(e);
  }
});

module.exports = router;