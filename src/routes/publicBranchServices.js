// src/routes/publicBranchServices.js
const router = require("express").Router();
const db = require("../db/knex");

router.get("/:salonId/branches/:branchId/services", async (req, res, next) => {
  try {
    const { salonId, branchId } = req.params;
    const mode = (req.query.mode || "in_salon").toString();

    const rows = await db("service_availability as sa")
      .join("services as s", "s.id", "sa.service_id")
      .leftJoin("service_categories as c", "c.id", "s.category_id")
      .where("sa.branch_id", branchId)
      .andWhere("s.salon_id", salonId)
      .andWhere("sa.mode", mode)
      .andWhere("sa.is_active", true)
      .andWhere("s.is_active", true)
      .select([
        "s.id as service_id",
        "s.name as service_name",
        "s.description",
        "s.image_url",
        "c.id as category_id",
        "c.name as category_name",
        "sa.id as availability_id",
        "sa.mode",
        "sa.duration_mins",
        "sa.price_aed",
        "sa.travel_fee_aed",
      ])
      .orderBy([{ column: "category_name", order: "asc" }, { column: "service_name", order: "asc" }]);

    return res.json({ data: rows });
  } catch (e) {
    next(e);
  }
});

module.exports = router;