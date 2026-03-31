// src/controllers/bookingController.js
const knex = require("../db/knex");
const { addPoints } = require("./rewardController");
const { handleMonthlyStreak } = require("./streakController");

function calcBookingPoints(totalAed) {
  const unit = 10; // أو 15 حسب قرارك
  return Math.floor(Number(totalAed || 0) / unit);
}

async function completeBooking(bookingId) {
  const trx = await knex.transaction();

  try {
    const booking = await trx("bookings")
      .where({ id: bookingId })
      .first();

    if (!booking) {
      await trx.rollback();
      throw new Error("Booking not found");
    }

    // ✅ idempotent: لو مكتمل خلاص
    if (booking.status === "completed") {
      await trx.commit();
      return { basePoints: Number(booking.points_earned || 0), bonusPoints: 0 };
    }

    // ✅ احسب نقاط الحجز
    const basePoints = calcBookingPoints(booking.total_aed);

    // ✅ حدّث الحجز مرة وحدة (status + points)
    await trx("bookings")
      .where({ id: bookingId })
      .update({
        status: "completed",
        points_earned: basePoints,
        updated_at: trx.fn.now(),
      });

    // ✅ إضافة نقاط الحجز الأساسية مرة وحدة
    if (basePoints > 0) {
      await addPoints(booking.user_id, basePoints, "booking_completed", bookingId, trx);
    }

    // ✅ streak update
    const { bonusMultiplier } = await handleMonthlyStreak(booking.user_id, trx);
    let bonusPoints = 0;

    // ✅ bonus only once
    if (bonusMultiplier > 0 && basePoints > 0 && !booking.streak_bonus_applied) {
      bonusPoints = Math.floor(basePoints * bonusMultiplier);

      // علمي انه انصرف الستريك
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

module.exports = { completeBooking };