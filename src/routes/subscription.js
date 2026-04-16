// src/routes/subscription.js
const express = require("express");
const router = express.Router();

// middleware auth (نفس اللي تستخدمه في dashboard)
const dashboardAuthRequired = require("../middleware/dashboardAuthRequired");

// =========================
// GET current subscription
// =========================
router.get("/dashboard/salon/subscription", dashboardAuthRequired, async (req, res) => {
  try {
    // مؤقت (بعدين نربطه DB)
    res.json({
      plan: "basic",
      status: "active",
      current_period_end: "2026-05-16",
      auto_renew: true,
    });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch subscription" });
  }
});

// =========================
// SUBSCRIBE
// =========================
router.post("/dashboard/salon/subscription/subscribe", dashboardAuthRequired, async (req, res) => {
  try {
    const { plan } = req.body;

    // هنا لاحقًا تربط Tap
    res.json({
      ok: true,
      message: `Subscribed to ${plan}`,
    });
  } catch (err) {
    res.status(500).json({ error: "Subscription failed" });
  }
});

// =========================
// CANCEL
// =========================
router.post("/dashboard/salon/subscription/cancel", dashboardAuthRequired, async (req, res) => {
  try {
    res.json({
      ok: true,
      message: "Subscription cancelled",
    });
  } catch (err) {
    res.status(500).json({ error: "Cancel failed" });
  }
});

module.exports = router;