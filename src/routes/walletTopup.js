// src/routes/walletTopup.js
const router = require("express").Router();
const authRequired = require("../middleware/authRequired");
const { addWalletBalance } = require("../controllers/walletController");

router.post("/topup", authRequired, async (req, res, next) => {
  try {
    const amount = Number(req.body.amount_aed);
    if (!amount || amount <= 0) return res.status(400).json({ error: "Invalid amount" });

    await addWalletBalance(req.user.sub, amount, "Wallet topup", null, "topup");

    // ✅ reward rule: Wallet topup 100+ => 20 points
    // هنا نضيفها بعد ما نخلص rewards controller مضبوط
    // if (amount >= 100) await addPoints(req.user.sub, 20, "wallet_topup_100", null);

    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

module.exports = router;