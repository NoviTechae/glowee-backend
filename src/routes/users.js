// backend/src/routes/users.js
const router = require("express").Router();
const db = require("../db/knex");
const authRequired = require("../middleware/authRequired");

// POST /users/push-token - Save user's push notification token
router.post("/push-token", authRequired, async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const { push_token } = req.body;

    if (!push_token) {
      return res.status(400).json({ 
        ok: false, 
        error: "Push token is required" 
      });
    }

    // Validate Expo push token format
    if (!push_token.startsWith('ExponentPushToken[') && 
        !push_token.startsWith('ExpoPushToken[')) {
      return res.status(400).json({ 
        ok: false, 
        error: "Invalid push token format" 
      });
    }

    // حفظ أو تحديث الـ token
    await db("users")
      .where({ id: userId })
      .update({
        push_token,
        push_token_updated_at: db.fn.now(),
      });

    console.log(`✅ Push token saved for user ${userId}`);

    res.json({ 
      ok: true, 
      message: "Push token saved successfully" 
    });
  } catch (error) {
    console.error("Error saving push token:", error);
    next(error);
  }
});

// DELETE /users/push-token - Remove push token (عند logout)
router.delete("/push-token", authRequired, async (req, res, next) => {
  try {
    const userId = req.user.sub;

    await db("users")
      .where({ id: userId })
      .update({
        push_token: null,
        push_token_updated_at: db.fn.now(),
      });

    console.log(`✅ Push token removed for user ${userId}`);

    res.json({ 
      ok: true, 
      message: "Push token removed successfully" 
    });
  } catch (error) {
    console.error("Error removing push token:", error);
    next(error);
  }
});

module.exports = router;