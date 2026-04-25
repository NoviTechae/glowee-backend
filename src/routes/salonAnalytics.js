// src/routes/salonAnalytics.js

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
// GET /dashboard/salon/analytics
//
router.get("/", async (req, res, next) => {
  try {
    const salonId = getSalonId(req);

    if (!salonId) {
      return res.status(400).json({
        error: "Salon account is not linked to a salon",
      });
    }

    const [{ total_bookings }] = await db("bookings")
      .where("salon_id", salonId)
      .count("* as total_bookings");

    const [{ completed_bookings }] = await db("bookings")
      .where("salon_id", salonId)
      .where("status", "completed")
      .count("* as completed_bookings");

    const [{ cancelled_bookings }] = await db("bookings")
      .where("salon_id", salonId)
      .where("status", "cancelled")
      .count("* as cancelled_bookings");

    const [{ total_revenue }] = await db("bookings")
      .where("salon_id", salonId)
      .where("status", "completed")
      .sum("total_aed as total_revenue");

    const topServices = await db("booking_items as bi")
      .leftJoin("bookings as b", "b.id", "bi.booking_id")
      .where("b.salon_id", salonId)
      .groupBy("bi.service_name_snapshot")
      .select([
        "bi.service_name_snapshot as service_name",
        db.raw("COUNT(*) as total_bookings"),
      ])
      .orderBy("total_bookings", "desc")
      .limit(5);

    res.json({
      total_bookings: Number(total_bookings || 0),
      completed_bookings: Number(completed_bookings || 0),
      cancelled_bookings: Number(cancelled_bookings || 0),
      total_revenue: Number(total_revenue || 0),

      top_services: topServices.map((s) => ({
        service_name: s.service_name || "Service",
        total_bookings: Number(s.total_bookings || 0),
      })),
    });
  } catch (e) {
    next(e);
  }
});

module.exports = router;