// src/services/ziina.js
const axios = require("axios");
const db = require("../db/knex");
const { sendGiftNotification } = require("./whatsapp");
const { sendGiftSms } = require("./sms");
const { hasSlotConflict } = require("../utils/bookingHold");

const ZIINA_API_URL = "https://api-v2.ziina.com/api";
const ZIINA_API_KEY = (process.env.ZIINA_API_KEY || "").trim();
if (!ZIINA_API_KEY) console.warn("ZIINA_API_KEY is not set");

const ziinaClient = axios.create({
  baseURL: ZIINA_API_URL,
  timeout: 20000,
  headers: { Authorization: `Bearer ${ZIINA_API_KEY}`, "Content-Type": "application/json" },
});

// Ziina's only "money received" status. Anything else is not paid.
function isZiinaPaid(status) {
  return String(status || "").toLowerCase() === "completed";
}

const toFils = (aed) => Math.round(Number(aed) * 100);

function url(path, params) {
  const q = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)])).toString();
  return `${process.env.API_URL}${path}?${q}`;
}

const buildWalletUrls = (id) => ({
  success_url: url("/payments/ziina/wallet/success", { transaction_id: id }),
  cancel_url: url("/payments/ziina/wallet/cancel", { transaction_id: id }),
});
const buildBookingUrls = (id) => ({
  success_url: url("/payments/ziina/booking/success", { booking_id: id }),
  cancel_url: url("/payments/ziina/booking/cancel", { booking_id: id }),
});
const buildGiftUrls = (id) => ({
  success_url: url("/payments/ziina/gift/success", { gift_id: id }),
  cancel_url: url("/payments/ziina/gift/cancel", { gift_id: id }),
});
const buildSubscriptionUrls = (id) => ({
  success_url: url("/payments/ziina/subscription/success", { payment_id: id }),
  cancel_url: url("/payments/ziina/subscription/cancel", { payment_id: id }),
});

function ziinaError(where, error) {
  console.error(`Ziina ${where} error:`, { status: error.response?.status, data: error.response?.data, message: error.message });
  return { ok: false, error: error.response?.data?.message || error.message, code: error.response?.status };
}

const asObject = (v) => (typeof v === "object" && v !== null ? v : {});

/** Wallet top-up */
async function createWalletTopupPaymentIntent(userId, amountAed, userPhone, userName, userEmail) {
  try {
    const existing = await db("payment_transactions")
      .where({ user_id: userId, provider: "ziina", type: "wallet_topup", status: "pending", amount_aed: Number(amountAed) })
      .whereRaw("created_at > NOW() - INTERVAL '15 minutes'")
      .orderBy("created_at", "desc")
      .first();

    if (existing?.metadata?.payment_url) {
      return {
        ok: true,
        payment_intent_id: existing.provider_payment_id,
        transaction_id: existing.id,
        payment_url: existing.metadata.payment_url,
        amount: Number(existing.amount_aed),
        status: existing.status,
        reused: true,
      };
    }

    const [transaction] = await db("payment_transactions")
      .insert({
        user_id: userId,
        provider: "ziina",
        type: "wallet_topup",
        status: "pending",
        amount_aed: Number(amountAed),
        fee_aed: 0,
        net_amount_aed: Number(amountAed),
        provider_payment_id: null,
        metadata: { phone: userPhone || null, email: userEmail || null, name: userName || null },
        created_at: db.fn.now(),
        updated_at: db.fn.now(),
      })
      .returning("*");

    const { data: pi } = await ziinaClient.post("/payment_intent", {
      amount: toFils(amountAed),
      currency_code: "AED",
      message: "Glowee Top-up",
      ...buildWalletUrls(transaction.id),
      test: false,
    });

    if (!pi?.id || !pi?.redirect_url) {
      await db("payment_transactions")
        .where({ id: transaction.id })
        .update({ status: "failed", error_message: "Ziina did not return a valid payment intent", updated_at: db.fn.now() });
      return { ok: false, error: "Ziina did not return a valid payment intent" };
    }

    await db("payment_transactions")
      .where({ id: transaction.id })
      .update({
        provider_payment_id: pi.id,
        metadata: { ...asObject(transaction.metadata), payment_url: pi.redirect_url, ziina_status: pi.status || "pending" },
        updated_at: db.fn.now(),
      });

    return {
      ok: true,
      payment_intent_id: pi.id,
      transaction_id: transaction.id,
      payment_url: pi.redirect_url,
      amount: Number(amountAed),
      status: pi.status || "pending",
    };
  } catch (error) {
    return ziinaError("create wallet payment intent", error);
  }
}

/** Booking payment */
async function createBookingPaymentIntent(userId, bookingId, amountAed, userPhone, userName, userEmail, metadata = {}) {
  try {
    const existing = await db("payment_transactions")
      .where({ user_id: userId, booking_id: bookingId, provider: "ziina", type: "booking_payment", status: "pending" })
      .whereRaw("created_at > NOW() - INTERVAL '15 minutes'")
      .orderBy("created_at", "desc")
      .first();

    if (existing?.metadata?.payment_url && Number(existing.amount_aed) === Number(amountAed)) {
      return {
        ok: true,
        payment_url: existing.metadata.payment_url,
        payment_intent_id: existing.provider_payment_id,
        transaction_id: existing.id,
        amount: Number(existing.amount_aed),
        status: existing.status,
        reused: true,
      };
    }

    const { data: pi } = await ziinaClient.post("/payment_intent", {
      amount: toFils(amountAed),
      currency_code: "AED",
      message: "Glowee · Beauty Booking",
      ...buildBookingUrls(bookingId),
      test: false,
    });

    if (!pi?.id || !pi?.redirect_url) return { ok: false, error: "Ziina did not return a valid booking payment intent" };

    const [transaction] = await db("payment_transactions")
      .insert({
        user_id: userId,
        booking_id: bookingId,
        provider: "ziina",
        type: "booking_payment",
        status: "pending",
        amount_aed: Number(amountAed),
        fee_aed: 0,
        net_amount_aed: Number(amountAed),
        provider_payment_id: pi.id,
        metadata: {
          phone: userPhone || null,
          email: userEmail || null,
          name: userName || null,
          payment_url: pi.redirect_url,
          ziina_status: pi.status || "pending",
          ...metadata,
        },
        created_at: db.fn.now(),
        updated_at: db.fn.now(),
      })
      .returning("*");

    return {
      ok: true,
      payment_url: pi.redirect_url,
      payment_intent_id: pi.id,
      transaction_id: transaction.id,
      amount: Number(amountAed),
      status: pi.status || "pending",
    };
  } catch (error) {
    return ziinaError("create booking payment intent", error);
  }
}

/** Gift payment */
async function createGiftPaymentIntent(userId, amountAed, recipientPhone, userPhone, userName, userEmail, metadata = {}) {
  try {
    const giftId = metadata.gift_id || null;

    const existing = await db("payment_transactions")
      .where({ user_id: userId, provider: "ziina", type: "gift_purchase", status: "pending" })
      .modify((qb) => {
        if (giftId) qb.where({ gift_id: giftId });
      })
      .whereRaw("created_at > NOW() - INTERVAL '15 minutes'")
      .orderBy("created_at", "desc")
      .first();

    if (existing?.metadata?.payment_url && Number(existing.amount_aed) === Number(amountAed)) {
      return {
        ok: true,
        payment_url: existing.metadata.payment_url,
        payment_intent_id: existing.provider_payment_id,
        transaction_id: existing.id,
        amount: Number(existing.amount_aed),
        status: existing.status,
        reused: true,
      };
    }

    const { data: pi } = await ziinaClient.post("/payment_intent", {
      amount: toFils(amountAed),
      currency_code: "AED",
      message: "Glowee Gift Payment",
      ...buildGiftUrls(giftId),
      test: false,
    });

    if (!pi?.id || !pi?.redirect_url) return { ok: false, error: "Ziina did not return a valid gift payment intent" };

    const [transaction] = await db("payment_transactions")
      .insert({
        user_id: userId,
        provider: "ziina",
        type: "gift_purchase",
        status: "pending",
        amount_aed: Number(amountAed),
        fee_aed: 0,
        net_amount_aed: Number(amountAed),
        provider_payment_id: pi.id,
        gift_id: giftId,
        metadata: {
          phone: userPhone || null,
          email: userEmail || null,
          name: userName || null,
          recipient_phone: recipientPhone || null,
          payment_url: pi.redirect_url,
          ziina_status: pi.status || "pending",
          ...metadata,
        },
        created_at: db.fn.now(),
        updated_at: db.fn.now(),
      })
      .returning("*");

    return {
      ok: true,
      payment_url: pi.redirect_url,
      payment_intent_id: pi.id,
      transaction_id: transaction.id,
      amount: Number(amountAed),
      status: pi.status || "pending",
    };
  } catch (error) {
    return ziinaError("create gift payment intent", error);
  }
}

/** Ask Ziina for the real status of a payment. */
async function getPaymentIntentStatus(paymentIntentId) {
  try {
    const { data: pi } = await ziinaClient.get(`/payment_intent/${encodeURIComponent(paymentIntentId)}`);
    return { ok: true, status: pi.status, amount: pi.amount ? pi.amount / 100 : null, raw: pi };
  } catch (error) {
    return ziinaError("get payment intent status", error);
  }
}

/**
 * Apply a Ziina payment that Ziina reports as completed.
 * Safe to call any number of times, at the same time, from the app's verify
 * call and from the browser's success page: the payment row is locked and a
 * finished payment is never applied twice.
 */
async function handlePaymentIntentSuccess(paymentIntentId, paymentIntentData = {}) {
  const trx = await db.transaction();

  try {
    const first = await trx("payment_transactions")
      .where({ provider_payment_id: paymentIntentId, provider: "ziina" })
      .first("id", "type", "booking_id");

    if (!first) {
      await trx.rollback();
      return { ok: false, error: "Transaction not found" };
    }

    // Same lock as the booking payment and cancel flows.
    if (first.type === "booking_payment" && first.booking_id) {
      await trx.raw("SELECT pg_advisory_xact_lock(hashtext(?))", [`booking-payment:${first.booking_id}`]);
    }

    // Lock the payment row: a second call waits here, then sees it's done.
    const transaction = await trx("payment_transactions").where({ id: first.id }).forUpdate().first();

    const done = ["succeeded", "refunded_to_wallet", "refunded"];
    if (done.includes(transaction.status)) {
      await trx.commit();
      const md = asObject(transaction.metadata);
      return {
        ok: true,
        already_processed: true,
        booking_unavailable: md.refund_reason === "booking_unavailable",
        refunded_to_wallet: transaction.status === "refunded_to_wallet",
        refund_amount: Number(md.refund_amount ?? transaction.amount_aed ?? 0),
        transaction_id: transaction.id,
        booking_id: transaction.booking_id || null,
        gift_id: transaction.gift_id || null,
        amount: Number(transaction.amount_aed || 0),
      };
    }

    // Only apply what Ziina actually collected.
    if (paymentIntentData?.amount != null && Number(paymentIntentData.amount) !== toFils(transaction.amount_aed)) {
      await trx("payment_transactions")
        .where({ id: transaction.id })
        .update({
          error_message: `Amount mismatch: Ziina ${paymentIntentData.amount}, expected ${toFils(transaction.amount_aed)}`,
          updated_at: trx.fn.now(),
        });
      await trx.commit();
      console.error("Ziina amount mismatch", { transactionId: transaction.id });
      return { ok: false, error: "Payment amount does not match" };
    }

    const source = paymentIntentData?.payment_method || paymentIntentData?.source || null;
    const cardLast4 = source?.last4 || source?.last_four || null;
    const cardBrand = source?.brand || source?.scheme || null;
    const paymentMethodType = String(cardBrand || "").toLowerCase().includes("apple") ? "apple_pay" : "card";

    const existingMetadata = asObject(transaction.metadata);
    const { addWalletBalance } = require("../controllers/walletController");

    await trx("payment_transactions")
      .where({ id: transaction.id })
      .update({
        status: "succeeded",
        succeeded_at: trx.fn.now(),
        payment_method_type: paymentMethodType,
        card_last4: cardLast4,
        card_brand: cardBrand,
        metadata: { ...existingMetadata, ziina_status: paymentIntentData?.status || "completed", ziina_payment_intent: paymentIntentData },
        updated_at: trx.fn.now(),
      });

    // ---- Wallet top-up
    if (transaction.type === "wallet_topup") {
      const { addPoints } = require("../controllers/rewardController");
      await addWalletBalance(
        transaction.user_id,
        Number(transaction.net_amount_aed),
        `Wallet top-up via Ziina${cardBrand ? ` (${cardBrand})` : ""}`,
        transaction.id,
        "topup",
        trx
      );
      if (Number(transaction.net_amount_aed) >= 100) {
        await addPoints(transaction.user_id, 20, "wallet_topup", transaction.id, trx);
      }
    }

    // ---- Booking payment
    if (transaction.type === "booking_payment" && transaction.booking_id) {
      const bookingRow = await trx("bookings").where({ id: transaction.booking_id }).forUpdate().first();

      const slotStillFree = bookingRow?.status === "pending" && !(await hasSlotConflict(transaction.booking_id, trx));

      // The wallet part of a split payment was handed back when the customer
      // pressed cancel, so this card payment no longer covers the booking.
      const walletPartReturned = existingMetadata.wallet_refunded === true;

      // What was actually paid must cover the booking as it is now (a loyalty
      // reward can change the total). Short payments are returned, not accepted.
      let underpaid = false;
      if (bookingRow?.status === "pending" && !walletPartReturned) {
        const walletParts = await trx("payment_transactions")
          .where({ booking_id: transaction.booking_id, type: "booking_payment", provider: "wallet", status: "succeeded" })
          .whereRaw("COALESCE((metadata->>'wallet_portion')::boolean, false) = true")
          .sum({ s: "amount_aed" })
          .first();
        const paid = Number(transaction.amount_aed || 0) + Number(existingMetadata.split_payment ? walletParts?.s || 0 : 0);
        underpaid = paid + 0.01 < Number(bookingRow.total_aed);
        if (underpaid) console.warn("Booking payment short of total, returning to wallet", { bookingId: transaction.booking_id });
      }

      if (bookingRow?.status !== "confirmed" && (!slotStillFree || walletPartReturned || underpaid)) {
        const walletPortionRows =
          bookingRow?.status === "pending"
            ? await trx("payment_transactions")
                .where({ booking_id: transaction.booking_id, type: "booking_payment", provider: "wallet", status: "succeeded" })
                .where("amount_aed", ">", 0)
                .select(["id", "amount_aed"])
            : [];

        const refundAmount = Number(
          (Number(transaction.amount_aed || 0) + walletPortionRows.reduce((s, p) => s + Number(p.amount_aed), 0)).toFixed(2)
        );

        await addWalletBalance(
          transaction.user_id,
          refundAmount,
          `Refund - booking time no longer available #${transaction.booking_id}`,
          transaction.booking_id,
          "refund",
          trx
        );

        await trx("payment_transactions")
          .where({ id: transaction.id })
          .update({
            status: "refunded_to_wallet",
            refunded_at: trx.fn.now(),
            metadata: {
              ...existingMetadata,
              ziina_payment_intent: paymentIntentData,
              refund_destination: "wallet",
              refund_reason: "booking_unavailable",
              refund_amount: refundAmount,
            },
            updated_at: trx.fn.now(),
          });

        if (walletPortionRows.length) {
          await trx("payment_transactions")
            .whereIn("id", walletPortionRows.map((p) => p.id))
            .update({ status: "refunded", refunded_at: trx.fn.now(), updated_at: trx.fn.now() });
        }

        if (bookingRow?.status === "pending") {
          await trx("bookings").where({ id: transaction.booking_id }).update({ status: "cancelled", updated_at: trx.fn.now() });
        }

        await trx.commit();
        return {
          ok: true,
          booking_unavailable: true,
          refunded_to_wallet: true,
          refund_amount: refundAmount,
          transaction_id: transaction.id,
          booking_id: transaction.booking_id,
        };
      }

      // Already paid by another card payment: return this one to the wallet.
      const otherPayment = await trx("payment_transactions")
        .where({ booking_id: transaction.booking_id, type: "booking_payment", status: "succeeded" })
        .whereNot({ id: transaction.id })
        .where(function () {
          this.whereNull("metadata").orWhereRaw("COALESCE((metadata->>'wallet_portion')::boolean, false) = false");
        })
        .first("id");

      if (otherPayment) {
        console.warn("Duplicate booking payment, refunding to wallet", { bookingId: transaction.booking_id, transactionId: transaction.id });

        await addWalletBalance(
          transaction.user_id,
          Number(transaction.net_amount_aed || transaction.amount_aed || 0),
          "Duplicate booking payment refunded to wallet",
          transaction.id,
          "refund",
          trx
        );

        await trx("payment_transactions")
          .where({ id: transaction.id })
          .update({
            status: "refunded_to_wallet",
            refunded_at: trx.fn.now(),
            metadata: {
              ...existingMetadata,
              duplicate_of_transaction_id: otherPayment.id,
              refund_destination: "wallet",
              refund_reason: "duplicate_booking_payment",
            },
            updated_at: trx.fn.now(),
          });

        await trx.commit();
        return {
          ok: true,
          duplicate_payment: true,
          refunded_to_wallet: true,
          transaction_id: transaction.id,
          booking_id: transaction.booking_id,
          amount: Number(transaction.amount_aed || 0),
        };
      }

      // A full card payment covered the booking, but an earlier wallet+card
      // attempt may have taken a wallet part. Give that part back.
      if (existingMetadata.split_payment !== true) {
        const leftovers = await trx("payment_transactions")
          .where({ booking_id: transaction.booking_id, type: "booking_payment", provider: "wallet", status: "succeeded" })
          .whereRaw("COALESCE((metadata->>'wallet_portion')::boolean, false) = true")
          .where("amount_aed", ">", 0)
          .select(["id", "amount_aed"]);

        for (const p of leftovers) {
          await addWalletBalance(
            transaction.user_id,
            Number(p.amount_aed),
            `Refund - booking paid in full by card #${transaction.booking_id}`,
            transaction.booking_id,
            "refund",
            trx
          );
          await trx("payment_transactions")
            .where({ id: p.id })
            .update({ status: "refunded", refunded_at: trx.fn.now(), updated_at: trx.fn.now() });
        }
      }

      await trx("bookings").where({ id: transaction.booking_id }).update({ status: "confirmed", updated_at: trx.fn.now() });

      if (existingMetadata.gift_id) {
        await trx("gifts").where({ id: existingMetadata.gift_id }).update({ status: "redeemed", redeemed_at: trx.fn.now() });
      }
    }

    // ---- Gift purchase
    let giftFollowUp = null;
    if (transaction.type === "gift_purchase" && transaction.gift_id) {
      const gift = await trx("gifts").where({ id: transaction.gift_id }).forUpdate().first();

      // The gift was cancelled (and any wallet part returned) before this card
      // payment came in. Don't send a half-paid gift: put the card amount in the wallet.
      if (gift && gift.status === "cancelled") {
        await addWalletBalance(
          transaction.user_id,
          Number(transaction.amount_aed),
          "Refund - gift was cancelled before payment finished",
          gift.id,
          "refund",
          trx
        );
        await trx("payment_transactions")
          .where({ id: transaction.id })
          .update({
            status: "refunded_to_wallet",
            refunded_at: trx.fn.now(),
            metadata: { ...existingMetadata, refund_destination: "wallet", refund_reason: "gift_cancelled", refund_amount: Number(transaction.amount_aed) },
            updated_at: trx.fn.now(),
          });
        await trx.commit();
        return { ok: true, refunded_to_wallet: true, gift_cancelled: true, transaction_id: transaction.id, gift_id: gift.id };
      }

      if (gift) {
        await trx("gifts").where({ id: gift.id }).update({ status: "active" });

        const { addPoints } = require("../controllers/rewardController");
        const rewarded = await trx("reward_transactions")
          .where({ user_id: transaction.user_id, type: "gift_sent", ref_id: gift.id })
          .first("id");
        if (!rewarded) await addPoints(transaction.user_id, 10, "gift_sent", gift.id, trx);

        const recipientPhone = existingMetadata.recipient_phone || gift.recipient_phone;
        const receiverUser = await trx("users").where({ phone: recipientPhone }).first("id", "name");

        giftFollowUp = {
          gift,
          recipientPhone,
          receiverUser,
          senderName: existingMetadata.sender_name || existingMetadata.name || gift.sender_name || "Someone special",
          amount: Number(gift.amount_aed || transaction.amount_aed || 0),
        };
      }
    }

    await trx.commit();

    // Messages go out only after the payment is safely saved.
    if (giftFollowUp) sendGiftMessages(giftFollowUp);

    return {
      ok: true,
      transaction_id: transaction.id,
      booking_id: transaction.booking_id || null,
      gift_id: transaction.gift_id || null,
      amount: Number(transaction.amount_aed || 0),
    };
  } catch (error) {
    try {
      await trx.rollback();
    } catch {}
    console.error("Ziina handle payment success error:", error.message);
    return { ok: false, error: error.message };
  }
}

function sendGiftMessages({ gift, recipientPhone, receiverUser, senderName, amount }) {
  setImmediate(async () => {
    if (receiverUser?.id) {
      try {
        const { notifyGiftReceived } = require("../utils/notifications");
        await notifyGiftReceived(receiverUser.id, gift.id, senderName, amount);
      } catch (e) {
        console.error("Gift push failed:", e?.message || e);
      }
    }

    try {
      const payload = {
        receiverName: receiverUser?.name || "there",
        senderName,
        giftLink: `${process.env.GLOWEE_WEB_BASE_URL}/gift/${gift.id}`,
        expiryText: new Date(gift.expires_at).toLocaleDateString("en-GB", {
          day: "2-digit",
          month: "short",
          year: "numeric",
          timeZone: "Asia/Dubai",
        }),
      };
      const wa = await sendGiftNotification(recipientPhone, payload);
      if (!wa?.ok) {
        const sms = await sendGiftSms(recipientPhone, payload);
        if (!sms?.ok) console.error("Gift WhatsApp and SMS both failed:", sms?.error);
      }
    } catch (e) {
      console.error("Gift message failed:", e?.message || e);
    }
  });
}

/** Subscription payment */
async function createSubscriptionPaymentIntent({ subscriptionId, salonId, amountAed, planName }) {
  try {
    const [payment] = await db("subscription_payments")
      .insert({
        subscription_id: subscriptionId,
        salon_id: salonId,
        provider: "ziina",
        amount_aed: Number(amountAed),
        currency_code: "AED",
        status: "pending",
        metadata: { plan_name: planName || null },
        created_at: db.fn.now(),
        updated_at: db.fn.now(),
      })
      .returning("*");

    const { data: pi } = await ziinaClient.post("/payment_intent", {
      amount: toFils(amountAed),
      currency_code: "AED",
      message: `Glowee Subscription · ${planName || "Salon Plan"}`,
      ...buildSubscriptionUrls(payment.id),
      test: false,
    });

    if (!pi?.id || !pi?.redirect_url) {
      await db("subscription_payments")
        .where({ id: payment.id })
        .update({
          status: "failed",
          metadata: { ...asObject(payment.metadata), error: "Ziina did not return a valid subscription payment intent" },
          updated_at: db.fn.now(),
        });
      return { ok: false, error: "Ziina did not return a valid subscription payment intent" };
    }

    await db("subscription_payments")
      .where({ id: payment.id })
      .update({
        provider_payment_id: pi.id,
        metadata: { ...asObject(payment.metadata), payment_url: pi.redirect_url, ziina_status: pi.status || "pending" },
        updated_at: db.fn.now(),
      });

    return {
      ok: true,
      payment_id: payment.id,
      payment_intent_id: pi.id,
      payment_url: pi.redirect_url,
      amount: Number(amountAed),
      status: pi.status || "pending",
    };
  } catch (error) {
    return ziinaError("create subscription payment intent", error);
  }
}

module.exports = {
  isZiinaPaid,
  createWalletTopupPaymentIntent,
  createBookingPaymentIntent,
  createGiftPaymentIntent,
  createSubscriptionPaymentIntent,
  getPaymentIntentStatus,
  handlePaymentIntentSuccess,
};