// src/controllers/streakController.js
const dayjs = require("dayjs");

async function handleMonthlyStreak(userId, trx) {
  const db = trx;
  const currentMonth = dayjs().format("YYYY-MM");

  const rewardRow = await db("user_rewards").where({ user_id: userId }).first();
  if (!rewardRow) return { bonusMultiplier: 0 };

  let { monthly_streak_count, current_month_bookings, last_booking_month } = rewardRow;

  if (last_booking_month !== currentMonth) {
    if (Number(current_month_bookings || 0) === 0) {
      monthly_streak_count = 0; // ✅ يموت إذا شهر كامل بدون ولا حجز
    }
    current_month_bookings = 0;
    last_booking_month = currentMonth;
  }

  current_month_bookings = Number(current_month_bookings || 0) + 1;

  // ✅ 2 bookings بالشهر = streak +1
  if (current_month_bookings === 1) {
    monthly_streak_count = Number(monthly_streak_count || 0) + 1;
  }

  await db("user_rewards").where({ user_id: userId }).update({
    monthly_streak_count,
    current_month_bookings,
    last_booking_month,
    updated_at: db.fn.now(),
  });

  const bonusMultiplier =
    monthly_streak_count > 0 && monthly_streak_count % 5 === 0 ? 0.5 : 0;

  return { bonusMultiplier };
}

module.exports = { handleMonthlyStreak };