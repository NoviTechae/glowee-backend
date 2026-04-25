//  src/routes/adminSubscriptions.js
const router = require("express").Router();
const db = require("../db/knex");
const dashboardAuthRequired = require("../middleware/dashboardAuthRequired");

function requireAdmin(req, res, next) {
  if (req.dashboard?.role !== "admin") {
    return res.status(403).json({ error: "Admin only" });
  }
  next();
}

router.use(dashboardAuthRequired, requireAdmin);

// GET /dashboard/admin/subscriptions
router.get("/", async (req, res, next) => {
  try {
    const { search, status, plan, limit = 100 } = req.query;

    let query = db("subscriptions as sub")
      .leftJoin("salons as s", "s.id", "sub.salon_id")
      .select([
        "sub.id",
        "sub.salon_id",
        "sub.plan_code",
        "sub.plan_name",
        "sub.amount_aed",
        "sub.currency_code",
        "sub.interval_type",
        "sub.status",
        "sub.auto_renew",
        "sub.cancel_at_period_end",
        "sub.trial_ends_at",
        "sub.current_period_start",
        "sub.current_period_end",
        "sub.started_at",
        "sub.cancelled_at",
        "sub.ended_at",
        "sub.created_at",
        "s.name as salon_name",
      ])
      .orderBy("sub.created_at", "desc")
      .limit(Number(limit));

    if (status && status !== "all") {
      query = query.where("sub.status", status);
    }

    if (plan && plan !== "all") {
      query = query.where("sub.plan_code", plan);
    }

    if (search) {
      query = query.where(function () {
        this.whereILike("s.name", `%${search}%`)
          .orWhereILike("sub.plan_name", `%${search}%`)
          .orWhereILike("sub.status", `%${search}%`);
      });
    }

    const rows = await query;

    res.json({
      data: rows.map((r) => ({
        ...r,
        amount_aed: Number(r.amount_aed || 0),
        auto_renew: Boolean(r.auto_renew),
        cancel_at_period_end: Boolean(r.cancel_at_period_end),
      })),
    });
  } catch (e) {
    next(e);
  }
});

// GET /dashboard/admin/subscriptions/stats
router.get("/stats", async (req, res, next) => {
  try {
    const [{ total }] = await db("subscriptions").count("* as total");
    const [{ active }] = await db("subscriptions").where("status", "active").count("* as active");
    const [{ trial }] = await db("subscriptions").where("status", "trial").count("* as trial");
    const [{ past_due }] = await db("subscriptions").where("status", "past_due").count("* as past_due");
    const [{ cancelled }] = await db("subscriptions").where("status", "cancelled").count("* as cancelled");

    const [{ mrr }] = await db("subscriptions")
      .whereIn("status", ["active", "trial"])
      .sum("amount_aed as mrr");

    const [{ paid_total }] = await db("subscription_payments")
      .where("status", "paid")
      .sum("amount_aed as paid_total");

    res.json({
      total: Number(total || 0),
      active: Number(active || 0),
      trial: Number(trial || 0),
      past_due: Number(past_due || 0),
      cancelled: Number(cancelled || 0),
      mrr: Number(mrr || 0),
      paid_total: Number(paid_total || 0),
    });
  } catch (e) {
    next(e);
  }
});

// POST /dashboard/admin/subscriptions/:id/mark-paid
router.post("/:id/mark-paid", async (req, res, next) => {
  try {
    const { id } = req.params;
    const { months = 1, note = "Admin marked paid" } = req.body;

    const sub = await db("subscriptions").where({ id }).first();

    if (!sub) {
      return res.status(404).json({ error: "Subscription not found" });
    }

    const result = await db.transaction(async (trx) => {
      const [updated] = await trx("subscriptions")
        .where({ id })
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
          salon_id: sub.salon_id,
          provider: "manual",
          amount_aed: sub.amount_aed,
          currency_code: sub.currency_code || "AED",
          status: "paid",
          paid_at: trx.fn.now(),
          metadata: {
            source: "admin_mark_paid",
            months: Number(months),
            note,
          },
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

module.exports = router;