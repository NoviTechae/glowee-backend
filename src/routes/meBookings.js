const router = require("express").Router();
const db = require("../db/knex");

// مؤقت
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

    if (!booking) {
      return res.status(404).json({ error: "Booking not found" });
    }

    const itemsRaw = await db("booking_items")
      .where({ booking_id: bookingId })
      .select([
        "id",
        "service_availability_id",
        "service_name_snapshot",
        "qty",
        "price_aed_snapshot",
        "line_total_aed",
        "duration_mins",
      ]);

    const items = itemsRaw.map((it) => ({
      id: it.id,
      service_availability_id: it.service_availability_id,
      service_name: it.service_name_snapshot,
      qty: Number(it.qty || 1),
      unit_price_aed: Number(it.price_aed_snapshot || 0),
      line_total_aed: Number(it.line_total_aed || 0),
      duration_mins: Number(it.duration_mins || 0),
    }));

    const staffRow = await db("booking_item_assignments as bia")
      .join("staff as st", "st.id", "bia.staff_id")
      .where("bia.booking_id", bookingId)
      .first(db.raw("st.name as staff_name"));

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

// ✅ حذف عنصر من الحجز قبل الدفع
router.delete("/me/bookings/:bookingId/items/:itemId", async (req, res, next) => {
  const trx = await db.transaction();

  try {
    const { bookingId, itemId } = req.params;

    const booking = await trx("bookings")
      .where({ id: bookingId, user_id: TEMP_USER_ID })
      .first([
        "id",
        "status",
        "subtotal_aed",
        "fees_aed",
        "total_aed",
      ]);

    if (!booking) {
      await trx.rollback();
      return res.status(404).json({ error: "Booking not found" });
    }

    if (booking.status !== "pending") {
      await trx.rollback();
      return res.status(400).json({ error: "Only pending bookings can be edited" });
    }

    const item = await trx("booking_items")
      .where({ id: itemId, booking_id: bookingId })
      .first([
        "id",
        "line_total_aed",
      ]);

    if (!item) {
      await trx.rollback();
      return res.status(404).json({ error: "Booking item not found" });
    }

    await trx("booking_item_assignments")
      .where({ booking_item_id: itemId, booking_id: bookingId })
      .delete();

    await trx("booking_items")
      .where({ id: itemId, booking_id: bookingId })
      .delete();

    const remainingItems = await trx("booking_items")
      .where({ booking_id: bookingId })
      .select(["line_total_aed"]);

    if (!remainingItems.length) {
      await trx("bookings")
        .where({ id: bookingId, user_id: TEMP_USER_ID })
        .update({
          status: "cancelled",
          subtotal_aed: 0,
          total_aed: 0,
          updated_at: trx.fn.now(),
        });

      await trx.commit();
      return res.json({
        ok: true,
        booking_deleted: true,
        message: "All items removed. Booking cancelled.",
      });
    }

    const newSubtotal = remainingItems.reduce(
      (sum, it) => sum + Number(it.line_total_aed || 0),
      0
    );

    const fees = Number(booking.fees_aed || 0);
    const newTotal = newSubtotal + fees;

    await trx("bookings")
      .where({ id: bookingId, user_id: TEMP_USER_ID })
      .update({
        subtotal_aed: newSubtotal,
        total_aed: newTotal,
        updated_at: trx.fn.now(),
      });

    const updatedBooking = await trx("bookings")
      .where({ id: bookingId, user_id: TEMP_USER_ID })
      .first([
        "id",
        "subtotal_aed",
        "fees_aed",
        "total_aed",
        "status",
      ]);

    await trx.commit();

    return res.json({
      ok: true,
      booking_deleted: false,
      booking: updatedBooking,
    });
  } catch (e) {
    try {
      await trx.rollback();
    } catch {}
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

module.exports = router;