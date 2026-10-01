// src/routes/bookings.js
const router = require("express").Router();
const { z } = require("zod");
const db = require("../db/knex");
const authRequired = require("../middleware/authRequired");
const bookingController = require("../controllers/bookingController");
const {
  cartRequirements,
  qualifiedStaff,
  busyForDay,
  freeSlots,
  inDubai,
  minutesToHHMMSS,
} = require("../utils/slots");

const PreviewSchema = z.object({
  salon_id: z.string().uuid(),
  branch_id: z.string().uuid(),
  mode: z.enum(["in_salon", "home"]).default("in_salon"),
  starts_at: z.string().datetime(),
  items: z.array(z.object({ availability_id: z.string().uuid(), qty: z.number().int().min(1).max(10).default(1) })).min(1),
});

// POST /bookings/preview: which team members are free at this exact time.
router.post("/preview", async (req, res, next) => {
  try {
    const body = PreviewSchema.parse(req.body);

    const branch = await db("branches").where({ id: body.branch_id, salon_id: body.salon_id, is_active: true }).first("id");
    if (!branch) return res.status(404).json({ error: "Branch not found for this salon" });

    const need = await cartRequirements(db, { salonId: body.salon_id, branchId: body.branch_id, mode: body.mode, items: body.items });
    if (!need) return res.status(400).json({ error: "Some services are not available for this branch/mode" });

    const startsAt = new Date(body.starts_at);
    const endsAt = new Date(startsAt.getTime() + need.duration * 60000);

    const staff = await qualifiedStaff(db, { salonId: body.salon_id, branchId: body.branch_id, serviceIds: need.serviceIds });
    const busy = await busyForDay(db, { branchId: body.branch_id, staffIds: staff.map((s) => s.id), dateKey: inDubai(startsAt).dateKey });

    const s = startsAt.getTime();
    const e = endsAt.getTime();
    const hit = (spans) => spans.some(([bs, be]) => s < be && e > bs);
    const available = hit(busy.wholeBranch) ? [] : staff.filter((st) => !hit(busy.byStaff.get(st.id) || []));

    return res.json({
      total_duration_mins: need.duration,
      starts_at: startsAt.toISOString(),
      ends_at: endsAt.toISOString(),
      any_staff_ok: available.length > 0,
      available_staff: available,
    });
  } catch (e) {
    next(e);
  }
});

// GET /bookings/availability?service_id=&branch_id=&date=YYYY-MM-DD&mode=in_salon&staff_id=
// Same times as the slots endpoint; kept for app versions that call this one.
router.get("/availability", async (req, res, next) => {
  try {
    const { service_id, branch_id, date, mode = "in_salon", staff_id } = req.query;
    if (!service_id || !branch_id || !date) return res.status(400).json({ error: "service_id, branch_id, and date are required" });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date))) return res.status(400).json({ error: "Date must be in YYYY-MM-DD format" });

    const availability = await db("service_availability as sa")
      .join("services as s", "s.id", "sa.service_id")
      .join("branches as b", "b.id", "sa.branch_id")
      .where({ "sa.service_id": service_id, "sa.branch_id": branch_id, "sa.mode": mode, "sa.is_active": true, "s.is_active": true, "b.is_active": true })
      .first(["sa.id", "sa.duration_mins", "s.salon_id"]);
    if (!availability) return res.status(404).json({ error: "Service not available for this branch/mode" });

    const duration = Number(availability.duration_mins) || 30;
    const { slots, reason } = await freeSlots(db, {
      salonId: availability.salon_id,
      branchId: branch_id,
      dateKey: String(date),
      duration,
      serviceIds: [service_id],
      staffId: staff_id || null,
      step: Math.min(30, duration),
    });

    const messages = {
      closed: "Branch is closed on this day",
      no_staff: "No staff available for this service",
      staff_unavailable: "Staff not available",
    };

    return res.json({
      date,
      service_id,
      branch_id,
      mode,
      duration_mins: duration,
      slots: slots.map((s) => ({
        start_time: minutesToHHMMSS(s.startMin),
        end_time: minutesToHHMMSS(s.endMin),
        start_iso: s.start.toISOString(),
        available_staff_count: s.freeStaff.length,
        total_staff_count: s.totalStaff,
      })),
      ...(messages[reason] ? { message: messages[reason] } : {}),
    });
  } catch (e) {
    next(e);
  }
});

router.post("/:id/confirm-gift", authRequired, bookingController.confirmGiftBooking);

module.exports = router;