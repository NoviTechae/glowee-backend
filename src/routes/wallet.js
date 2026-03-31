// src/routes/wallet.js
const express = require("express");
const router = express.Router();

const {
  getWalletSummary,
  getWalletHistory,
} = require("../controllers/walletController");

const { topupWallet } = require("../controllers/walletTopupController");

// ⬇️ غيّري هذا حسب مشروعك
const authRequired = require("../middleware/authRequired");

// GET /wallet/summary
router.get("/summary", authRequired, getWalletSummary);

// GET /wallet/history?page=1&limit=20
router.get("/history", authRequired, getWalletHistory);

router.post("/topup", authRequired, topupWallet); // ✅ NEW


module.exports = router;