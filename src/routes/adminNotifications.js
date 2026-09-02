// backend/src/routes/adminNotifications.js

const router = require("express").Router();
const db = require("../db/knex");
const dashboardAuthRequired = require("../middleware/dashboardAuthRequired");
const { createNotification } = require("../utils/notifications");

function requireAdmin(req, res, next) {
  if (req.dashboard?.role !== "admin") {
    return res.status(403).json({ error: "Admin only" });
  }

  next();
}

router.use(dashboardAuthRequired, requireAdmin);

// POST /dashboard/admin/notifications/send
router.post("/send", async (req, res, next) => {
  try {
    const {
      title,
      body,
      targetType,
      userId,
      segment,
      type,
      data,
    } = req.body;

    const cleanTitle = String(title || "").trim();
    const cleanBody = String(body || "").trim();

    if (!cleanTitle || !cleanBody) {
      return res.status(400).json({
        error: "Title and body are required",
      });
    }

    if (cleanTitle.length > 60) {
      return res.status(400).json({
        error: "Title must be 60 characters or less",
      });
    }

    if (cleanBody.length > 160) {
      return res.status(400).json({
        error: "Body must be 160 characters or less",
      });
    }

    let userIds = [];

    switch (targetType) {
      case "all": {
        const users = await db("users")
          .select("id")
          .orderBy("id", "asc");

        userIds = users.map((user) => user.id);
        break;
      }

      case "specific_user": {
        if (!userId) {
          return res.status(400).json({
            error: "User ID is required",
          });
        }

        const user = await db("users")
          .where({ id: userId })
          .first("id");

        if (!user) {
          return res.status(404).json({
            error: "User not found",
          });
        }

        userIds = [user.id];
        break;
      }

      case "user_segment": {
        if (!segment) {
          return res.status(400).json({
            error: "Segment is required",
          });
        }

        userIds = await getUsersBySegment(segment);
        break;
      }

      default:
        return res.status(400).json({
          error: "Invalid target type",
        });
    }

    userIds = [...new Set(userIds)];

    if (userIds.length === 0) {
      return res.status(400).json({
        error: "No users found for this audience",
      });
    }

    let savedCount = 0;

    for (const id of userIds) {
      await createNotification(
        id,
        cleanTitle,
        cleanBody,
        type || "general",
        data || null
      );

      savedCount += 1;
    }

    console.log(
      `✅ Admin notification created for ${savedCount} users`
    );

    res.json({
      ok: true,
      count: savedCount,
      message: `Notification created for ${savedCount} users`,
    });
  } catch (error) {
    console.error(
      "Error sending admin notifications:",
      error
    );

    next(error);
  }
});

async function getUsersBySegment(segment) {
  switch (segment) {
    case "active_users": {
      const sevenDaysAgo = new Date();

      sevenDaysAgo.setDate(
        sevenDaysAgo.getDate() - 7
      );

      const users = await db("users")
        .whereNotNull("last_login")
        .where(
          "last_login",
          ">=",
          sevenDaysAgo
        )
        .select("id");

      return users.map((user) => user.id);
    }

    case "inactive_users": {
      const thirtyDaysAgo = new Date();

      thirtyDaysAgo.setDate(
        thirtyDaysAgo.getDate() - 30
      );

      const users = await db("users")
        .whereNotNull("last_login")
        .where(
          "last_login",
          "<",
          thirtyDaysAgo
        )
        .select("id");

      return users.map((user) => user.id);
    }

    case "with_bookings": {
      const users = await db("users")
        .join(
          "bookings",
          "users.id",
          "bookings.user_id"
        )
        .distinct("users.id");

      return users.map((user) => user.id);
    }

    case "with_gifts": {
      const users = await db("users")
        .join(
          "gifts",
          "users.phone",
          "gifts.recipient_phone"
        )
        .distinct("users.id");

      return users.map((user) => user.id);
    }

    case "with_streak": {
      const users = await db("users")
        .join(
          "user_rewards",
          "users.id",
          "user_rewards.user_id"
        )
        .where(
          "user_rewards.streak_count",
          ">",
          0
        )
        .distinct("users.id");

      return users.map((user) => user.id);
    }

    default:
      return [];
  }
}

module.exports = router;