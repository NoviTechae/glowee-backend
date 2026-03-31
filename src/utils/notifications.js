// backend/src/utils/notifications.js
const db = require("../db/knex");
const { notifyUser } = require("./pushNotifications");

/**
 * إنشاء إشعار جديد (In-App + Push)
 */
async function createNotification(userId, title, body, type = null, data = null) {
  try {
    // 1️⃣ إنشاء in-app notification
    const [notification] = await db("notifications")
      .insert({
        user_id: userId,
        title,
        body,
        type,
        data: data ? JSON.stringify(data) : null,
        read: false,
        created_at: db.fn.now(),
        updated_at: db.fn.now(),
      })
      .returning(["id", "title", "body", "type", "created_at"]);

    // 2️⃣ إرسال push notification
    await notifyUser(userId, title, body, data || {});

    return notification;
  } catch (error) {
    console.error("Error creating notification:", error);
    throw error;
  }
}

/**
 * إنشاء إشعار استلام هدية
 */
async function notifyGiftReceived(userId, giftId, senderName, amount) {
  return createNotification(
    userId,
    "GLOWEE",
    `You have received a gift from ${senderName} 🎁`,
    "gift_received",
    { gift_id: giftId, sender_name: senderName, amount }
  );
}

/**
 * إنشاء إشعار تأكيد حجز
 */
async function notifyBookingConfirmed(userId, bookingId, salonName, scheduledAt) {
  const date = new Date(scheduledAt);
  const dateStr = date.toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
  });
  const timeStr = date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });

  return createNotification(
    userId,
    "Booking Confirmed",
    `Your appointment at ${salonName} is confirmed for ${dateStr} at ${timeStr}`,
    "booking_confirmed",
    { booking_id: bookingId, salon_name: salonName, scheduled_at: scheduledAt }
  );
}

/**
 * إنشاء إشعار تذكير بالموعد
 */
async function notifyBookingReminder(userId, bookingId, salonName, hoursUntil) {
  const timeText = hoursUntil === 1 ? "1 hour" : `${hoursUntil} hours`;
  
  return createNotification(
    userId,
    "Appointment Reminder",
    `Your appointment at ${salonName} is in ${timeText}!`,
    "reminder",
    { booking_id: bookingId, salon_name: salonName, hours_until: hoursUntil }
  );
}

/**
 * إنشاء إشعار إلغاء حجز
 */
async function notifyBookingCancelled(userId, bookingId, salonName, reason = null) {
  const bodyText = reason
    ? `Your appointment at ${salonName} has been cancelled. Reason: ${reason}`
    : `Your appointment at ${salonName} has been cancelled.`;

  return createNotification(
    userId,
    "Booking Cancelled",
    bodyText,
    "booking_cancelled",
    { booking_id: bookingId, salon_name: salonName, reason }
  );
}

/**
 * إنشاء إشعار عرض ترويجي
 */
async function notifyPromotion(userId, title, body, promoCode = null) {
  return createNotification(
    userId,
    title,
    body,
    "promotion",
    promoCode ? { promo_code: promoCode } : null
  );
}

/**
 * إنشاع إشعار انتهاء صلاحية هدية قريباً
 */
async function notifyGiftExpiringSoon(userId, giftId, daysRemaining) {
  return createNotification(
    userId,
    "Gift Expiring Soon",
    `Your gift will expire in ${daysRemaining} day${daysRemaining > 1 ? "s" : ""}!`,
    "gift_expiring",
    { gift_id: giftId, days_remaining: daysRemaining }
  );
}

/**
 * حذف الإشعارات القديمة (أكثر من 30 يوم)
 */
async function cleanupOldNotifications() {
  try {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const deleted = await db("notifications")
      .where("created_at", "<", thirtyDaysAgo)
      .del();

    console.log(`🗑️ Deleted ${deleted} old notifications`);
    return deleted;
  } catch (error) {
    console.error("Error cleaning up old notifications:", error);
    throw error;
  }
}

module.exports = {
  createNotification,
  notifyGiftReceived,
  notifyBookingConfirmed,
  notifyBookingReminder,
  notifyBookingCancelled,
  notifyPromotion,
  notifyGiftExpiringSoon,
  cleanupOldNotifications,
};