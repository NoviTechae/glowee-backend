//src/routes/salonStamps.js

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

//
// GET /dashboard/salon/stamps
//
router.get("/", async (req, res, next) => {
  try {
    const salonId = getSalonId(req);

    if (!salonId) {
      return res.status(400).json({
        error: "Salon account is not linked to a salon",
      });
    }

    let settings = await db("salon_stamp_settings")
      .where({ salon_id: salonId })
      .first();

    if (!settings) {
      const [created] = await db("salon_stamp_settings")
        .insert({
          salon_id: salonId,
          stamps_required: 6,
          reward_text: "Free Reward",
          stamp_images: JSON.stringify([]),
          is_active: true,
          created_at: db.fn.now(),
          updated_at: db.fn.now(),
        })
        .returning("*");

      settings = created;
    }

    res.json({
      data: {
        ...settings,
        stamp_images: Array.isArray(settings.stamp_images)
          ? settings.stamp_images
          : [],
      },
    });
  } catch (e) {
    next(e);
  }
});

//
// PUT /dashboard/salon/stamps
//
router.put("/", async (req, res, next) => {
  try {
    const salonId = getSalonId(req);

    const {
      stamps_required,
      reward_text,
      stamp_images,
      is_active,
    } = req.body;

    if (!salonId) {
      return res.status(400).json({
        error: "Salon account is not linked to a salon",
      });
    }

    await db("salon_stamp_settings")
      .insert({
        salon_id: salonId,
        stamps_required: Number(stamps_required || 6),
        reward_text: reward_text || "Free Reward",
        stamp_images: JSON.stringify(
          Array.isArray(stamp_images) ? stamp_images : []
        ),
        is_active: Boolean(is_active),
        created_at: db.fn.now(),
        updated_at: db.fn.now(),
      })
      .onConflict("salon_id")
      .merge({
        stamps_required: Number(stamps_required || 6),
        reward_text: reward_text || "Free Reward",
        stamp_images: JSON.stringify(
          Array.isArray(stamp_images) ? stamp_images : []
        ),
        is_active: Boolean(is_active),
        updated_at: db.fn.now(),
      });

    res.json({
      ok: true,
      message: "Stamp settings updated successfully",
    });
  } catch (e) {
    next(e);
  }
});

module.exports = router;