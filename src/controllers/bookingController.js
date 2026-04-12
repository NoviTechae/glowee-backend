const knex = require("../db/knex");
const { addPoints } = require("./rewardController");
const { handleMonthlyStreak } = require("./streakController");

function calcBookingPoints(totalAed) {
  const unit = 10;
  return Math.floor(Number(totalAed || 0) / unit);
}

async function completeBooking(bookingId) {
  const trx = await knex.transaction();

  try {
    const booking = await trx("bookings").where({ id: bookingId }).first();

    if (!booking) {
      await trx.rollback();
      throw new Error("Booking not found");
    }

    if (booking.status === "completed") {
      await trx.commit();
      return { basePoints: Number(booking.points_earned || 0), bonusPoints: 0 };
    }

    const basePoints = calcBookingPoints(booking.total_aed);

    await trx("bookings").where({ id: bookingId }).update({
      status: "completed",
      points_earned: basePoints,
      updated_at: trx.fn.now(),
    });

    if (basePoints > 0) {
      await addPoints(booking.user_id, basePoints, "booking_completed", bookingId, trx);
    }

    const { bonusMultiplier } = await handleMonthlyStreak(booking.user_id, trx);
    let bonusPoints = 0;

    if (bonusMultiplier > 0 && basePoints > 0 && !booking.streak_bonus_applied) {
      bonusPoints = Math.floor(basePoints * bonusMultiplier);

      await trx("bookings")
        .where({ id: bookingId })
        .update({ streak_bonus_applied: true });

      if (bonusPoints > 0) {
        await addPoints(booking.user_id, bonusPoints, "streak_bonus", bookingId, trx);
      }
    }

    await trx.commit();
    return { basePoints, bonusPoints };
  } catch (e) {
    await trx.rollback();
    throw e;
  }
}

async function confirmGiftBooking(req, res, next) {
  const trx = await knex.transaction();

  try {
    const bookingId = req.params.id;
    const userId = req.user.sub || req.user.id;
    const { gift_id } = req.body;

    if (!gift_id) {
      await trx.rollback();
      return res.status(400).json({ error: "gift_id is required" });
    }

    const booking = await trx("bookings")
      .where({ id: bookingId, user_id: userId })
      .first();

    if (!booking) {
      await trx.rollback();
      return res.status(404).json({ error: "Booking not found" });
    }

    const gift = await trx("gifts").where({ id: gift_id }).first();

    if (!gift) {
      await trx.rollback();
      return res.status(404).json({ error: "Gift not found" });
    }

    if (String(gift.recipient_phone) !== String(req.user.phone)) {
      await trx.rollback();
      return res.status(403).json({ error: "This gift does not belong to you" });
    }

    if (gift.status !== "active") {
      await trx.rollback();
      return res.status(400).json({ error: "Gift is not active" });
    }

    if (gift.expires_at && new Date(gift.expires_at) <= new Date()) {
      await trx.rollback();
      return res.status(400).json({ error: "Gift has expired" });
    }

    await trx("bookings")
      .where({ id: bookingId })
      .update({
        status: "confirmed",
        updated_at: trx.fn.now(),
      });

    await trx("gifts")
      .where({ id: gift_id })
      .update({
        status: "redeemed",
        redeemed_at: trx.fn.now(),
      });

    await trx.commit();

    return res.json({
      ok: true,
      booking_id: bookingId,
      gift_id,
    });
  } catch (err) {
    await trx.rollback();
    next(err);
  }
}

module.exports = {
  completeBooking,
  confirmGiftBooking,
};