// src/routes/publicSlots.js
const router = require("express").Router();
const db = require("../db/knex");

// -------- helpers --------
function parseHHMMToMinutes(t) {
  if (!t) return null;
  const [h, m] = String(t).split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  return h * 60 + m;
}

function minutesTo12h(mins) {
  const h24 = Math.floor(mins / 60) % 24;
  const m = mins % 60;

  const ampm = h24 >= 12 ? "PM" : "AM";
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;

  return `${h12}:${String(m).padStart(2, "0")} ${ampm}`;
}

function dayStartIso(dateStr) {
  return `${dateStr}T00:00:00.000Z`;
}
function dayEndIso(dateStr) {
  return `${dateStr}T23:59:59.999Z`;
}

function overlap(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && aEnd > bStart;
}

// GET /salons/:salonId/branches/:branchId/availability/:availabilityId/slots?date=YYYY-MM-DD&mode=in_salon
router.get(
  "/:salonId/branches/:branchId/availability/:availabilityId/slots",
  async (req, res, next) => {
    try {
      const { salonId, branchId, availabilityId } = req.params;
      const date = String(req.query.date || "").trim();
      const mode = String(req.query.mode || "in_salon"); // "in_salon" | "home"

      if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return res.status(400).json({ error: "Missing/invalid date (YYYY-MM-DD)" });
      }
      if (!["in_salon", "home"].includes(mode)) {
        return res.status(400).json({ error: "Invalid mode" });
      }

      // 1) get availability (duration)
      const av = await db("service_availability as sa")
        .join("services as s", "s.id", "sa.service_id")
        .where("sa.id", availabilityId)
        .andWhere("sa.branch_id", branchId)
        .andWhere("s.salon_id", salonId)
        .andWhere("sa.mode", mode)
        .andWhere("sa.is_active", true)
        .select(["sa.id", "sa.duration_mins"])
        .first();

      if (!av) return res.status(404).json({ error: "Availability not found" });

      const durationMins = Number(av.duration_mins || 0);
      if (!Number.isFinite(durationMins) || durationMins <= 0) {
        return res.status(400).json({ error: "Invalid duration" });
      }

      // 2) get branch hours for weekday
      const weekday = new Date(date + "T00:00:00").getDay(); // 0..6
      const h = await db("branch_hours")
        .where({ branch_id: branchId, day_of_week: weekday })
        .first();

      if (!h || h.is_closed) return res.json({ data: [] });

      const openM = parseHHMMToMinutes(h.open_time);
      const closeM = parseHHMMToMinutes(h.close_time);
      if (openM == null || closeM == null) return res.json({ data: [] });

      // overnight close < open → نخليه لليوم الحالي لين 24:00
      const effectiveClose = closeM < openM ? 24 * 60 : closeM;

      // 3) generate candidates based on hours
      const STEP = 30; // كل نص ساعة (غيّريه إذا تبين)
      const candidates = [];
      for (let t = openM; t + durationMins <= effectiveClose; t += STEP) {
        candidates.push({
          start_min: t,
          end_min: t + durationMins,
          start_label: minutesTo12h(t),              // ✅ AM/PM
          end_label: minutesTo12h(t + durationMins), // ✅ AM/PM
        });
      }

      // 4) fetch booked assignments for that branch/day
      const booked = await db("booking_item_assignments as bia")
        .join("booking_items as bi", "bi.id", "bia.booking_item_id")
        .join("bookings as b", "b.id", "bi.booking_id")
        .where("bia.branch_id", branchId)
        .andWhere("b.branch_id", branchId)
        .whereIn("b.status", ["pending", "confirmed"])
        .andWhere("bia.starts_at", ">=", dayStartIso(date))
        .andWhere("bia.starts_at", "<=", dayEndIso(date))
        .select(["bia.starts_at", "bia.ends_at"]);

      const bookedRanges = booked
        .map((x) => {
          const s = new Date(x.starts_at);
          const e = new Date(x.ends_at);
          return {
            sM: s.getHours() * 60 + s.getMinutes(),
            eM: e.getHours() * 60 + e.getMinutes(),
          };
        })
        .filter((r) => Number.isFinite(r.sM) && Number.isFinite(r.eM) && r.eM > r.sM);

      // 5) filter out overlaps
      const available = candidates.filter((c) => {
        for (const r of bookedRanges) {
          if (overlap(c.start_min, c.end_min, r.sM, r.eM)) return false;
        }
        return true;
      });

      return res.json({
        data: available.map((x) => ({
          start_time: x.start_label, // ✅ مثل "12:30 PM"
          end_time: x.end_label,
        })),
      });
    } catch (e) {
      next(e);
    }
  }
);

module.exports = router;