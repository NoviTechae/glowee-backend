const router = require("express").Router();
const db = require("../db/knex");

// GET /salons/:salonId/branches/:branchId/hours
router.get("/:salonId/branches/:branchId/hours", async (req, res, next) => {
  try {
    const { salonId, branchId } = req.params;

    // تأكد الفرع تابع للصالون + active
    const branch = await db("branches")
      .where({ id: branchId, salon_id: salonId, is_active: true })
      .first("id");

    if (!branch) return res.status(404).json({ error: "Branch not found" });

    const rows = await db("branch_hours")
      .where({ branch_id: branchId })
      .orderBy("day_of_week", "asc");

    res.json({ data: rows });
  } catch (e) {
    next(e);
  }
});

module.exports = router;