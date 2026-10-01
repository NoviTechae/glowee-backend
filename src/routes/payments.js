// src/routes/payments.js
const router = require("express").Router();
const { z } = require("zod");
const authRequired = require("../middleware/authRequired");
const ziinaService = require("../services/ziina");
const db = require("../db/knex");

const { isZiinaPaid } = ziinaService;

// ---------- Small HTML pages shown in the payment browser ----------
const esc = (v) =>
  String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function page(title, lines) {
  return `<!doctype html><html><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/><title>${esc(title)}</title>
<style>body{font-family:-apple-system,Arial,sans-serif;background:#f8f5f2;color:#111;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:24px;text-align:center}
.box{max-width:420px;background:#fff;border-radius:16px;padding:24px;box-shadow:0 8px 30px rgba(0,0,0,.08)}h1{margin:0 0 12px;font-size:24px}p{margin:0 0 8px;color:#555}</style>
</head><body><div class="box"><h1>${esc(title)}</h1>${lines.map((l) => `<p>${esc(l)}</p>`).join("")}</div></body></html>`;
}

const bookingUnavailablePage = (amount) =>
  page("This time is no longer available", [
    `Your payment of AED ${Number(amount).toFixed(2)} was added to your Glowee wallet. You can use it to book another time.`,
  ]);

// Tap routes (cards, webhook, charge verify, Apple Pay) were removed while Tap
// is not in use. An unused public webhook is still a way in. Restore from git
// if Tap is switched on again, and verify every webhook with Tap before crediting.

// ---------- Wallet top-up ----------
const WalletTopupSchema = z.object({
  amount_aed: z.number().min(5).max(10000),
  // Tap is switched off; Ziina is the only provider.
  provider: z.literal("ziina").optional().default("ziina"),
});

router.post("/wallet/topup", authRequired, async (req, res, next) => {
  try {
    const { amount_aed, provider } = WalletTopupSchema.parse(req.body);
    const user = await db("users").where({ id: req.user.sub }).first();
    if (!user) return res.status(404).json({ error: "User not found" });

    const result = await ziinaService.createWalletTopupPaymentIntent(user.id, amount_aed, user.phone, user.name, user.email);

    if (!result.ok) return res.status(400).json({ error: result.error, code: result.code });

    return res.json({
      ok: true,
      provider,
      charge_id: result.charge_id || null,
      payment_intent_id: result.payment_intent_id || null,
      transaction_id: result.transaction_id,
      payment_url: result.payment_url,
      amount: result.amount,
      status: result.status,
    });
  } catch (error) {
    next(error);
  }
});

router.get("/transaction/:id", authRequired, async (req, res, next) => {
  try {
    const t = await db("payment_transactions").where({ id: req.params.id, user_id: req.user.sub }).first();
    if (!t) return res.status(404).json({ error: "Transaction not found" });

    return res.json({
      ok: true,
      transaction: {
        id: t.id,
        provider: t.provider,
        type: t.type,
        status: t.status,
        amount_aed: Number(t.amount_aed),
        created_at: t.created_at,
        succeeded_at: t.succeeded_at,
        failed_at: t.failed_at,
        payment_method: { type: t.payment_method_type, card_last4: t.card_last4, card_brand: t.card_brand },
        error: t.error_message,
      },
    });
  } catch (error) {
    next(error);
  }
});

router.get("/history", authRequired, async (req, res, next) => {
  try {
    const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));
    const offset = Math.max(0, Number(req.query.offset) || 0);

    const [rows, total] = await Promise.all([
      db("payment_transactions")
        .where({ user_id: req.user.sub })
        .orderBy("created_at", "desc")
        .limit(limit)
        .offset(offset)
        .select(["id", "provider", "type", "status", "amount_aed", "payment_method_type", "card_last4", "card_brand", "created_at", "succeeded_at"]),
      db("payment_transactions").where({ user_id: req.user.sub }).count("* as count").first(),
    ]);

    return res.json({
      ok: true,
      data: rows.map((t) => ({
        id: t.id,
        provider: t.provider,
        type: t.type,
        status: t.status,
        amount_aed: Number(t.amount_aed),
        payment_method: { type: t.payment_method_type, card_last4: t.card_last4, card_brand: t.card_brand },
        created_at: t.created_at,
        succeeded_at: t.succeeded_at,
      })),
      pagination: { limit, offset, total: Number(total.count) },
    });
  } catch (error) {
    next(error);
  }
});

// ---------- Ziina: called by the app after the payment sheet closes ----------
router.get("/verify/ziina/:paymentIntentId", authRequired, async (req, res, next) => {
  try {
    const { paymentIntentId } = req.params;

    const transaction = await db("payment_transactions")
      .where({ provider_payment_id: paymentIntentId, provider: "ziina", user_id: req.user.sub })
      .first();
    if (!transaction) return res.status(404).json({ error: "Transaction not found" });

    const finished = await finishedResponse(transaction);
    if (finished) return res.json(finished);

    const result = await ziinaService.getPaymentIntentStatus(paymentIntentId);
    if (!result.ok) return res.status(400).json({ error: result.error });

    if (!isZiinaPaid(result.status)) {
      return res.json({ ok: true, status: result.status, amount: result.amount });
    }

    const r = await ziinaService.handlePaymentIntentSuccess(paymentIntentId, result.raw);
    if (!r.ok && !r.already_processed) return res.status(500).json({ error: r.error });

    if (r.booking_unavailable) {
      return res.json({ ok: true, status: "booking_unavailable", refunded_to_wallet: true, refund_amount: r.refund_amount });
    }
    return res.json({ ok: true, status: "succeeded", amount: Number(transaction.amount_aed) });
  } catch (error) {
    next(error);
  }
});

async function finishedResponse(transaction) {
  if (transaction.status === "succeeded") {
    return { ok: true, status: "succeeded", amount: Number(transaction.amount_aed) };
  }
  if (transaction.status === "refunded_to_wallet") {
    const md = transaction.metadata || {};
    if (md.refund_reason === "booking_unavailable") {
      return { ok: true, status: "booking_unavailable", refunded_to_wallet: true, refund_amount: Number(md.refund_amount ?? transaction.amount_aed) };
    }
    return { ok: true, status: "succeeded", amount: Number(transaction.amount_aed) };
  }
  return null;
}

// ---------- Ziina: booking return pages ----------
router.get("/ziina/booking/success", async (req, res) => {
  try {
    const bookingId = String(req.query.booking_id || "");
    if (!bookingId) return res.status(400).send(page("Something went wrong", ["Missing booking."]));

    const transaction = await db("payment_transactions")
      .where({ provider: "ziina", type: "booking_payment", booking_id: bookingId })
      .orderBy("created_at", "desc")
      .first();
    if (!transaction?.provider_payment_id) {
      return res.status(404).send(page("Payment not found", ["Return to Glowee and check your booking."]));
    }

    const result = await ziinaService.getPaymentIntentStatus(transaction.provider_payment_id);
    if (!result.ok) return res.status(400).send(page("We couldn't check your payment", ["Return to Glowee, your booking will update shortly."]));
    if (!isZiinaPaid(result.status)) {
      return res.status(400).send(page("Payment not completed", ["Return to Glowee and try again."]));
    }

    const r = await ziinaService.handlePaymentIntentSuccess(transaction.provider_payment_id, result.raw);
    if (!r.ok && !r.already_processed) {
      return res.status(500).send(page("We couldn't confirm your booking", ["Your payment is safe. Return to Glowee or contact support."]));
    }
    if (r.booking_unavailable) return res.send(bookingUnavailablePage(r.refund_amount));

    // The app watches for this address to close the payment screen.
    return res.redirect(`/payments/ziina/booking/done?booking_id=${encodeURIComponent(bookingId)}`);
  } catch (error) {
    console.error("Ziina booking success error:", error.message);
    return res.status(500).send(page("Something went wrong", ["Return to Glowee and check your booking."]));
  }
});

router.get("/ziina/booking/done", (req, res) => {
  res.send(page("Payment successful", ["Your booking is confirmed. You can return to Glowee."]));
});

router.get("/ziina/booking/cancel", async (req, res) => {
  const bookingId = String(req.query.booking_id || "");
  if (!bookingId) return res.status(400).send(page("Something went wrong", ["Missing booking."]));

  try {
    const pending = await db("payment_transactions")
      .where({ provider: "ziina", type: "booking_payment", booking_id: bookingId, status: "pending" })
      .orderBy("created_at", "desc")
      .first();

    // Ask Ziina first: a "cancel" link opened after paying must not undo the payment.
    if (pending?.provider_payment_id) {
      const st = await ziinaService.getPaymentIntentStatus(pending.provider_payment_id);
      if (st.ok && isZiinaPaid(st.status)) {
        const r = await ziinaService.handlePaymentIntentSuccess(pending.provider_payment_id, st.raw);
        if (r.booking_unavailable) return res.send(bookingUnavailablePage(r.refund_amount));
        return res.redirect(`/payments/ziina/booking/done?booking_id=${encodeURIComponent(bookingId)}`);
      }
    }

    await db.transaction(async (trx) => {
      await trx.raw("SELECT pg_advisory_xact_lock(hashtext(?))", [`booking-payment:${bookingId}`]);

      const transaction = await trx("payment_transactions")
        .where({ provider: "ziina", type: "booking_payment", booking_id: bookingId, status: "pending" })
        .orderBy("created_at", "desc")
        .forUpdate()
        .first();
      if (!transaction) return;

      const metadata = transaction.metadata || {};
      const walletAmount = Number(metadata.wallet_amount || 0);

      if (metadata.split_payment === true && walletAmount > 0 && metadata.wallet_refunded !== true) {
        const { addWalletBalance } = require("../controllers/walletController");
        await addWalletBalance(
          transaction.user_id,
          walletAmount,
          `Refund - booking payment cancelled #${bookingId}`,
          bookingId,
          "refund",
          trx
        );

        await trx("payment_transactions")
          .where({ user_id: transaction.user_id, booking_id: bookingId, provider: "wallet", type: "booking_payment", status: "succeeded" })
          .whereRaw("COALESCE((metadata->>'wallet_portion')::boolean, false) = true")
          .update({
            status: "refunded",
            refunded_at: trx.fn.now(),
            updated_at: trx.fn.now(),
            metadata: trx.raw(`COALESCE(metadata, '{}'::jsonb) || ?::jsonb`, [
              JSON.stringify({ wallet_refunded: true, wallet_refund_reason: "booking_payment_cancelled" }),
            ]),
          });

        await trx("payment_transactions")
          .where({ id: transaction.id })
          .update({
            status: "cancelled",
            metadata: { ...metadata, wallet_refunded: true, wallet_refund_amount: walletAmount, wallet_refund_reason: "booking_payment_cancelled" },
            updated_at: trx.fn.now(),
          });
      } else {
        await trx("payment_transactions")
          .where({ id: transaction.id })
          .update({ status: "cancelled", metadata: { ...metadata, cancelled: true }, updated_at: trx.fn.now() });
      }
    });

    return res.send(page("Payment cancelled", ["Nothing was charged. You can return to Glowee and try again."]));
  } catch (error) {
    console.error("Ziina booking cancel error:", error.message);
    return res.status(500).send(page("Something went wrong", ["Return to Glowee and try again."]));
  }
});

// ---------- Ziina: gift return pages ----------
router.get("/ziina/gift/success", async (req, res) => {
  try {
    const giftId = req.query.gift_id ? String(req.query.gift_id) : null;
    if (!giftId) return res.status(400).send(page("Something went wrong", ["Missing gift."]));

    const transaction = await db("payment_transactions")
      .where({ provider: "ziina", type: "gift_purchase", gift_id: giftId })
      .orderBy("created_at", "desc")
      .first();
    if (!transaction?.provider_payment_id) return res.status(404).send(page("Payment not found", ["Return to Glowee."]));

    const result = await ziinaService.getPaymentIntentStatus(transaction.provider_payment_id);
    if (!result.ok) return res.status(400).send(page("We couldn't check your payment", ["Return to Glowee, your gift will update shortly."]));
    if (!isZiinaPaid(result.status)) return res.status(400).send(page("Payment not completed", ["Return to Glowee and try again."]));

    const r = await ziinaService.handlePaymentIntentSuccess(transaction.provider_payment_id, result.raw);
    if (!r.ok && !r.already_processed) {
      return res.status(500).send(page("We couldn't send your gift", ["Your payment is safe. Contact Glowee support."]));
    }

    return res.send(page("Payment successful", ["Your gift is on its way. You can return to Glowee."]));
  } catch (error) {
    console.error("Ziina gift success error:", error.message);
    return res.status(500).send(page("Something went wrong", ["Return to Glowee."]));
  }
});

router.get("/ziina/gift/cancel", async (req, res) => {
  const giftId = req.query.gift_id ? String(req.query.gift_id) : null;
  try {
    if (giftId) {
      const pending = await db("payment_transactions")
        .where({ provider: "ziina", type: "gift_purchase", gift_id: giftId, status: "pending" })
        .orderBy("created_at", "desc")
        .first();

      // Ask Ziina first: if it was actually paid, send the gift instead.
      if (pending?.provider_payment_id) {
        const st = await ziinaService.getPaymentIntentStatus(pending.provider_payment_id);
        if (st.ok && isZiinaPaid(st.status)) {
          await ziinaService.handlePaymentIntentSuccess(pending.provider_payment_id, st.raw);
          return res.send(page("Payment successful", ["Your gift is on its way. You can return to Glowee."]));
        }
      }

      const { returnGiftWalletPart } = require("../controllers/giftPaymentController");
      const r = await returnGiftWalletPart(giftId);
      if (r.ok && r.refunded > 0) {
        return res.send(
          page("Payment cancelled", [`Nothing was charged to your card. AED ${r.refunded.toFixed(2)} went back to your Glowee wallet.`])
        );
      }
    }
    return res.send(page("Payment cancelled", ["Nothing was charged. You can return to Glowee and try again."]));
  } catch (error) {
    console.error("Ziina gift cancel error:", error.message);
    return res.status(500).send(page("Something went wrong", ["Return to Glowee."]));
  }
});

// ---------- Ziina: wallet return pages ----------
router.get("/ziina/wallet/success", async (req, res) => {
  try {
    const transactionId = String(req.query.transaction_id || "");
    if (!transactionId) return res.status(400).send(page("Something went wrong", ["Missing payment."]));

    const transaction = await db("payment_transactions").where({ id: transactionId, provider: "ziina", type: "wallet_topup" }).first();
    if (!transaction?.provider_payment_id) return res.status(404).send(page("Payment not found", ["Return to Glowee."]));

    const result = await ziinaService.getPaymentIntentStatus(transaction.provider_payment_id);
    if (!result.ok) return res.status(400).send(page("We couldn't check your payment", ["Return to Glowee, your wallet will update shortly."]));
    if (!isZiinaPaid(result.status)) return res.status(400).send(page("Payment not completed", ["Return to Glowee and try again."]));

    const r = await ziinaService.handlePaymentIntentSuccess(transaction.provider_payment_id, result.raw);
    if (!r.ok && !r.already_processed) {
      return res.status(500).send(page("We couldn't add it to your wallet", ["Your payment is safe. Contact Glowee support."]));
    }

    return res.send(page("Top-up successful", ["Your wallet has been topped up. You can return to Glowee."]));
  } catch (error) {
    console.error("Ziina wallet success error:", error.message);
    return res.status(500).send(page("Something went wrong", ["Return to Glowee."]));
  }
});

router.get("/ziina/wallet/cancel", (req, res) => {
  res.send(page("Top-up cancelled", ["Nothing was charged. You can return to Glowee and try again."]));
});

// ---------- Ziina: subscription return pages ----------
router.get("/ziina/subscription/success", async (req, res) => {
  const dashboard = process.env.GLOWEE_DASHBOARD_URL;
  try {
    const paymentId = String(req.query.payment_id || "");
    if (!paymentId) return res.status(400).send(page("Something went wrong", ["Missing payment."]));

    const payment = await db("subscription_payments").where({ id: paymentId, provider: "ziina" }).first();
    if (!payment?.provider_payment_id) return res.status(404).send(page("Payment not found", ["Return to your Glowee dashboard."]));

    if (payment.status !== "paid") {
      const result = await ziinaService.getPaymentIntentStatus(payment.provider_payment_id);
      if (!result.ok) return res.status(400).send(page("We couldn't check your payment", ["Return to your Glowee dashboard."]));
      if (!isZiinaPaid(result.status)) return res.status(400).send(page("Payment not completed", ["Return to your Glowee dashboard and try again."]));

      await db.transaction(async (trx) => {
        // Lock, then re-check: opening this page twice must add one month, not two.
        const locked = await trx("subscription_payments").where({ id: payment.id }).forUpdate().first();
        if (locked.status === "paid") return;

        await trx("subscription_payments")
          .where({ id: payment.id })
          .update({
            status: "paid",
            paid_at: trx.fn.now(),
            metadata: { ...(locked.metadata || {}), ziina_status: result.status, ziina_raw: result.raw || null },
            updated_at: trx.fn.now(),
          });

        // Paying early adds the month after the current end, so no days are lost.
        await trx("subscriptions")
          .where({ id: payment.subscription_id })
          .update({
            provider: "ziina",
            status: "active",
            auto_renew: true,
            cancel_at_period_end: false,
            current_period_start: trx.raw("CASE WHEN current_period_end > NOW() THEN current_period_start ELSE NOW() END"),
            current_period_end: trx.raw("GREATEST(COALESCE(current_period_end, NOW()), NOW()) + INTERVAL '1 month'"),
            cancelled_at: null,
            ended_at: null,
            updated_at: trx.fn.now(),
          });
      });
    }

    return res.redirect(`${dashboard}/salon/subscription?payment=success`);
  } catch (error) {
    console.error("Ziina subscription success error:", error.message);
    return res.status(500).send(page("Something went wrong", ["Return to your Glowee dashboard."]));
  }
});

router.get("/ziina/subscription/cancel", async (req, res) => {
  try {
    const paymentId = req.query.payment_id ? String(req.query.payment_id) : null;
    if (paymentId) {
      await db("subscription_payments")
        .where({ id: paymentId, provider: "ziina", status: "pending" })
        .update({ status: "cancelled", updated_at: db.fn.now() });
    }
    return res.redirect(`${process.env.GLOWEE_DASHBOARD_URL}/salon/subscription?payment=cancelled`);
  } catch (error) {
    console.error("Ziina subscription cancel error:", error.message);
    return res.status(500).send(page("Something went wrong", ["Return to your Glowee dashboard."]));
  }
});

const bookingPayment = require("../controllers/bookingPaymentController");
const giftPayment = require("../controllers/giftPaymentController");

router.get("/bookings/:id/payment-options", authRequired, bookingPayment.getPaymentOptions);
router.post("/bookings/:id/pay", authRequired, bookingPayment.payForBooking);
router.get("/gifts/payment-options", authRequired, giftPayment.getGiftPaymentOptions);
router.post("/gifts/send-with-payment", authRequired, giftPayment.sendGiftWithPayment);

module.exports = router;