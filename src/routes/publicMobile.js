// src/routes/publicMobile.js
const router = require("express").Router();
const db = require("../db/knex");

// GET /mobile/banners?placement=home
router.get("/banners", async (req, res, next) => {
  try {
    const placement = String(req.query.placement || "home");

    const rows = await db("mobile_banners")
      .where({ is_active: true, placement })
      .select(["id", "title", "image_url", "placement", "sort_order"])
      .orderBy("sort_order", "asc");

    res.json({ data: rows });
  } catch (e) {
    next(e);
  }
});

module.exports = router;