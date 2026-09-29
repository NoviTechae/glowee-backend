// src/routes/adminBookings.js

const router = require("express").Router();
const db = require("../db/knex");
const dashboardAuthRequired = require("../middleware/dashboardAuthRequired");
const { addWalletBalance } = require("../controllers/walletController");

function requireAdmin(req, res, next) {
  if (req.dashboard?.role !== "admin") {
    return res.status(403).json({ error: "Admin only" });
  }
  next();
}

router.use(dashboardAuthRequired);
router.use(requireAdmin);

// GET /dashboard/admin/bookings/stats
router.get("/stats", async (req, res, next) => {
  try {
    const [{ total }] = await db("bookings").count("* as total");

    const [{ pending }] = await db("bookings")
      .where({ status: "pending" })
      .count("* as pending");

    const [{ confirmed }] = await db("bookings")
      .where({ status: "confirmed" })
      .count("* as confirmed");

    const [{ completed }] = await db("bookings")
      .where({ status: "completed" })
      .count("* as completed");

    const [{ cancelled }] = await db("bookings")
      .where({ status: "cancelled" })
      .count("* as cancelled");

    const [{ today }] = await db("bookings")
      .whereRaw(`
    (scheduled_at AT TIME ZONE 'Asia/Dubai')::date =
    (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Dubai')::date
  `)
      .count("* as today");

    const [{ this_month }] = await db("bookings")
      .whereRaw(`
    DATE_TRUNC('month', scheduled_at AT TIME ZONE 'Asia/Dubai') =
    DATE_TRUNC('month', CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Dubai')
  `)
      .count("* as this_month");

    res.json({
      total: Number(total),
      pending: Number(pending),
      confirmed: Number(confirmed),
      completed: Number(completed),
      cancelled: Number(cancelled),
      today: Number(today),
      thisMonth: Number(this_month),
    });
  } catch (e) {
    next(e);
  }
});

// GET /dashboard/admin/bookings/export
router.get("/export", async (req, res, next) => {
  try {
    const { status, search, date, mode } = req.query;

    let query = db("bookings as b")
      .leftJoin("users as u", "u.id", "b.user_id")
      .leftJoin("salons as s", "s.id", "b.salon_id")
      .leftJoin("branches as br", "br.id", "b.branch_id")
      .select([
        "b.id",
        "b.user_id",
        "b.salon_id",
        "b.branch_id",
        "b.scheduled_at",
        "b.mode",
        "b.status",
        "b.total_aed",
        "b.subtotal_aed",
        "b.fees_aed",
        "b.customer_note",
        "b.created_at",
        "u.name as user_name",
        "u.phone as user_phone",
        "u.email as user_email",
        "s.name as salon_name",
        "br.name as branch_name",
      ])
      .orderBy("b.created_at", "desc");

    if (search) {
      query = query.where(function () {
        this.whereILike("u.name", `%${search}%`)
          .orWhereILike("u.phone", `%${search}%`)
          .orWhereILike("u.email", `%${search}%`)
          .orWhereILike("s.name", `%${search}%`)
          .orWhereILike("br.name", `%${search}%`)
          .orWhereILike("b.id", `%${search}%`);
      });
    }

    if (status && status !== "all") {
      query = query.where("b.status", status);
    }

    if (mode && mode !== "all") {
      query = query.where("b.mode", mode);
    }

    if (date) {
      query = query.whereRaw("DATE(b.scheduled_at) = ?", [date]);
    }

    const rows = await query;

    const escapeCsv = (value) => {
      if (value === null || value === undefined) return "";
      const str = String(value).replace(/"/g, '""');
      return `"${str}"`;
    };

    const headers = [
      "Booking ID",
      "User Name",
      "User Phone",
      "User Email",
      "Salon",
      "Branch",
      "Mode",
      "Status",
      "Scheduled At",
      "Subtotal AED",
      "Fees AED",
      "Total AED",
      "Customer Note",
      "Created At",
    ];

    const csvRows = rows.map((row) => [
      row.id,
      row.user_name || "",
      row.user_phone || "",
      row.user_email || "",
      row.salon_name || "",
      row.branch_name || "",
      row.mode || "",
      row.status || "",
      row.scheduled_at || "",
      Number(row.subtotal_aed || 0),
      Number(row.fees_aed || 0),
      Number(row.total_aed || 0),
      row.customer_note || "",
      row.created_at || "",
    ]);

    const csv = [
      headers.map(escapeCsv).join(","),
      ...csvRows.map((row) => row.map(escapeCsv).join(",")),
    ].join("\n");

    const fileName = `bookings-export-${new Date().toISOString().slice(0, 10)}.csv`;

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
    return res.status(200).send(csv);
  } catch (e) {
    next(e);
  }
});

// GET /dashboard/admin/bookings
router.get("/", async (req, res, next) => {
  try {
    const { status, search, date, mode, limit = 100 } = req.query;

    let query = db("bookings as b")
      .leftJoin("users as u", "u.id", "b.user_id")
      .leftJoin("salons as s", "s.id", "b.salon_id")
      .leftJoin("branches as br", "br.id", "b.branch_id")
      .select([
        "b.id",
        "b.user_id",
        "b.salon_id",
        "b.branch_id",
        "b.scheduled_at",
        "b.mode",
        "b.status",
        "b.total_aed",
        "b.subtotal_aed",
        "b.fees_aed",
        "b.customer_note",
        "b.created_at",
        "u.name as user_name",
        "u.phone as user_phone",
        "s.name as salon_name",
        "br.name as branch_name",
      ])
      .orderBy("b.created_at", "desc")
      .limit(Number(limit));

    if (search) {
      query = query.where(function () {
        this.whereILike("u.name", `%${search}%`)
          .orWhereILike("u.phone", `%${search}%`)
          .orWhereILike("s.name", `%${search}%`)
          .orWhereILike("br.name", `%${search}%`)
          .orWhereILike("b.id", `%${search}%`);
      });
    }

    if (status && status !== "all") {
      query = query.where("b.status", status);
    }

    if (mode && mode !== "all") {
      query = query.where("b.mode", mode);
    }

    if (date) {
      query = query.whereRaw("DATE(b.scheduled_at) = ?", [date]);
    }

    const bookings = await query;
    res.json({ data: bookings });
  } catch (e) {
    next(e);
  }
});

// GET /dashboard/admin/bookings/:id
router.get("/:id", async (req, res, next) => {
  try {
    const { id } = req.params;
 
    const booking = await db("bookings as b")
      .where("b.id", id)
      .leftJoin("users as u", "u.id", "b.user_id")
      .leftJoin("salons as s", "s.id", "b.salon_id")
      .leftJoin("branches as br", "br.id", "b.branch_id")
      .select([
        "b.id",
        "b.user_id",
        "b.salon_id",
        "b.branch_id",
        "b.gift_id",
        "b.scheduled_at",
        "b.mode",
        "b.status",
        "b.total_aed",
        "b.subtotal_aed",
        "b.fees_aed",
        "b.customer_note",
        "b.created_at",
        "b.updated_at",
        "u.name as user_name",
        "u.phone as user_phone",
        "u.email as user_email",
        "s.name as salon_name",
        "br.name as branch_name",
        "br.city as branch_city",
        "br.area as branch_area",
        "br.address_line as branch_address",
      ])
      .first();
 
    if (!booking) return res.status(404).json({ error: "Booking not found" });
 
    const [items, payments, refunds] = await Promise.all([
      db("booking_items")
        .where({ booking_id: id })
        .select([
          "id",
          "service_name_snapshot",
          "qty",
          "price_aed_snapshot",
          "duration_mins",
          "line_total_aed",
        ]),
      db("payment_transactions")
        .where({ booking_id: id, type: "booking_payment" })
        .whereIn("status", ["succeeded", "refunded"])
        .select(["provider", "status", "amount_aed", "payment_method_type"]),
      db("wallet_transactions")
        .where({ ref_id: id, type: "refund", user_id: booking.user_id })
        .select(["amount_aed", "created_at"])
        .orderBy("created_at", "desc"),
    ]);
 
    const paidAed = payments.reduce((s, p) => s + Number(p.amount_aed || 0), 0);
    const refundedAed = refunds.reduce((s, r) => s + Number(r.amount_aed || 0), 0);
 
    res.json({
      booking: {
        ...booking,
        total_aed: Number(booking.total_aed || 0),
        subtotal_aed: Number(booking.subtotal_aed || 0),
        fees_aed: Number(booking.fees_aed || 0),
      },
      items: items.map((it) => ({
        id: it.id,
        service_name: it.service_name_snapshot,
        qty: Number(it.qty || 1),
        unit_price_aed: Number(it.price_aed_snapshot || 0),
        duration_mins: Number(it.duration_mins || 0),
        line_total_aed: Number(it.line_total_aed || 0),
      })),
      payment: {
        paid_aed: paidAed,
        used_stamp_reward: payments.some(
          (p) => p.payment_method_type === "stamp_reward"
        ),
      },
      refund:
        refundedAed > 0
          ? { amount_aed: refundedAed, created_at: refunds[0].created_at }
          : null,
    });
  } catch (e) {
    next(e);
  }
});
 
// POST /dashboard/admin/bookings/:id/cancel
// Cancels the booking and refunds to the customer's wallet exactly what
// they actually paid (card, wallet, or both). Unpaid bookings are just cancelled.
router.post("/:id/cancel", async (req, res, next) => {
  try {
    const { id } = req.params;
 
    const result = await db.transaction(async (trx) => {
      // Same lock the payment flow uses, so a payment can't land mid-cancel.
      await trx.raw("SELECT pg_advisory_xact_lock(hashtext(?))", [
        `booking-payment:${id}`,
      ]);
 
      const booking = await trx("bookings").where({ id }).forUpdate().first();
 
      if (!booking) {
        return { status: 404, body: { error: "Booking not found" } };
      }
 
      if (booking.status !== "pending" && booking.status !== "confirmed") {
        return {
          status: 400,
          body: { error: `This booking is already ${booking.status}.` },
        };
      }
 
      // Only payments that actually went through and weren't refunded yet.
      const paidRows = await trx("payment_transactions")
        .where({ booking_id: id, type: "booking_payment", status: "succeeded" })
        .forUpdate()
        .select(["id", "amount_aed", "payment_method_type"]);
 
      const refundAmount = Number(
        paidRows.reduce((s, p) => s + Number(p.amount_aed || 0), 0).toFixed(2)
      );
      const usedStampReward = paidRows.some(
        (p) => p.payment_method_type === "stamp_reward"
      );
 
      await trx("bookings")
        .where({ id })
        .update({ status: "cancelled", updated_at: trx.fn.now() });
 
      // Stop an unfinished card payment for this booking from completing it later.
      await trx("payment_transactions")
        .where({ booking_id: id, type: "booking_payment", status: "pending" })
        .update({ status: "cancelled", updated_at: trx.fn.now() });
 
      let newBalance = null;
 
      if (refundAmount > 0) {
        const credit = await addWalletBalance(
          booking.user_id,
          refundAmount,
          `Refund - booking cancelled by Glowee #${id}`,
          id,
          "refund",
          trx
        );
        newBalance = credit.balance_after_aed;
      }
 
      if (paidRows.length) {
        await trx("payment_transactions")
          .whereIn(
            "id",
            paidRows.map((p) => p.id)
          )
          .update({
            status: "refunded",
            refunded_at: trx.fn.now(),
            updated_at: trx.fn.now(),
            metadata: trx.raw(`COALESCE(metadata, '{}'::jsonb) || ?::jsonb`, [
              JSON.stringify({
                refunded_to_wallet: true,
                refund_reason: "admin_cancelled",
              }),
            ]),
          });
      }
 
      let message;
      if (refundAmount > 0) {
        message = `Booking cancelled. AED ${refundAmount.toFixed(
          2
        )} refunded to the customer's wallet.`;
      } else if (booking.gift_id) {
        message =
          "Booking cancelled. It was paid with a gift, so nothing was refunded to the wallet.";
      } else if (usedStampReward) {
        message =
          "Booking cancelled. It was paid with a loyalty reward, which wasn't returned automatically.";
      } else {
        message =
          "Booking cancelled. The customer hadn't paid, so there was nothing to refund.";
      }
 
      return {
        status: 200,
        body: {
          ok: true,
          refund:
            refundAmount > 0
              ? { amount_aed: refundAmount, new_balance_aed: newBalance }
              : null,
          message,
        },
      };
    });
 
    return res.status(result.status).json(result.body);
  } catch (e) {
    next(e);
  }
});
 
module.exports = router;