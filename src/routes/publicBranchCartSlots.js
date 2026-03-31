const router = require("express").Router();
const db = require("../db/knex");

function parseHHMMToMinutes(t) {
  if (!t) return null;
  const [h, m] = String(t).split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  return h * 60 + m;
}

function minutesToDate(dateObj, minsFromMidnight) {
  const d = new Date(dateObj);
  d.setHours(0, 0, 0, 0);
  d.setMinutes(minsFromMidnight);
  return d;
}

function toTimeLabel(d) {
  // "10:00 AM"
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
}

router.get("/:salonId/branches/:branchId/slots", async (req, res, next) => {
  try {
    const { salonId, branchId } = req.params;

    const date = String(req.query.date || "");
    const mode = String(req.query.mode || "in_salon");
    const step = Math.max(5, Number(req.query.step || 15));
    const duration = Math.max(5, Number(req.query.duration || 30));

    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: "Invalid date. Use YYYY-MM-DD" });
    }
    if (!["in_salon", "home"].includes(mode)) {
      return res.status(400).json({ error: "Invalid mode" });
    }

    // ✅ تأكد الفرع تابع للصالون
    const branch = await db("branches").where({ id: branchId, salon_id: salonId }).first("id");
    if (!branch) return res.status(404).json({ error: "Branch not found" });

    const dayDate = new Date(`${date}T00:00:00`);
    const dow = dayDate.getDay();

    const h = await db("branch_hours").where({ branch_id: branchId, day_of_week: dow }).first();
    if (!h || h.is_closed) return res.json({ data: [] });

    const openM = parseHHMMToMinutes(h.open_time);
    const closeM = parseHHMMToMinutes(h.close_time);
    if (openM == null || closeM == null) return res.json({ data: [] });

    // ✅ نعتبر نفس جدول ساعات الفرع للهوم سيرفس حالياً
    // (إذا تبين جدول منفصل للهوم لاحقاً نسويه بسهولة)

    // ✅ handle overnight
    const overnight = closeM < openM;

    // bookings overlap from booking_item_assignments
    // overlap condition: starts_at < candidateEnd AND ends_at > candidateStart
    async function isFree(startISO, endISO) {
      const row = await db("booking_item_assignments as bia")
        .where("bia.branch_id", branchId)
        .andWhere("bia.starts_at", "<", endISO)
        .andWhere("bia.ends_at", ">", startISO)
        .first("bia.id");
      return !row;
    }

    const results = [];

    // generate candidates for that day only.
    // If overnight: we allow from open->24:00 AND 00:00->close
    const dayStart = new Date(`${date}T00:00:00`);
    const dayEnd = new Date(`${date}T23:59:59`);

    async function pushIfFree(startMin) {
      const startAt = minutesToDate(dayStart, startMin);
      const endAt = new Date(startAt.getTime() + duration * 60 * 1000);

      // ensure endAt is within same day window OR fits overnight logic
      // Here: we only allow slots whose startAt is on the chosen date,
      // and endAt can go past midnight ONLY if overnight hours.
      if (!overnight) {
        const closeAt = minutesToDate(dayStart, closeM);
        if (endAt > closeAt) return;
      } else {
        // overnight: if start in open->24:00, allow end up to 24:00 + close
        const closeAtNext = minutesToDate(dayStart, 24 * 60 + closeM);
        const endAtOver = endAt.getTime() < dayStart.getTime()
          ? new Date(endAt.getTime() + 24 * 60 * 60 * 1000)
          : endAt;
        if (endAtOver > closeAtNext) return;
      }

      const startISO = startAt.toISOString();
      const endISO = endAt.toISOString();

      const ok = await isFree(startISO, endISO);
      if (!ok) return;

      results.push({
        start_time: toTimeLabel(startAt),
        end_time: toTimeLabel(endAt),
        start_iso: startISO,
        end_iso: endISO,
      });
    }

    if (!overnight) {
      // normal
      for (let m = openM; m + duration <= closeM; m += step) {
        // لا نطلع 13/14/15.. لأن اللابل AM/PM
        await pushIfFree(m);
      }
    } else {
      // overnight
      for (let m = openM; m < 24 * 60; m += step) {
        await pushIfFree(m);
      }
      for (let m = 0; m + duration <= closeM; m += step) {
        await pushIfFree(m);
      }
    }

    return res.json({ data: results });
  } catch (e) {
    next(e);
  }
});

module.exports = router;