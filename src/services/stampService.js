// src/services/stampService.js
const db = require("../db/knex");

async function awardStampForCompletedBooking(bookingId, trxOuter = null) {
  const trx = trxOuter || await db.transaction();

  try {
    const booking = await trx("bookings")
      .where({ id: bookingId })
      .first();

    if (!booking) {
      if (!trxOuter) await trx.rollback();
      return { ok: false, error: "Booking not found" };
    }

    if (!booking.user_id || !booking.salon_id) {
      if (!trxOuter) await trx.rollback();
      return { ok: false, error: "Booking missing user_id or salon_id" };
    }

    // امنع التكرار لنفس الحجز
    const existingEvent = await trx("salon_stamp_events")
      .where({
        booking_id: bookingId,
        type: "stamp_earned",
      })
      .first();

    if (existingEvent) {
      if (!trxOuter) await trx.commit();
      return { ok: true, already_awarded: true };
    }

    // إعدادات الستامبس للصالون
    const settings = await trx("salon_stamp_settings")
      .where({
        salon_id: booking.salon_id,
        is_active: true,
      })
      .first();

    if (!settings) {
      if (!trxOuter) await trx.commit();
      return { ok: true, skipped: true, reason: "No active stamp settings" };
    }

    // جيب أو أنشئ بطاقة المستخدم لهذا الصالون
    let card = await trx("user_salon_stamp_cards")
      .where({
        user_id: booking.user_id,
        salon_id: booking.salon_id,
      })
      .first();

    if (!card) {
      const [created] = await trx("user_salon_stamp_cards")
        .insert({
          user_id: booking.user_id,
          salon_id: booking.salon_id,
          current_stamps: 0,
          available_rewards: 0,
          updated_at: trx.fn.now(),
        })
        .returning("*");

      card = created;
    }

    let currentStamps = Number(card.current_stamps || 0) + 1;
    let availableRewards = Number(card.available_rewards || 0);
    const stampsRequired = Number(settings.stamps_required || 6);

    // سجل إضافة الستامب
    await trx("salon_stamp_events").insert({
      user_id: booking.user_id,
      salon_id: booking.salon_id,
      booking_id: booking.id,
      type: "stamp_earned",
      value: 1,
      created_at: trx.fn.now(),
    });

    // إذا اكتمل الكارد: أضف reward وصفر الستامبس
    if (currentStamps >= stampsRequired) {
      availableRewards += 1;
      currentStamps = 0;

      await trx("salon_stamp_events").insert({
        user_id: booking.user_id,
        salon_id: booking.salon_id,
        booking_id: booking.id,
        type: "reward_unlocked",
        value: 1,
        created_at: trx.fn.now(),
      });
    }

    await trx("user_salon_stamp_cards")
      .where({
        user_id: booking.user_id,
        salon_id: booking.salon_id,
      })
      .update({
        current_stamps: currentStamps,
        available_rewards: availableRewards,
        updated_at: trx.fn.now(),
      });

    if (!trxOuter) await trx.commit();

    return {
      ok: true,
      user_id: booking.user_id,
      salon_id: booking.salon_id,
      current_stamps: currentStamps,
      available_rewards: availableRewards,
    };
  } catch (error) {
    if (!trxOuter) await trx.rollback();
    return {
      ok: false,
      error: error.message,
    };
  }
}

module.exports = {
  awardStampForCompletedBooking,
};