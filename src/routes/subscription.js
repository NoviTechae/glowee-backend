// src/routes/subscription.js
const express = require("express");
const router = express.Router();
const db = require("../db/knex");
const dashboardAuthRequired = require("../middleware/dashboardAuthRequired");
const { createSubscriptionPaymentIntent } = require("../services/ziina");

function requireSalon(req, res, next) {
  if (req.dashboard?.role !== "salon") {
    return res.status(403).json({ error: "Salon only" });
  }
  next();
}

function getSalonId(req) {
  return req.dashboard?.salon_id || req.dashboard?.salonId;
}

router.use(dashboardAuthRequired, requireSalon);

// GET /dashboard/salon/subscription
router.get("/", async (req, res, next) => {
  try {
    const salonId = getSalonId(req);

    if (!salonId) {
      return res.status(400).json({
        error: "Salon account is not linked to a salon",
      });
    }

    const subscription = await db("subscriptions")
      .where({ salon_id: salonId })
      .orderBy("created_at", "desc")
      .first();

    const plans = await db("subscription_plans")
      .where({ is_active: true })
      .orderBy("sort_order", "asc")
      .select([
        "id",
        "code",
        "name",
        "price_aed",
        "currency_code",
        "interval_type",
        "description",
        "features",
      ]);

    const payments = subscription
      ? await db("subscription_payments")
        .where({ subscription_id: subscription.id })
        .orderBy("created_at", "desc")
        .limit(10)
      : [];

    const paymentMethod = await db("subscription_payment_methods")
      .where({ salon_id: salonId, is_default: true })
      .first();

    res.json({
      subscription: subscription
        ? {
          ...subscription,
          amount_aed: Number(subscription.amount_aed || 0),
        }
        : null,

      plans: plans.map((p) => ({
        ...p,
        price_aed: Number(p.price_aed || 0),
        features: Array.isArray(p.features) ? p.features : [],
      })),

      payments: payments.map((p) => ({
        ...p,
        amount_aed: Number(p.amount_aed || 0),
      })),

      payment_method: paymentMethod || null,
    });
  } catch (e) {
    next(e);
  }
});

// POST /dashboard/salon/subscription/start-trial
router.post("/start-trial", async (req, res, next) => {
  try {
    const salonId = getSalonId(req);
    const { plan_code = "basic", trial_days = 30 } = req.body;

    if (!salonId) {
      return res.status(400).json({
        error: "Salon account is not linked to a salon",
      });
    }

    const existing = await db("subscriptions")
      .where({ salon_id: salonId })
      .first();

    if (existing) {
      return res.status(400).json({
        error: "Subscription already exists",
      });
    }

    const plan = await db("subscription_plans")
      .where({ code: plan_code, is_active: true })
      .first();

    if (!plan) {
      return res.status(404).json({ error: "Plan not found" });
    }

    const [created] = await db("subscriptions")
      .insert({
        salon_id: salonId,
        provider: "manual",
        plan_code: plan.code,
        plan_name: plan.name,
        amount_aed: plan.price_aed,
        currency_code: plan.currency_code || "AED",
        interval_type: plan.interval_type || "month",
        status: "trial",
        auto_renew: false,
        trial_starts_at: db.fn.now(),
        trial_ends_at: db.raw(`NOW() + INTERVAL '${Number(trial_days)} days'`),
        current_period_start: db.fn.now(),
        current_period_end: db.raw(`NOW() + INTERVAL '${Number(trial_days)} days'`),
        started_at: db.fn.now(),
        metadata: JSON.stringify({
          source: "dashboard",
          trial_days: Number(trial_days),
        }),
      })
      .returning("*");

    res.json({ ok: true, subscription: created });
  } catch (e) {
    next(e);
  }
});

// POST /dashboard/salon/subscription/change-plan
router.post("/change-plan", async (req, res, next) => {
  try {
    const salonId = getSalonId(req);
    const { plan_code } = req.body;

    if (!salonId) {
      return res.status(400).json({
        error: "Salon account is not linked to a salon",
      });
    }

    const plan = await db("subscription_plans")
      .where({ code: plan_code, is_active: true })
      .first();

    if (!plan) {
      return res.status(404).json({ error: "Plan not found" });
    }

    const [updated] = await db("subscriptions")
      .where({ salon_id: salonId })
      .update({
        plan_code: plan.code,
        plan_name: plan.name,
        amount_aed: plan.price_aed,
        currency_code: plan.currency_code || "AED",
        interval_type: plan.interval_type || "month",
        updated_at: db.fn.now(),
      })
      .returning("*");

    if (!updated) {
      return res.status(404).json({ error: "Subscription not found" });
    }

    res.json({ ok: true, subscription: updated });
  } catch (e) {
    next(e);
  }
});

// POST /dashboard/salon/subscription/mark-paid
router.post("/mark-paid", async (req, res, next) => {
  try {
    const salonId = getSalonId(req);
    const { months = 1, provider_payment_id = null } = req.body;

    if (!salonId) {
      return res.status(400).json({
        error: "Salon account is not linked to a salon",
      });
    }

    const sub = await db("subscriptions")
      .where({ salon_id: salonId })
      .orderBy("created_at", "desc")
      .first();

    if (!sub) {
      return res.status(404).json({ error: "Subscription not found" });
    }

    const result = await db.transaction(async (trx) => {
      const [updated] = await trx("subscriptions")
        .where({ id: sub.id })
        .update({
          status: "active",
          auto_renew: true,
          cancel_at_period_end: false,
          current_period_start: trx.fn.now(),
          current_period_end: trx.raw(`NOW() + INTERVAL '${Number(months)} months'`),
          cancelled_at: null,
          ended_at: null,
          updated_at: trx.fn.now(),
        })
        .returning("*");

      const [payment] = await trx("subscription_payments")
        .insert({
          subscription_id: sub.id,
          salon_id: salonId,
          provider: sub.provider || "manual",
          provider_payment_id,
          amount_aed: sub.amount_aed,
          currency_code: sub.currency_code || "AED",
          status: "paid",
          paid_at: trx.fn.now(),
          metadata: JSON.stringify({
            source: "dashboard_mark_paid",
            months: Number(months),
          }),
        })
        .returning("*");

      return { updated, payment };
    });

    res.json({
      ok: true,
      subscription: result.updated,
      payment: result.payment,
    });
  } catch (e) {
    next(e);
  }
});

// POST /dashboard/salon/subscription/pay-now
router.post("/pay-now", async (req, res, next) => {
  try {
    const salonId = getSalonId(req);

    if (!salonId) {
      return res.status(400).json({
        error: "Salon account is not linked to a salon",
      });
    }

    const sub = await db("subscriptions")
      .where({ salon_id: salonId })
      .orderBy("created_at", "desc")
      .first();

    if (!sub) {
      return res.status(404).json({ error: "Subscription not found" });
    }

    if (sub.status === "active" && !sub.cancel_at_period_end) {
      return res.status(400).json({
        error: "Subscription is already active",
      });
    }

    const result = await createSubscriptionPaymentIntent({
      subscriptionId: sub.id,
      salonId,
      amountAed: Number(sub.amount_aed || 0),
      planName: sub.plan_name,
    });

    if (!result.ok) {
      return res.status(400).json({ error: result.error || "Payment failed" });
    }

    res.json({
      ok: true,
      payment_url: result.payment_url,
      payment_id: result.payment_id,
    });
  } catch (e) {
    next(e);
  }
});

// POST /dashboard/salon/subscription/cancel
router.post("/cancel", async (req, res, next) => {
  try {
    const salonId = getSalonId(req);

    if (!salonId) {
      return res.status(400).json({
        error: "Salon account is not linked to a salon",
      });
    }

    const [updated] = await db("subscriptions")
      .where({ salon_id: salonId })
      .update({
        auto_renew: false,
        cancel_at_period_end: true,
        cancelled_at: db.fn.now(),
        updated_at: db.fn.now(),
      })
      .returning("*");

    if (!updated) {
      return res.status(404).json({ error: "Subscription not found" });
    }

    res.json({ ok: true, subscription: updated });
  } catch (e) {
    next(e);
  }
});

// POST /dashboard/salon/subscription/reactivate
router.post("/reactivate", async (req, res, next) => {
  try {
    const salonId = getSalonId(req);

    if (!salonId) {
      return res.status(400).json({
        error: "Salon account is not linked to a salon",
      });
    }

    const [updated] = await db("subscriptions")
      .where({ salon_id: salonId })
      .update({
        auto_renew: true,
        cancel_at_period_end: false,
        cancelled_at: null,
        ended_at: null,
        updated_at: db.fn.now(),
      })
      .returning("*");

    if (!updated) {
      return res.status(404).json({ error: "Subscription not found" });
    }

    res.json({ ok: true, subscription: updated });
  } catch (e) {
    next(e);
  }
});

module.exports = router;