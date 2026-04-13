// backend/src/routes/notifications.js
const router = require("express").Router();
const db = require("../db/knex");
const authRequired = require("../middleware/authRequired");

// GET /notifications
router.get("/", authRequired, async (req, res, next) => {
  try {
    const userId = req.user.sub || req.user.id;

    const notifications = await db("notifications")
      .where({ user_id: userId })
      .orderBy("created_at", "desc")
      .limit(50)
      .select(["id", "title", "body", "type", "data", "read", "created_at"]);

    return res.json({
      ok: true,
      data: notifications,
    });
  } catch (error) {
    console.error("Error fetching notifications:", error);
    next(error);
  }
});

// GET /notifications/unread-count
router.get("/unread-count", authRequired, async (req, res, next) => {
  try {
    const userId = req.user.sub || req.user.id;

    const [{ count }] = await db("notifications")
      .where({ user_id: userId, read: false })
      .count("* as count");

    return res.json({
      ok: true,
      count: Number(count || 0),
    });
  } catch (error) {
    console.error("Error fetching unread count:", error);
    next(error);
  }
});

// POST /notifications/read-all
router.post("/read-all", authRequired, async (req, res, next) => {
  try {
    const userId = req.user.sub || req.user.id;

    await db("notifications")
      .where({ user_id: userId, read: false })
      .update({
        read: true,
        updated_at: db.fn.now(),
      });

    return res.json({ ok: true, message: "All notifications marked as read" });
  } catch (error) {
    console.error("Error marking all as read:", error);
    next(error);
  }
});

// POST /notifications/:id/read
router.post("/:id/read", authRequired, async (req, res, next) => {
  try {
    const userId = req.user.sub || req.user.id;
    const { id } = req.params;

    const notification = await db("notifications").where({ id, user_id: userId }).first();

    if (!notification) {
      return res.status(404).json({ ok: false, error: "Notification not found" });
    }

    await db("notifications").where({ id, user_id: userId }).update({
      read: true,
      updated_at: db.fn.now(),
    });

    return res.json({ ok: true, message: "Notification marked as read" });
  } catch (error) {
    console.error("Error marking notification as read:", error);
    next(error);
  }
});

// DELETE /notifications/:id
router.delete("/:id", authRequired, async (req, res, next) => {
  try {
    const userId = req.user.sub || req.user.id;
    const { id } = req.params;

    const deleted = await db("notifications").where({ id, user_id: userId }).del();

    if (deleted === 0) {
      return res.status(404).json({ ok: false, error: "Notification not found" });
    }

    return res.json({ ok: true, message: "Notification deleted" });
  } catch (error) {
    console.error("Error deleting notification:", error);
    next(error);
  }
});

module.exports = router;