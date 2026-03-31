// src/routes/publicAvailabilitySlots.js
const router = require("express").Router();
const db = require("../db/knex");

function isUuid(v) {
  return typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

function to12hFromMinutes(mins) {
  let h = Math.floor(mins / 60) % 24;
  const m = mins % 60;
  const ampm = h >= 12 ? "PM" : "AM";
  const hh = h % 12 === 0 ? 12 : h % 12;
  return `${hh}:${pad2(m)} ${ampm}`;
}

function parseHHMMToMinutes(t) {
  if (!t) return null;
  const [h, m] = String(t).split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  return h * 60 + m;
}

function isoForLocal(dateKey, minutes) {
  // dateKey: YYYY-MM-DD (local)
  const [Y, M, D] = dateKey.split("-").map(Number);
  const d = new Date(Y, (M - 1), D, 0, 0, 0, 0);
  d.setMinutes(minutes);
  return d.toISOString();
}

function isSameDateKey(d, dateKey) {
  const y = d.getFullYear();
  const m = pad2(d.getMonth() + 1);
  const day = pad2(d.getDate());
  return `${y}-${m}-${day}` === dateKey;
}

/**
 * GET /salons/:salonId/branches/:branchId/availability/:availabilityId/slots?date=YYYY-MM-DD&step=30
 */
router.get("/:salonId/branches/:branchId/availability/:availabilityId/slots", async (req, res, next) => {
  try {
    const { salonId, branchId, availabilityId } = req.params;

    if (!isUuid(salonId) || !isUuid(branchId) || !isUuid(availabilityId)) {
      return res.status(400).json({ error: "Invalid ids" });
    }

    const dateKey = String(req.query.date || "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
      return res.status(400).json({ error: "Missing/invalid date (YYYY-MM-DD)" });
    }

    const step = Math.max(5, Math.min(60, Number(req.query.step || 30) || 30)); // 5..60

    // 1) تأكيد availability تابع للفرع وللصالون + خذ مدة الخدمة
    const sa = await db("service_availability as sa")
      .join("services as s", "s.id", "sa.service_id")
      .where("sa.id", availabilityId)
      .andWhere("sa.branch_id", branchId)
      .andWhere("s.salon_id", salonId)
      .first([
        "sa.id",
        "sa.branch_id",
        "sa.mode",
        "sa.duration_mins",
        "sa.is_active",
        "s.is_active as service_active",
      ]);

    if (!sa) return res.status(404).json({ error: "Availability not found" });
    if (!sa.is_active || !sa.service_active) return res.json({ data: [] });

    const duration = Number(sa.duration_mins) || 30;

    // 2) ساعات عمل الفرع لليوم
    const dt = new Date(`${dateKey}T12:00:00`); // safe local-ish
    const dow = dt.getDay(); // 0..6

    const hr = await db("branch_hours")
      .where({ branch_id: branchId, day_of_week: dow })
      .first(["is_closed", "open_time", "close_time"]);

    if (!hr || hr.is_closed) return res.json({ data: [] });

    const openM = parseHHMMToMinutes(hr.open_time);
    const closeM = parseHHMMToMinutes(hr.close_time);
    if (openM == null || closeM == null) return res.json({ data: [] });

    // 3) Generate candidate slots داخل الدوام
    // NOTE: ما ندعم overnight هنا — إذا تبينه قولي وبسويه (لكن أغلب الصالونات ما تسوي overnight)
    let startM = openM;
    let endM = closeM;

    if (endM <= startM) {
      // overnight not supported in this endpoint for now
      return res.json({ data: [] });
    }

    // 4) إذا اليوم = اليوم الحالي، نشيل الأوقات اللي راحت
    const now = new Date();
    if (isSameDateKey(now, dateKey)) {
      const curM = now.getHours() * 60 + now.getMinutes();
      // نخلي أول slot يبدأ بعد الوقت الحالي (تقريب لفوق للـ step)
      const rounded = Math.ceil(curM / step) * step;
      startM = Math.max(startM, rounded);
    }

    // 5) Fetch busy intervals (pending/confirmed) لهذا اليوم
    const dayStartIso = isoForLocal(dateKey, 0);
    const dayEndIso = isoForLocal(dateKey, 24 * 60 - 1);

    // booking_item_assignments -> booking_items -> bookings (عشان status)
    const busy = await db("booking_item_assignments as bia")
      .join("booking_items as bi", "bi.id", "bia.booking_item_id")
      .join("bookings as b", "b.id", "bi.booking_id")
      .where("bia.branch_id", branchId)
      .andWhere("bi.service_availability_id", availabilityId)
      .whereIn("b.status", ["pending", "confirmed"])
      .andWhere("bia.starts_at", ">=", dayStartIso)
      .andWhere("bia.starts_at", "<=", dayEndIso)
      .select(["bia.starts_at", "bia.ends_at"]);

    const busyIntervals = (busy || [])
      .map((x) => ({
        s: new Date(x.starts_at).getTime(),
        e: new Date(x.ends_at).getTime(),
      }))
      .filter((x) => Number.isFinite(x.s) && Number.isFinite(x.e) && x.e > x.s);

    function overlaps(slotStartIso, slotEndIso) {
      const s = new Date(slotStartIso).getTime();
      const e = new Date(slotEndIso).getTime();
      for (const b of busyIntervals) {
        // overlap if s < b.e && e > b.s
        if (s < b.e && e > b.s) return true;
      }
      return false;
    }

    const out = [];
    for (let m = startM; m + duration <= endM; m += step) {
      const slotStartIso = isoForLocal(dateKey, m);
      const slotEndIso = isoForLocal(dateKey, m + duration);

      if (overlaps(slotStartIso, slotEndIso)) continue;

      out.push({
        start_time: to12hFromMinutes(m),
        end_time: to12hFromMinutes(m + duration),
        start_iso: slotStartIso,
        end_iso: slotEndIso,
      });
    }

    return res.json({ data: out });
  } catch (e) {
    next(e);
  }
});

module.exports = router;