// backend/src/routes/adminNotifications.js
const router = require("express").Router();
const db = require("../db/knex");
const dashboardAuthRequired = require("../middleware/dashboardAuthRequired");
const { createNotification } = require("../utils/notifications");

// POST /dashboard/admin/notifications/send
router.post("/send", dashboardAuthRequired, async (req, res, next) => {
  try {
    const { title, body, targetType, userId, segment, type, data } = req.body;

    if (!title || !body) {
      return res.status(400).json({ error: "Title and body are required" });
    }

    let userIds = [];

    switch (targetType) {
      case "all":
        const allUsers = await db("users")
          .whereNotNull("push_token")
          .select("id");
        userIds = allUsers.map((u) => u.id);
        break;

      case "specific_user":
        if (!userId) {
          return res.status(400).json({ error: "User ID is required" });
        }
        userIds = [userId];
        break;

      case "user_segment":
        userIds = await getUsersBySegment(segment);
        break;

      default:
        return res.status(400).json({ error: "Invalid target type" });
    }

    if (userIds.length === 0) {
      return res.status(400).json({ error: "No users found" });
    }

    // إرسال الإشعارات
    for (const id of userIds) {
      await createNotification(id, title, body, type, data);
    }

    console.log(`✅ Sent notifications to ${userIds.length} users`);

    res.json({
      ok: true,
      count: userIds.length,
      message: `Notifications sent to ${userIds.length} users`,
    });
  } catch (error) {
    console.error("Error sending notifications:", error);
    next(error);
  }
});

async function getUsersBySegment(segment) {
  let query;

  switch (segment) {
    case "active_users":
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      query = db("users")
        .where("created_at", ">=", sevenDaysAgo)
        .whereNotNull("push_token");
      break;

    case "inactive_users":
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      query = db("users")
        .where("created_at", "<", thirtyDaysAgo)
        .whereNotNull("push_token");
      break;

    case "with_bookings":
      query = db("users")
        .join("bookings", "users.id", "bookings.user_id")
        .whereNotNull("users.push_token")
        .groupBy("users.id");
      break;

    case "with_gifts":
      query = db("users")
        .join("gifts", "users.id", "gifts.receiver_id")
        .whereNotNull("users.push_token")
        .groupBy("users.id");
      break;

    case "with_streak":
      query = db("users")
        .whereNotNull("push_token")
        .where("streak_count", ">", 0);
      break;

    default:
      return [];
  }

  const users = await query.select("users.id");
  return users.map((u) => u.id);
}

module.exports = router;