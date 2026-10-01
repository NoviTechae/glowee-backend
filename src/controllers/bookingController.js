// src/controllers/bookingController.js
const knex = require("../db/knex");
const { addPoints } = require("./rewardController");
const { handleMonthlyStreak } = require("./streakController");
const { awardStampForCompletedBooking } = require("../services/stampService");
const { hasSlotConflict } = require("../utils/bookingHold");

const calcBookingPoints = (totalAed) => Math.floor(Number(totalAed || 0) / 10);

/**
 * Marks a confirmed booking as done: points, streak bonus and a loyalty stamp.
 * Safe to call twice. Only a confirmed booking can be completed: an unpaid
 * (pending) or cancelled one can't, so it never earns a stamp or points.
 */
async function completeBooking(bookingId) {
  return knex.transaction(async (trx) => {
    const booking = await trx("bookings").where({ id: bookingId }).forUpdate().first();
    if (!booking) throw Object.assign(new Error("Booking not found"), { status: 404 });

    if (booking.status === "completed") {
      return { basePoints: Number(booking.points_earned || 0), bonusPoints: 0, already_completed: true };
    }
    if (booking.status !== "confirmed") {
      throw Object.assign(new Error("Only a confirmed booking can be marked as done"), { status: 400 });
    }

    const basePoints = calcBookingPoints(booking.total_aed);

    await trx("bookings").where({ id: bookingId }).update({
      status: "completed",
      points_earned: basePoints,
      updated_at: trx.fn.now(),
    });

    const stamp = await awardStampForCompletedBooking(bookingId, trx);
    if (!stamp.ok) throw new Error(`Stamp failed: ${stamp.error}`);

    if (basePoints > 0) await addPoints(booking.user_id, basePoints, "booking_completed", bookingId, trx);

    const { bonusMultiplier } = await handleMonthlyStreak(booking.user_id, trx);
    let bonusPoints = 0;
    if (bonusMultiplier > 0 && basePoints > 0 && !booking.streak_bonus_applied) {
      bonusPoints = Math.floor(basePoints * bonusMultiplier);
      await trx("bookings").where({ id: bookingId }).update({ streak_bonus_applied: true });
      if (bonusPoints > 0) await addPoints(booking.user_id, bonusPoints, "streak_bonus", bookingId, trx);
    }

    return { basePoints, bonusPoints, reward_unlocked: Boolean(stamp.reward_unlocked) };
  });
}

/**
 * POST /bookings/:id/confirm-gift  { gift_id }
 * Pays for a pending booking with a service gift the customer received.
 * The gift must be for this salon, still active, and worth at least the booking.
 */
async function confirmGiftBooking(req, res, next) {
  const trx = await knex.transaction();
  let open = true;
  const close = async (fn) => {
    open = false;
    await fn();
  };

  try {
    const bookingId = req.params.id;
    const userId = req.user.sub;
    const giftId = req.body?.gift_id;
    if (!giftId) {
      await close(() => trx.rollback());
      return res.status(400).json({ error: "gift_id is required" });
    }

    await trx.raw("SELECT pg_advisory_xact_lock(hashtext(?))", [`booking-payment:${bookingId}`]);

    const booking = await trx("bookings").where({ id: bookingId, user_id: userId }).forUpdate().first();
    if (!booking) {
      await close(() => trx.rollback());
      return res.status(404).json({ error: "Booking not found" });
    }
    if (booking.status !== "pending") {
      await close(() => trx.rollback());
      return res.status(400).json({ error: "This booking is already paid or closed" });
    }
    if (await hasSlotConflict(bookingId, trx)) {
      await close(() => trx.rollback());
      return res.status(409).json({ error: "This time is no longer available. Please choose another time." });
    }

    const user = await trx("users").where({ id: userId }).first("phone");
    const gift = await trx("gifts").where({ id: giftId }).forUpdate().first();

    // Same answer for "not yours" and "doesn't exist", so gift ids can't be probed.
    if (!gift || String(gift.recipient_phone) !== String(user?.phone)) {
      await close(() => trx.rollback());
      return res.status(404).json({ error: "Gift not found" });
    }
    if (gift.status !== "active") {
      await close(() => trx.rollback());
      return res.status(400).json({ error: "This gift has already been used" });
    }
    if (gift.expires_at && new Date(gift.expires_at) <= new Date()) {
      await close(() => trx.rollback());
      return res.status(400).json({ error: "This gift has expired" });
    }
    if (!gift.salon_id || gift.salon_id !== booking.salon_id) {
      await close(() => trx.rollback());
      return res.status(400).json({ error: "This gift is for a different salon" });
    }
    if (Number(gift.amount_aed) + 0.01 < Number(booking.total_aed)) {
      await close(() => trx.rollback());
      return res.status(400).json({
        error: `This gift covers AED ${Number(gift.amount_aed).toFixed(2)}, and the booking is AED ${Number(booking.total_aed).toFixed(2)}.`,
        code: "GIFT_DOES_NOT_COVER",
        gift_amount_aed: Number(gift.amount_aed),
        booking_total_aed: Number(booking.total_aed),
      });
    }

    await trx("gifts").where({ id: gift.id, status: "active" }).update({ status: "redeemed", redeemed_at: trx.fn.now() });
    await trx("bookings").where({ id: bookingId }).update({ status: "confirmed", gift_id: gift.id, updated_at: trx.fn.now() });
    await trx("payment_transactions").insert({
      user_id: userId,
      provider: "wallet", // enum has no gift provider
      type: "booking_payment",
      status: "succeeded",
      amount_aed: 0,
      fee_aed: 0,
      net_amount_aed: 0,
      booking_id: bookingId,
      gift_id: gift.id,
      payment_method_type: "gift",
      succeeded_at: trx.fn.now(),
      metadata: { gift_id: gift.id, gift_amount_aed: Number(gift.amount_aed) },
      created_at: trx.fn.now(),
      updated_at: trx.fn.now(),
    });

    await close(() => trx.commit());
    return res.json({ ok: true, booking_id: bookingId, gift_id: gift.id, status: "confirmed" });
  } catch (err) {
    if (open) {
      try {
        await trx.rollback();
      } catch {}
    }
    next(err);
  }
}

module.exports = { completeBooking, confirmGiftBooking };