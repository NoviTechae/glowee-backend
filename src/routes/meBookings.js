// src/routes/meBookings.js
const router = require("express").Router();
const db = require("../db/knex");
const authRequired = require("../middleware/authRequired");

// ✅ كل حجوزاتي
router.get("/me/bookings", authRequired, async (req, res, next) => {
  try {
    const rows = await db("bookings as b")
      .leftJoin("salons as s", "s.id", "b.salon_id")
      .leftJoin("branches as br", "br.id", "b.branch_id")
      .where("b.user_id", req.user.sub)
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
router.get("/me/bookings/:bookingId", authRequired, async (req, res, next) => {
  try {
    const { bookingId } = req.params;

    const booking = await db("bookings as b")
      .leftJoin("salons as s", "s.id", "b.salon_id")
      .leftJoin("branches as br", "br.id", "b.branch_id")
      .where("b.id", bookingId)
      .andWhere("b.user_id", req.user.sub)
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

    const rating = await db("booking_ratings")
      .where({ booking_id: booking.id })
      .first("id");

    const itemsRaw = await db("booking_items as bi")
      .leftJoin("service_availability as sa", "sa.id", "bi.service_availability_id")
      .leftJoin("services as s", "s.id", "bi.service_id")
      .where("bi.booking_id", bookingId)
      .select([
        "bi.id",
        "bi.service_id",
        "bi.service_availability_id",
        "bi.qty",
        "bi.line_total_aed",
        "bi.duration_mins",
        "bi.service_name_snapshot",
        "bi.price_aed_snapshot",
        "s.image_url as service_image_url",
      ]);

    const items = itemsRaw.map((it) => ({
      id: it.id,
      service_id: it.service_id,
      service_availability_id: it.service_availability_id,
      service_name: it.service_name_snapshot,
      unit_price_aed: Number(it.price_aed_snapshot || 0),
      qty: Number(it.qty || 1),
      duration_mins: Number(it.duration_mins || 0),
      line_total_aed: Number(it.line_total_aed || 0),
      image_url: it.service_image_url || null,
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
        is_rated: !!rating,
        staff_name: staffRow?.staff_name ?? null,
        ends_at: endRow?.ends_at ?? null,
        items,
      },
    });
  } catch (e) {
    next(e);
  }
});

router.patch("/me/bookings/:bookingId/items/:itemId", authRequired, async (req, res, next) => {
  const trx = await db.transaction();

  try {
    const { bookingId, itemId } = req.params;
    const qty = Number(req.body?.qty);

    if (!Number.isInteger(qty) || qty < 0 || qty > 20) {
      await trx.rollback();
      return res.status(400).json({ error: "Invalid qty" });
    }

    const booking = await trx("bookings")
      .where({ id: bookingId, user_id: req.user.sub })
      .first(["id", "status", "fees_aed"]);

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
        "qty",
        "price_aed_snapshot",
        "duration_min_snapshot",
        "duration_mins",
      ]);

    if (!item) {
      await trx.rollback();
      return res.status(404).json({ error: "Booking item not found" });
    }

    if (qty === 0) {
      await trx("booking_item_assignments")
        .where({ booking_item_id: itemId, booking_id: bookingId })
        .delete();

      await trx("booking_items")
        .where({ id: itemId, booking_id: bookingId })
        .delete();
    } else {
      const unitPrice = Number(item.price_aed_snapshot || 0);
      const duration = Number(item.duration_min_snapshot || item.duration_mins || 0);
      const lineTotal = unitPrice * qty;

      await trx("booking_items")
        .where({ id: itemId, booking_id: bookingId })
        .update({
          qty,
          duration_mins: duration,
          line_total_aed: lineTotal,
        });
    }

    const remainingItems = await trx("booking_items")
      .where({ booking_id: bookingId })
      .select(["line_total_aed", "qty", "duration_mins"]);

    if (!remainingItems.length) {
      await trx("bookings")
        .where({ id: bookingId, user_id: req.user.sub })
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
      });
    }

    const newSubtotal = remainingItems.reduce(
      (sum, it) => sum + Number(it.line_total_aed || 0),
      0
    );

    const newDuration = remainingItems.reduce(
      (sum, it) => sum + Number(it.qty || 0) * Number(it.duration_mins || 0),
      0
    );

    const fees = Number(booking.fees_aed || 0);
    const newTotal = newSubtotal + fees;

    await trx("bookings")
      .where({ id: bookingId, user_id: req.user.sub })
      .update({
        subtotal_aed: newSubtotal,
        total_aed: newTotal,
        updated_at: trx.fn.now(),
      });

    await trx.commit();

    return res.json({
      ok: true,
      booking_deleted: false,
      totals: {
        subtotal_aed: newSubtotal,
        total_aed: newTotal,
        duration_mins: newDuration,
      },
    });
  } catch (e) {
    try {
      await trx.rollback();
    } catch {}
    next(e);
  }
});

// ✅ إلغاء حجز
router.post("/me/bookings/:bookingId/cancel", authRequired, async (req, res, next) => {
  try {
    const { bookingId } = req.params;

    const row = await db("bookings")
      .where({ id: bookingId, user_id: req.user.sub })
      .first(["id", "status"]);

    if (!row) return res.status(404).json({ error: "Booking not found" });

    if (row.status === "completed") {
      return res.status(400).json({ error: "Completed booking cannot be cancelled" });
    }

    if (row.status === "cancelled") {
      return res.json({ ok: true, status: "cancelled" });
    }

    const [updated] = await db("bookings")
      .where({ id: bookingId, user_id: req.user.sub })
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