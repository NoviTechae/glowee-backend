//src/routes/meBookings.tsx
const router = require("express").Router();
const db = require("../db/knex");

// مؤقت: نفس userId اللي تستخدمينه في إنشاء الحجز
const TEMP_USER_ID = 1;

// ✅ كل حجوزاتي
router.get("/me/bookings", async (req, res, next) => {
    try {
        const rows = await db("bookings as b")
            .leftJoin("salons as s", "s.id", "b.salon_id")
            .leftJoin("branches as br", "br.id", "b.branch_id")
            .where("b.user_id", TEMP_USER_ID)
            .select([
                "b.id",
                "b.status",
                "b.mode",
                "b.scheduled_at",
                "b.total_aed",
                "s.name as salon_name",
                "br.name as branch_name",
            ])
            .orderBy("b.scheduled_at", "desc");

        return res.json({ data: rows });
    } catch (e) {
        next(e);
    }
});

// ✅ Recent completed bookings for Home (with items for reorder)
router.get("/me/bookings-recent", async (req, res, next) => {
  try {
    const limit = Math.min(Number(req.query.limit || 8), 20);

    const bookings = await db("bookings as b")
      .leftJoin("salons as s", "s.id", "b.salon_id")
      .leftJoin("branches as br", "br.id", "b.branch_id")
      .where("b.user_id", TEMP_USER_ID)
      .whereIn("b.status", ["completed", "done"])
      .select([
        "b.id",
        "b.status",
        "b.mode",
        "b.scheduled_at",
        "b.total_aed",
        "b.salon_id",
        "b.branch_id",
        "s.name as salon_name",
        "s.logo_url as salon_logo",
        "br.area as branch_area",
        "br.city as branch_city",
      ])
      .orderBy("b.scheduled_at", "desc")
      .limit(limit);

    const ids = bookings.map((x) => x.id);

    let items = [];
    if (ids.length) {
      items = await db("booking_items")
        .whereIn("booking_id", ids)
        .select([
          "booking_id",
          "service_availability_id",
          "service_name",
          "qty",
          "unit_price_aed",
          "duration_mins",
        ]);
    }

    const data = bookings.map((b) => ({
      ...b,
      items: items
        .filter((it) => String(it.booking_id) === String(b.id))
        .map((it) => ({
          service_availability_id: it.service_availability_id,
          service_name: it.service_name,
          qty: Number(it.qty || 1),
          unit_price_aed: Number(it.unit_price_aed || 0),
          duration_mins: Number(it.duration_mins || 0),
        })),
    }));

    return res.json({ data });
  } catch (e) {
    next(e);
  }
});

// ✅ تفاصيل حجز واحد
router.get("/me/bookings/:bookingId", async (req, res, next) => {
    try {
        const { bookingId } = req.params;

        const booking = await db("bookings as b")
            .leftJoin("salons as s", "s.id", "b.salon_id")
            .leftJoin("branches as br", "br.id", "b.branch_id")
            .where("b.id", bookingId)
            .andWhere("b.user_id", TEMP_USER_ID)
            .first([
                "b.id",
                "b.status",
                "b.mode",
                "b.scheduled_at",
                "b.subtotal_aed",
                "b.fees_aed",
                "b.total_aed",
                "b.customer_note",
                "b.salon_id",
                "b.branch_id",
                "s.name as salon_name",
                "br.name as branch_name",
            ]);

        if (!booking) return res.status(404).json({ error: "Booking not found" });

        const items = await db("booking_items")
            .where({ booking_id: bookingId })
            .select([
                "id",
                "service_availability_id", // ✅ مهم للـ reschedule
                "service_name",
                "qty",
                "unit_price_aed",
                "line_total_aed",
                "duration_mins",
            ])
        // ✅ staff name (اختياري)
        const staffRow = await db("booking_item_assignments as bia")
            .join("staff as st", "st.id", "bia.staff_id")
            .where("bia.booking_id", bookingId)
            .first(db.raw("st.name as staff_name"));

        // ✅ ends_at (اختياري)
        const endRow = await db("booking_item_assignments as bia")
            .where("bia.booking_id", bookingId)
            .orderBy("bia.ends_at", "desc")
            .first("bia.ends_at");

        return res.json({
            ok: true,
            data: {
                ...booking,
                staff_name: staffRow?.staff_name ?? null,
                ends_at: endRow?.ends_at ?? null,
                items,
            },
        });
    } catch (e) {
        next(e);
    }
});

// ✅ إلغاء حجز
router.post("/me/bookings/:bookingId/cancel", async (req, res, next) => {
    try {
        const { bookingId } = req.params;

        const row = await db("bookings")
            .where({ id: bookingId, user_id: TEMP_USER_ID })
            .first(["id", "status"]);

        if (!row) return res.status(404).json({ error: "Booking not found" });

        // ما نلغي لو مكتمل أو ملغي
        if (row.status === "completed") {
            return res.status(400).json({ error: "Completed booking cannot be cancelled" });
        }
        if (row.status === "cancelled") {
            return res.json({ ok: true, status: "cancelled" });
        }

        const [updated] = await db("bookings")
            .where({ id: bookingId, user_id: TEMP_USER_ID })
            .update({
                status: "cancelled",
                updated_at: db.fn.now(),
            })
            .returning(["id", "status"]);

        return res.json({ ok: true, booking: updated });
    } catch (e) {
        next(e);
    }
});

// ✅ تغيير وقت الحجز (Reschedule)
router.post("/me/bookings/:bookingId/reschedule", async (req, res, next) => {
  const trx = await db.transaction();
  try {
    const { bookingId } = req.params;
    const { start_iso, staff_id } = req.body || {};

    if (!start_iso) return res.status(400).json({ error: "Missing start_iso" });

    const start = new Date(String(start_iso));
    if (Number.isNaN(start.getTime())) return res.status(400).json({ error: "Invalid start_iso" });

    // 1) booking + منع reschedule لو cancelled/completed
    const booking = await trx("bookings")
      .where({ id: bookingId, user_id: TEMP_USER_ID })
      .first(["id", "status", "mode", "salon_id", "branch_id"]);

    if (!booking) {
      await trx.rollback();
      return res.status(404).json({ error: "Booking not found" });
    }
    if (booking.status === "cancelled") {
      await trx.rollback();
      return res.status(400).json({ error: "Cancelled booking cannot be rescheduled" });
    }
    if (booking.status === "completed") {
      await trx.rollback();
      return res.status(400).json({ error: "Completed booking cannot be rescheduled" });
    }

    const salonId = booking.salon_id;
    const branchId = booking.branch_id;

    // 2) items (نحتاج availability + qty + duration)
    const items = await trx("booking_items")
      .where({ booking_id: bookingId })
      .select(["service_availability_id", "qty", "duration_mins"]);

    if (!items.length) {
      await trx.rollback();
      return res.status(400).json({ error: "Booking has no items" });
    }

    const totalDuration = items.reduce((sum, it) => sum + Number(it.duration_mins || 0) * Number(it.qty || 1), 0);
    const end = new Date(start.getTime() + totalDuration * 60 * 1000);

    // 3) ساعات عمل الفرع
    const dow = start.getDay();
    const hourRow = await trx("branch_hours")
      .where({ branch_id: branchId, day_of_week: dow })
      .first();

    if (!hourRow || hourRow.is_closed) {
      await trx.rollback();
      return res.status(400).json({ error: "Branch is closed on that day" });
    }

    // نفس الدوال اللي عندك
    function parseHHMMToMinutes(t) {
      if (!t) return null;
      const [h, m] = String(t).split(":").map(Number);
      if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
      return h * 60 + m;
    }
    function withinWorkingHours(open_time, close_time, startDate, endDate) {
      const openM = parseHHMMToMinutes(open_time);
      const closeM = parseHHMMToMinutes(close_time);
      if (openM == null || closeM == null) return false;

      const sM = startDate.getHours() * 60 + startDate.getMinutes();
      const eM = endDate.getHours() * 60 + endDate.getMinutes();

      if (closeM < openM) {
        const startOk = sM >= openM || sM <= closeM;
        const endOk = eM >= openM || eM <= closeM;
        return startOk && endOk;
      }
      return sM >= openM && eM <= closeM;
    }

    if (!withinWorkingHours(hourRow.open_time, hourRow.close_time, start, end)) {
      await trx.rollback();
      return res.status(400).json({ error: "Selected time is outside working hours" });
    }

    // 4) منع تضارب الموظفة (اعتبري status active)
    const ACTIVE_STATUSES = ["pending", "confirmed"];

    async function staffIsFree(staffId) {
      const overlap = await trx("booking_item_assignments as bia")
        .join("booking_items as bi", "bi.id", "bia.booking_item_id")
        .join("bookings as b", "b.id", "bi.booking_id")
        .where("bia.staff_id", staffId)
        .andWhere("bia.branch_id", branchId)
        .whereIn("b.status", ACTIVE_STATUSES)
        .andWhere("b.id", "<>", bookingId) // ✅ تجاهل نفس الحجز الحالي
        .andWhere("bia.starts_at", "<", end.toISOString())
        .andWhere("bia.ends_at", ">", start.toISOString())
        .first("bia.id");

      return !overlap;
    }

    // staff_id اختياري — لو null بنخلي نفس staff الحالي لو متاح، أو نختار أول متاح
    let chosenStaffId = staff_id ?? null;

    if (!chosenStaffId) {
      const current = await trx("booking_item_assignments")
        .where({ booking_id: bookingId })
        .first(["staff_id"]);
      if (current?.staff_id) chosenStaffId = current.staff_id;
    }

    if (chosenStaffId) {
      const ok = await trx("staff")
        .where({ id: chosenStaffId, salon_id: salonId, branch_id: branchId, is_active: true })
        .first("id");
      if (!ok) chosenStaffId = null;
      else {
        const free = await staffIsFree(chosenStaffId);
        if (!free) chosenStaffId = null;
      }
    }

    if (!chosenStaffId) {
      const candidates = await trx("staff")
        .where({ salon_id: salonId, branch_id: branchId, is_active: true })
        .select(["id"])
        .orderBy("created_at", "desc");

      let found = null;
      for (const c of candidates) {
        if (await staffIsFree(c.id)) { found = c.id; break; }
      }
      if (!found) {
        await trx.rollback();
        return res.status(400).json({ error: "No staff available for that time" });
      }
      chosenStaffId = found;
    }

    // 5) تحديث booking + assignments (نفس start/end لكل items)
    await trx("bookings")
      .where({ id: bookingId, user_id: TEMP_USER_ID })
      .update({
        scheduled_at: start.toISOString(),
        updated_at: trx.fn.now(),
      });

    await trx("booking_item_assignments")
      .where({ booking_id: bookingId })
      .update({
        staff_id: chosenStaffId,
        starts_at: start.toISOString(),
        ends_at: end.toISOString(),
      });

    await trx.commit();
    return res.json({
      ok: true,
      booking_id: bookingId,
      staff_id: chosenStaffId,
      scheduled_at: start.toISOString(),
      ends_at: end.toISOString(),
    });
  } catch (e) {
    try { await trx.rollback(); } catch {}
    next(e);
  }
});

module.exports = router;