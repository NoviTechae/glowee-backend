// src/routes/adminPayments.js
const router = require("express").Router();
const db = require("../db/knex");
const dashboardAuthRequired = require("../middleware/dashboardAuthRequired");

function requireAdmin(req, res, next) {
  if (req.dashboard?.role !== "admin") {
    return res.status(403).json({ error: "Admin only" });
  }
  next();
}

router.use(dashboardAuthRequired);
router.use(requireAdmin);

// GET /dashboard/admin/payments/stats
router.get("/stats", async (req, res, next) => {
  try {
    const [{ total_revenue }] = await db("payment_transactions")
      .where("status", "succeeded")
      .sum("amount_aed as total_revenue");

    const [{ today_revenue }] = await db("payment_transactions")
      .where("status", "succeeded")
      .whereRaw("DATE(created_at) = CURRENT_DATE")
      .sum("amount_aed as today_revenue");

    const [{ month_revenue }] = await db("payment_transactions")
      .where("status", "succeeded")
      .whereRaw("DATE_TRUNC('month', created_at) = DATE_TRUNC('month', CURRENT_DATE)")
      .sum("amount_aed as month_revenue");

    const [{ successful_payments }] = await db("payment_transactions")
      .where("status", "succeeded")
      .count("* as successful_payments");

    const [{ failed_payments }] = await db("payment_transactions")
      .where("status", "failed")
      .count("* as failed_payments");

    const [{ refunded_amount }] = await db("payment_transactions")
      .where("status", "refunded")
      .sum("amount_aed as refunded_amount");

    res.json({
      total_revenue: Number(total_revenue || 0),
      today_revenue: Number(today_revenue || 0),
      month_revenue: Number(month_revenue || 0),
      successful_payments: Number(successful_payments || 0),
      failed_payments: Number(failed_payments || 0),
      refunded_amount: Number(refunded_amount || 0),
    });
  } catch (e) {
    next(e);
  }
});

// GET /dashboard/admin/payments
router.get("/", async (req, res, next) => {
  try {
    const {
      search,
      status,
      provider,
      type,
      from,
      to,
      limit = 100,
    } = req.query;

    let query = db("payment_transactions as pt")
      .leftJoin("users as u", "u.id", "pt.user_id")
      .leftJoin("bookings as b", "b.id", "pt.booking_id")
      .leftJoin("salons as s", "s.id", "b.salon_id")
      .select([
        "pt.id",
        "pt.user_id",
        "pt.provider",
        "pt.type",
        "pt.status",
        "pt.amount_aed",
        "pt.fee_aed",
        "pt.net_amount_aed",
        "pt.provider_payment_id",
        "pt.provider_customer_id",
        "pt.payment_method_type",
        "pt.card_last4",
        "pt.card_brand",
        "pt.booking_id",
        "pt.gift_id",
        "pt.wallet_transaction_id",
        "pt.error_message",
        "pt.error_code",
        "pt.created_at",
        "pt.succeeded_at",
        "pt.failed_at",
        "pt.refunded_at",
        "u.name as user_name",
        "u.phone as user_phone",
        "u.email as user_email",
        "s.name as salon_name",
      ])
      .orderBy("pt.created_at", "desc")
      .limit(Number(limit));

    if (search) {
      query = query.where(function () {
        this.whereILike("pt.id", `%${search}%`)
          .orWhereILike("pt.provider_payment_id", `%${search}%`)
          .orWhereILike("u.name", `%${search}%`)
          .orWhereILike("u.phone", `%${search}%`)
          .orWhereILike("u.email", `%${search}%`)
          .orWhereILike("s.name", `%${search}%`);
      });
    }

    if (status && status !== "all") {
      query = query.where("pt.status", status);
    }

    if (provider && provider !== "all") {
      query = query.where("pt.provider", provider);
    }

    if (type && type !== "all") {
      query = query.where("pt.type", type);
    }

    if (from) {
      query = query.whereRaw("DATE(pt.created_at) >= ?", [from]);
    }

    if (to) {
      query = query.whereRaw("DATE(pt.created_at) <= ?", [to]);
    }

    const rows = await query;

    res.json({
      data: rows.map((row) => ({
        ...row,
        amount_aed: Number(row.amount_aed || 0),
        fee_aed: Number(row.fee_aed || 0),
        net_amount_aed: Number(row.net_amount_aed || 0),
      })),
    });
  } catch (e) {
    next(e);
  }
});

// GET /dashboard/admin/payments/:id
router.get("/:id", async (req, res, next) => {
  try {
    const { id } = req.params;

    const payment = await db("payment_transactions as pt")
      .leftJoin("users as u", "u.id", "pt.user_id")
      .leftJoin("bookings as b", "b.id", "pt.booking_id")
      .leftJoin("salons as s", "s.id", "b.salon_id")
      .leftJoin("branches as br", "br.id", "b.branch_id")
      .select([
        "pt.*",
        "u.name as user_name",
        "u.phone as user_phone",
        "u.email as user_email",
        "s.name as salon_name",
        "br.name as branch_name",
        "b.scheduled_at as booking_scheduled_at",
        "b.status as booking_status",
      ])
      .where("pt.id", id)
      .first();

    if (!payment) {
      return res.status(404).json({ error: "Payment not found" });
    }

    res.json({
      payment: {
        ...payment,
        amount_aed: Number(payment.amount_aed || 0),
        fee_aed: Number(payment.fee_aed || 0),
        net_amount_aed: Number(payment.net_amount_aed || 0),
      },
    });
  } catch (e) {
    next(e);
  }
});

// POST /dashboard/admin/payments/:id/refund
router.post("/:id/refund", async (req, res, next) => {
  try {
    const { id } = req.params;

    const payment = await db("payment_transactions")
      .where({ id })
      .first();

    if (!payment) {
      return res.status(404).json({ error: "Payment not found" });
    }

    if (payment.status !== "succeeded") {
      return res.status(400).json({
        error: "Only succeeded payments can be refunded",
      });
    }

    // placeholder for future Tap refund integration
    await db("payment_transactions")
      .where({ id })
      .update({
        status: "refunded",
        refunded_at: db.fn.now(),
        updated_at: db.fn.now(),
      });

    res.json({
      ok: true,
      message: "Payment marked as refunded",
    });
  } catch (e) {
    next(e);
  }
});

// GET /dashboard/admin/payments/export
router.get("/export", async (req, res, next) => {
  try {
    const {
      search,
      status,
      provider,
      type,
      from,
      to,
    } = req.query;

    let query = db("payment_transactions as pt")
      .leftJoin("users as u", "u.id", "pt.user_id")
      .leftJoin("bookings as b", "b.id", "pt.booking_id")
      .leftJoin("salons as s", "s.id", "b.salon_id")
      .select([
        "pt.id",
        "pt.provider",
        "pt.type",
        "pt.status",
        "pt.amount_aed",
        "pt.fee_aed",
        "pt.net_amount_aed",
        "pt.provider_payment_id",
        "pt.payment_method_type",
        "pt.card_last4",
        "pt.card_brand",
        "pt.booking_id",
        "pt.gift_id",
        "pt.wallet_transaction_id",
        "pt.error_message",
        "pt.error_code",
        "pt.created_at",
        "pt.succeeded_at",
        "pt.failed_at",
        "pt.refunded_at",
        "u.name as user_name",
        "u.phone as user_phone",
        "u.email as user_email",
        "s.name as salon_name",
      ])
      .orderBy("pt.created_at", "desc");

    if (search) {
      query = query.where(function () {
        this.whereILike("pt.id", `%${search}%`)
          .orWhereILike("pt.provider_payment_id", `%${search}%`)
          .orWhereILike("u.name", `%${search}%`)
          .orWhereILike("u.phone", `%${search}%`)
          .orWhereILike("u.email", `%${search}%`)
          .orWhereILike("s.name", `%${search}%`);
      });
    }

    if (status && status !== "all") {
      query = query.where("pt.status", status);
    }

    if (provider && provider !== "all") {
      query = query.where("pt.provider", provider);
    }

    if (type && type !== "all") {
      query = query.where("pt.type", type);
    }

    if (from) {
      query = query.whereRaw("DATE(pt.created_at) >= ?", [from]);
    }

    if (to) {
      query = query.whereRaw("DATE(pt.created_at) <= ?", [to]);
    }

    const rows = await query;

    const escapeCsv = (value) => {
      if (value === null || value === undefined) return "";
      const str = String(value).replace(/"/g, '""');
      return `"${str}"`;
    };

    const headers = [
      "Transaction ID",
      "User Name",
      "User Phone",
      "User Email",
      "Salon",
      "Provider",
      "Type",
      "Status",
      "Amount AED",
      "Fee AED",
      "Net Amount AED",
      "Payment Method",
      "Card Brand",
      "Card Last4",
      "Provider Payment ID",
      "Booking ID",
      "Gift ID",
      "Wallet Transaction ID",
      "Error Message",
      "Error Code",
      "Created At",
      "Succeeded At",
      "Failed At",
      "Refunded At",
    ];

    const csvRows = rows.map((row) => [
      row.id,
      row.user_name || "",
      row.user_phone || "",
      row.user_email || "",
      row.salon_name || "",
      row.provider || "",
      row.type || "",
      row.status || "",
      Number(row.amount_aed || 0),
      Number(row.fee_aed || 0),
      Number(row.net_amount_aed || 0),
      row.payment_method_type || "",
      row.card_brand || "",
      row.card_last4 || "",
      row.provider_payment_id || "",
      row.booking_id || "",
      row.gift_id || "",
      row.wallet_transaction_id || "",
      row.error_message || "",
      row.error_code || "",
      row.created_at || "",
      row.succeeded_at || "",
      row.failed_at || "",
      row.refunded_at || "",
    ]);

    const csv = [
      headers.map(escapeCsv).join(","),
      ...csvRows.map((row) => row.map(escapeCsv).join(",")),
    ].join("\n");

    const fileName = `payments-export-${new Date().toISOString().slice(0, 10)}.csv`;

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
    return res.status(200).send(csv);
  } catch (e) {
    next(e);
  }
});

module.exports = router;