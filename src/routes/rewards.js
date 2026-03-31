// src/routes/rewards.js
const router = require("express").Router();
const authRequired = require("../middleware/authRequired");
const rewardController = require("../controllers/rewardController");

router.get("/summary", authRequired, rewardController.getRewardsSummary);
router.post("/convert", authRequired, rewardController.convertPoints);

router.get("/transactions", authRequired, rewardController.getRewardsTransactions);

module.exports = router;