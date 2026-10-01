// src/routes/wallet.js
const express = require("express");
const router = express.Router();
const authRequired = require("../middleware/authRequired");
const { getWalletSummary, getWalletHistory, getSalonStampRewards } = require("../controllers/walletController");

// GET /wallet/summary
router.get("/summary", authRequired, getWalletSummary);

// GET /wallet/history?page=1&limit=20
router.get("/history", authRequired, getWalletHistory);

// GET /wallet/stamp-rewards?salon_id=...  (loyalty rewards the customer can use at this salon)
router.get("/stamp-rewards", authRequired, getSalonStampRewards);

module.exports = router;