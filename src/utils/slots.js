// src/utils/slots.js
// Free appointment times, worked out the same way everywhere:
// the app's time picker, the staff preview, and when a booking is created.
//
// All times are UAE time (Asia/Dubai, UTC+4, no daylight saving), whatever
// timezone the server runs in.

const { PAYMENT_HOLD_MINUTES } = require("./bookingHold");

const DUBAI_OFFSET_MIN = 4 * 60;
const MIN_LEAD_MINUTES = 15; // no bookings that start in the next 15 minutes

// ---------- UAE time helpers ----------

/** "2026-10-05" + 600 (minutes after midnight, UAE) -> Date */
function dubaiDate(dateKey, minutes) {
  const [Y, M, D] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(Y, M - 1, D, 0, 0, 0) + (minutes - DUBAI_OFFSET_MIN) * 60000);
}

/** Day of week of a "YYYY-MM-DD" date (0 = Sunday), same numbering as branch_hours. */
function dayOfWeekForDateKey(dateKey) {
  const [Y, M, D] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(Y, M - 1, D)).getUTCDay();
}

/** A Date seen in UAE time: { dateKey, minutes, dow } */
function inDubai(date) {
  const shifted = new Date(date.getTime() + DUBAI_OFFSET_MIN * 60000);
  const dateKey = shifted.toISOString().slice(0, 10);
  return { dateKey, minutes: shifted.getUTCHours() * 60 + shifted.getUTCMinutes(), dow: shifted.getUTCDay() };
}

function hhmmToMinutes(t) {
  if (!t) return null;
  const [h, m] = String(t).split(":").map(Number);
  return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : null;
}

function minutesToLabel(mins) {
  const h = Math.floor(mins / 60) % 24;
  const m = mins % 60;
  const hh = h % 12 === 0 ? 12 : h % 12;
  return `${hh}:${String(m).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`;
}

const minutesToHHMMSS = (mins) => `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}:00`;

// ---------- What a booking needs ----------

/**
 * Checks the cart against the branch and returns its total duration and the
 * services a team member must be able to do. items: [{ availability_id, qty }]
 */
async function cartRequirements(db, { salonId, branchId, mode, items }) {
  const ids = items.map((i) => i.availability_id);
  const rows = await db("service_availability as sa")
    .join("services as s", "s.id", "sa.service_id")
    .whereIn("sa.id", ids)
    .where("sa.branch_id", branchId)
    .where("s.salon_id", salonId)
    .modify((q) => {
      if (mode) q.where("sa.mode", mode);
    })
    .where("sa.is_active", true)
    .where("s.is_active", true)
    .select(["sa.id", "sa.duration_mins", "sa.service_id"]);

  if (rows.length !== new Set(ids).size) return null;

  const byId = new Map(rows.map((r) => [r.id, r]));
  const duration = items.reduce((sum, i) => sum + Number(byId.get(i.availability_id).duration_mins || 0) * Math.max(1, Number(i.qty || 1)), 0);
  return { duration, serviceIds: [...new Set(rows.map((r) => r.service_id))] };
}

/** Active team members of the branch who can do every one of these services. */
async function qualifiedStaff(db, { salonId, branchId, serviceIds, staffId = null }) {
  return db("staff as st")
    .join("branch_staff as bs", "bs.staff_id", "st.id")
    .join("staff_services as ss", "ss.staff_id", "st.id")
    .where("st.salon_id", salonId)
    .where("st.is_active", true)
    .where("bs.branch_id", branchId)
    .where("bs.is_active", true)
    .whereIn("ss.service_id", serviceIds)
    .modify((q) => {
      if (staffId) q.where("st.id", staffId);
    })
    .groupBy("st.id", "st.name", "st.created_at")
    .havingRaw("COUNT(DISTINCT ss.service_id) = ?", [serviceIds.length])
    .orderBy("st.created_at", "asc")
    .select(["st.id", "st.name"]);
}

/**
 * Everything that makes staff busy on one UAE day: bookings that hold a slot
 * (confirmed, or unpaid for less than the payment hold) and blocked time.
 * Returns { byStaff: Map(staffId -> [[start, end] ms]), wholeBranch: [[start, end]] }.
 */
async function busyForDay(db, { branchId, staffIds, dateKey, excludeBookingId = null }) {
  const dayStart = dubaiDate(dateKey, 0);
  const dayEnd = dubaiDate(dateKey, 24 * 60);
  const byStaff = new Map(staffIds.map((id) => [id, []]));
  const wholeBranch = [];

  if (staffIds.length) {
    const rows = await db("booking_item_assignments as bia")
      .join("bookings as b", "b.id", "bia.booking_id")
      .whereIn("bia.staff_id", staffIds)
      .where("bia.starts_at", "<", dayEnd.toISOString())
      .where("bia.ends_at", ">", dayStart.toISOString())
      .where(function () {
        this.where("b.status", "confirmed").orWhere(function () {
          this.where("b.status", "pending").andWhereRaw(`b.created_at > now() - interval '${PAYMENT_HOLD_MINUTES} minutes'`);
        });
      })
      .modify((q) => {
        if (excludeBookingId) q.whereNot("b.id", excludeBookingId);
      })
      .select(["bia.staff_id", "bia.starts_at", "bia.ends_at"]);
    for (const r of rows) byStaff.get(r.staff_id)?.push([new Date(r.starts_at).getTime(), new Date(r.ends_at).getTime()]);
  }

  const blocks = await db("blocked_time_slots")
    .where({ branch_id: branchId, blocked_date: dateKey })
    .select(["staff_id", "start_time", "end_time"]);
  for (const bl of blocks) {
    const s = hhmmToMinutes(bl.start_time);
    const e = hhmmToMinutes(bl.end_time);
    if (s == null || e == null || e <= s) continue;
    const span = [dubaiDate(dateKey, s).getTime(), dubaiDate(dateKey, e).getTime()];
    if (!bl.staff_id) wholeBranch.push(span);
    else byStaff.get(bl.staff_id)?.push(span);
  }

  return { byStaff, wholeBranch };
}

const overlaps = (spans, s, e) => spans.some(([bs, be]) => s < be && e > bs);

/** First qualified team member free for [start, end), or null. */
function pickFreeStaff(staff, busy, startMs, endMs) {
  if (overlaps(busy.wholeBranch, startMs, endMs)) return null;
  return staff.find((st) => !overlaps(busy.byStaff.get(st.id) || [], startMs, endMs)) || null;
}

/**
 * Free start times on a UAE day for a booking that takes `duration` minutes
 * and needs these services. Returns [{ startMin, endMin, start, end, freeStaff }].
 */
async function freeSlots(db, { salonId, branchId, dateKey, duration, serviceIds, staffId = null, step = 30, now = new Date() }) {
  const hours = await db("branch_hours").where({ branch_id: branchId, day_of_week: dayOfWeekForDateKey(dateKey) }).first();
  if (!hours || hours.is_closed) return { slots: [], reason: "closed" };

  const open = hhmmToMinutes(hours.open_time);
  const close = hhmmToMinutes(hours.close_time);
  if (open == null || close == null || close <= open) return { slots: [], reason: "closed" };

  const staff = await qualifiedStaff(db, { salonId, branchId, serviceIds, staffId });
  if (!staff.length) return { slots: [], reason: staffId ? "staff_unavailable" : "no_staff" };

  const busy = await busyForDay(db, { branchId, staffIds: staff.map((s) => s.id), dateKey });

  const earliest = now.getTime() + MIN_LEAD_MINUTES * 60000;
  const slots = [];
  for (let m = open; m + duration <= close; m += step) {
    const start = dubaiDate(dateKey, m);
    const end = dubaiDate(dateKey, m + duration);
    if (start.getTime() < earliest) continue;
    if (overlaps(busy.wholeBranch, start.getTime(), end.getTime())) continue;
    const free = staff.filter((st) => !overlaps(busy.byStaff.get(st.id) || [], start.getTime(), end.getTime()));
    if (free.length) slots.push({ startMin: m, endMin: m + duration, start, end, freeStaff: free, totalStaff: staff.length });
  }
  return { slots, reason: slots.length ? null : "full" };
}

module.exports = {
  MIN_LEAD_MINUTES,
  dubaiDate,
  dayOfWeekForDateKey,
  inDubai,
  hhmmToMinutes,
  minutesToLabel,
  minutesToHHMMSS,
  cartRequirements,
  qualifiedStaff,
  busyForDay,
  pickFreeStaff,
  freeSlots,
};