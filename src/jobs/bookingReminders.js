// backend/src/jobs/bookingReminders.js
const db = require("../db/knex");
const { notifyBookingReminder } = require("../utils/notifications");

/**
 * إرسال تذكيرات للحجوزات القادمة
 * يشتغل كل ساعة ويبحث عن الحجوزات اللي بعد ساعتين
 */
async function sendBookingReminders() {
  try {
    const now = new Date();
    const twoHoursLater = new Date(now.getTime() + 2 * 60 * 60 * 1000);

    // جلب الحجوزات اللي بعد ساعتين تقريباً
    const upcomingBookings = await db("bookings as b")
      .join("salons as s", "s.id", "b.salon_id")
      .join("users as u", "u.id", "b.user_id")
      .where("b.status", "confirmed")
      .whereBetween("b.scheduled_at", [now, twoHoursLater])
      .whereNotNull("u.push_token")
      .select([
        "b.id",
        "b.user_id",
        "b.scheduled_at",
        "s.name as salon_name",
      ]);

    console.log(`📅 Found ${upcomingBookings.length} bookings to remind`);

    for (const booking of upcomingBookings) {
      await notifyBookingReminder(
        booking.user_id,
        booking.id,
        booking.salon_name,
        2 // hours until
      );
    }

    console.log(`✅ Sent ${upcomingBookings.length} booking reminders`);
  } catch (error) {
    console.error("❌ Error sending booking reminders:", error);
  }
}

// ✅ تشغيل الـ job كل ساعة
setInterval(sendBookingReminders, 60 * 60 * 1000); // كل ساعة

// تشغيل أول مرة عند بدء السيرفر
sendBookingReminders();

module.exports = { sendBookingReminders };