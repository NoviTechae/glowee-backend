// src/routes/publicAvailabilitySlots.js
const router = require("express").Router();
const db = require("../db/knex");
const { cartRequirements, freeSlots, minutesToLabel } = require("../utils/slots");

const isUuid = (v) => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

/**
 * GET /salons/:salonId/branches/:branchId/availability/:availabilityId/slots?date=YYYY-MM-DD
 *
 * Optional:
 *   step=30                  minutes between start times (5 to 60)
 *   items=<id>:<qty>,...     the whole cart, so the length and the team member fit every service
 *   staff_id=<uuid>          only times this team member is free
 *
 * A time is offered only if a team member who does all the services is free for
 * the whole appointment: not booked, not blocked, inside opening hours (UAE time).
 */
router.get("/:salonId/branches/:branchId/availability/:availabilityId/slots", async (req, res, next) => {
  try {
    const { salonId, branchId, availabilityId } = req.params;
    if (![salonId, branchId, availabilityId].every(isUuid)) return res.status(400).json({ error: "Invalid ids" });

    const dateKey = String(req.query.date || "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return res.status(400).json({ error: "Missing/invalid date (YYYY-MM-DD)" });

    const step = Math.max(5, Math.min(60, Number(req.query.step) || 30));
    const staffId = isUuid(req.query.staff_id) ? req.query.staff_id : null;

    // The cart: this service, plus any others sent in `items`.
    let items = [{ availability_id: availabilityId, qty: 1 }];
    if (typeof req.query.items === "string" && req.query.items.trim()) {
      const parsed = req.query.items
        .split(",")
        .map((p) => p.split(":"))
        .filter(([id]) => isUuid(id))
        .map(([id, q]) => ({ availability_id: id, qty: Math.min(10, Math.max(1, Number(q) || 1)) }));
      if (parsed.length) items = parsed;
    }

    const branch = await db("branches").where({ id: branchId, salon_id: salonId, is_active: true }).first("id");
    if (!branch) return res.status(404).json({ error: "Branch not found" });

    const need = await cartRequirements(db, { salonId, branchId, items });
    if (!need) return res.json({ data: [] });

    const { slots } = await freeSlots(db, {
      salonId,
      branchId,
      dateKey,
      duration: need.duration,
      serviceIds: need.serviceIds,
      staffId,
      step,
    });

    return res.json({
      data: slots.map((s) => ({
        start_time: minutesToLabel(s.startMin),
        end_time: minutesToLabel(s.endMin),
        start_iso: s.start.toISOString(),
        end_iso: s.end.toISOString(),
        available_staff_count: s.freeStaff.length,
      })),
    });
  } catch (e) {
    next(e);
  }
});

module.exports = router;