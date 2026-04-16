// routes/testSms.js
const express = require("express");
const router = express.Router();
const { sendGiftSms } = require("../services/sms");

router.get("/test-sms", async (req, res) => {
  const result = await sendGiftSms("+971558198862", {
    receiverName: "meme",
    senderName: "Glowee",
    giftLink: "https://glowee.novitech.ae/gift/test123",
    expiryText: "20 Apr 2026",
  });

  res.json(result);
});

module.exports = router;