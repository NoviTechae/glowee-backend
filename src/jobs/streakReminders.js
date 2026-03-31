// backend/src/jobs/streakReminders.js
const db = require("../db/knex");
const { createNotification } = require("../utils/notifications");

/**
 * تذكير المستخدمين بالـ streak اللي بينتهي
 * يشتغل كل 12 ساعة
 */
async function sendStreakReminders() {
  try {
    // جلب المستخدمين اللي عندهم streak وما حجزوا اليوم
    const usersWithStreak = await db("users as u")
      .leftJoin("bookings as b", function() {
        this.on("u.id", "=", "b.user_id")
          .andOn(db.raw("DATE(b.created_at) = CURRENT_DATE"));
      })
      .where("u.streak_count", ">", 0)
      .whereNull("b.id") // ما حجز اليوم
      .whereNotNull("u.push_token")
      .select([
        "u.id",
        "u.name",
        "u.streak_count",
      ]);

    console.log(`🔥 Found ${usersWithStreak.length} users with streak to remind`);

    for (const user of usersWithStreak) {
      await createNotification(
        user.id,
        "Don't Break Your Streak! 🔥",
        `You have a ${user.streak_count}-day streak! Book a service today to keep it going.`,
        "streak_reminder",
        { streak_count: user.streak_count }
      );
    }

    console.log(`✅ Sent ${usersWithStreak.length} streak reminders`);
  } catch (error) {
    console.error("❌ Error sending streak reminders:", error);
  }
}

// ✅ تشغيل كل 12 ساعة
setInterval(sendStreakReminders, 12 * 60 * 60 * 1000);

// تشغيل أول مرة
sendStreakReminders();

module.exports = { sendStreakReminders };