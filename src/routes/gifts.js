// backend/src/routes/gifts.js
const router = require("express").Router();
const authRequired = require("../middleware/authRequired");
const giftController = require("../controllers/giftController");

// ✅ Inbox: كل الهدايا اللي وصلتني (active + redeemed + expired optional)
router.get("/received-cards", authRequired, giftController.getReceivedCards);

// ✅ Available: اللي اقدر استخدمها الحين فقط (active + not expired)
router.get("/available", authRequired, giftController.getAvailableGifts);

// ✅ History (sent by me): تبويب received/redeemed
router.get("/sent", authRequired, giftController.getSentGifts);

// ✅ تفاصيل هدية
router.get("/:id", authRequired, giftController.getGiftById);

// // ✅ Redeem
// router.post("/:id/redeem", authRequired, giftController.redeemGift);

// ✅ ارسال هدية
router.post("/send", authRequired, giftController.sendGift);

router.post("/:id/seen", authRequired, giftController.markGiftSeen);

module.exports = router;