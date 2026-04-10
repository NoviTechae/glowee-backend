// src/routes/meAccount.js
const router = require("express").Router();
const db = require("../db/knex");
const authRequired = require("../middleware/authRequired");

router.post("/me/request-delete", authRequired, async (req, res, next) => {
  try {
    const userId = req.user.sub;

    const now = new Date();
    const scheduled = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    await db("users")
      .where({ id: userId })
      .update({
        pending_deletion: true,
        deletion_requested_at: now,
        deletion_scheduled_at: scheduled,
        is_active: false,
        updated_at: db.fn.now(),
      });

    res.json({
      ok: true,
      pending_deletion: true,
      deletion_scheduled_at: scheduled,
    });
  } catch (e) {
    next(e);
  }
});

router.post("/me/cancel-delete", authRequired, async (req, res, next) => {
  try {
    const userId = req.user.sub;

    await db("users")
      .where({ id: userId })
      .update({
        pending_deletion: false,
        deletion_requested_at: null,
        deletion_scheduled_at: null,
        is_active: true,
        updated_at: db.fn.now(),
      });

    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

router.get("/me/delete-status", authRequired, async (req, res, next) => {
  try {
    const userId = req.user.sub;

    const user = await db("users")
      .where({ id: userId })
      .first([
        "pending_deletion",
        "deletion_requested_at",
        "deletion_scheduled_at",
      ]);

    if (!user) return res.status(404).json({ error: "User not found" });

    res.json(user);
  } catch (e) {
    next(e);
  }
});

module.exports = router;