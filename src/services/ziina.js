// src/services/ziina.js
const axios = require("axios");
const db = require("../db/knex");
const crypto = require("crypto");
const { sendGiftNotification } = require("./whatsapp");
const { sendGiftSms } = require("./sms");

const ZIINA_API_URL = "https://api-v2.ziina.com/api";
const ZIINA_API_KEY = (process.env.ZIINA_API_KEY || "").trim();

if (!ZIINA_API_KEY) {
  console.warn("ZIINA_API_KEY is not set");
}

console.log(
  "ZIINA KEY SHA256:",
  crypto.createHash("sha256").update(ZIINA_API_KEY).digest("hex")
);
console.log("ZIINA KEY EXISTS:", !!ZIINA_API_KEY);
console.log("ZIINA KEY PREFIX:", ZIINA_API_KEY.slice(0, 12));
console.log("ZIINA KEY SUFFIX:", ZIINA_API_KEY.slice(-8));
console.log("ZIINA KEY LENGTH:", ZIINA_API_KEY.length);
console.log("ZIINA API URL:", ZIINA_API_URL);

const ziinaClient = axios.create({
  baseURL: ZIINA_API_URL,
  headers: {
    Authorization: `Bearer ${ZIINA_API_KEY}`,
    "Content-Type": "application/json",
  },
});

function buildWalletUrls(transactionId) {
  return {
    success_url: `${process.env.API_URL}/payments/ziina/wallet/success?transaction_id=${encodeURIComponent(
      String(transactionId)
    )}`,
    cancel_url: `${process.env.API_URL}/payments/ziina/wallet/cancel?transaction_id=${encodeURIComponent(
      String(transactionId)
    )}`,
  };
}

function buildBookingUrls(bookingId) {
  return {
    success_url: `${process.env.API_URL}/payments/ziina/booking/success?booking_id=${encodeURIComponent(
      String(bookingId)
    )}`,
    cancel_url: `${process.env.API_URL}/payments/ziina/booking/cancel?booking_id=${encodeURIComponent(
      String(bookingId)
    )}`,
  };
}

function buildGiftUrls(giftId) {
  return {
    success_url: `${process.env.API_URL}/payments/ziina/gift/success?gift_id=${encodeURIComponent(
      String(giftId)
    )}`,
    cancel_url: `${process.env.API_URL}/payments/ziina/gift/cancel?gift_id=${encodeURIComponent(
      String(giftId)
    )}`,
  };
}

function buildSubscriptionUrls(paymentId) {
  return {
    success_url: `${process.env.API_URL}/payments/ziina/subscription/success?payment_id=${encodeURIComponent(
      String(paymentId)
    )}`,
    cancel_url: `${process.env.API_URL}/payments/ziina/subscription/cancel?payment_id=${encodeURIComponent(
      String(paymentId)
    )}`,
  };
}

/**
 * Create payment intent for wallet topup
 */
async function createWalletTopupPaymentIntent(
  userId,
  amountAed,
  userPhone,
  userName,
  userEmail
) {
  try {
    const existingPending = await db("payment_transactions")
      .where({
        user_id: userId,
        provider: "ziina",
        type: "wallet_topup",
        status: "pending",
        amount_aed: Number(amountAed),
      })
      .whereRaw("created_at > NOW() - INTERVAL '15 minutes'")
      .orderBy("created_at", "desc")
      .first();

    if (existingPending?.metadata?.payment_url) {
      return {
        ok: true,
        payment_intent_id: existingPending.provider_payment_id,
        transaction_id: existingPending.id,
        payment_url: existingPending.metadata.payment_url,
        amount: Number(existingPending.amount_aed),
        status: existingPending.status,
        reused: true,
      };
    }
    // 1) create pending transaction first
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
        metadata: {
          phone: userPhone || null,
          email: userEmail || null,
          name: userName || null,
        },
        created_at: db.fn.now(),
        updated_at: db.fn.now(),
      })
      .returning("*");

    // 2) build success/cancel urls using transaction id
    const payload = {
      amount: Math.round(Number(amountAed) * 100),
      currency_code: "AED",
      message: "Glowee Top-up",
      ...buildWalletUrls(transaction.id),
      test: false,
    };

    console.log("Creating Ziina wallet payment intent...", {
      transactionId: transaction.id,
      amountAed,
    });
    console.log("ZIINA WALLET PAYLOAD:", payload);

    const response = await ziinaClient.post("/payment_intent", payload);
    const paymentIntent = response.data;

    if (!paymentIntent?.id || !paymentIntent?.redirect_url) {
      await db("payment_transactions")
        .where({ id: transaction.id })
        .update({
          status: "failed",
          error_message: "Ziina did not return a valid payment intent",
          updated_at: db.fn.now(),
        });

      return {
        ok: false,
        error: "Ziina did not return a valid payment intent",
      };
    }

    // 3) update transaction with payment intent info
    await db("payment_transactions")
      .where({ id: transaction.id })
      .update({
        provider_payment_id: paymentIntent.id,
        metadata: {
          ...(transaction.metadata || {}),
          payment_url: paymentIntent.redirect_url,
          ziina_status: paymentIntent.status || "pending",
        },
        updated_at: db.fn.now(),
      });

    return {
      ok: true,
      payment_intent_id: paymentIntent.id,
      transaction_id: transaction.id,
      payment_url: paymentIntent.redirect_url,
      amount: Number(amountAed),
      status: paymentIntent.status || "pending",
    };
  } catch (error) {
    console.error("Ziina create wallet payment intent error:", {
      status: error.response?.status,
      data: error.response?.data,
      message: error.message,
    });

    return {
      ok: false,
      error: error.response?.data?.message || error.message,
      code: error.response?.status,
    };
  }
}

/**
 * Create payment intent for booking payment
 */
async function createBookingPaymentIntent(
  userId,
  bookingId,
  amountAed,
  userPhone,
  userName,
  userEmail,
  metadata = {}
) {
  try {
    const existingPending = await db("payment_transactions")
      .where({
        user_id: userId,
        booking_id: bookingId,
        provider: "ziina",
        type: "booking_payment",
        status: "pending",
      })
      .whereRaw("created_at > NOW() - INTERVAL '15 minutes'")
      .orderBy("created_at", "desc")
      .first();

    if (existingPending?.metadata?.payment_url) {
      return {
        ok: true,
        payment_url: existingPending.metadata.payment_url,
        payment_intent_id: existingPending.provider_payment_id,
        transaction_id: existingPending.id,
        amount: Number(existingPending.amount_aed),
        status: existingPending.status,
        reused: true,
      };
    }
    const payload = {
      amount: Math.round(Number(amountAed) * 100),
      currency_code: "AED",
      message: "Glowee · Beauty Booking",
      ...buildBookingUrls(bookingId),
      test: false,
    };

    console.log("Creating Ziina booking payment intent...", {
      bookingId,
      amountAed,
      metadata,
    });
    console.log("ZIINA BOOKING PAYLOAD:", payload);

    const response = await ziinaClient.post("/payment_intent", payload);
    const pi = response.data;

    if (!pi?.id || !pi?.redirect_url) {
      return {
        ok: false,
        error: "Ziina did not return a valid booking payment intent",
      };
    }

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
    console.error("Ziina create booking payment intent error:", {
      status: error.response?.status,
      data: error.response?.data,
      message: error.message,
    });

    return {
      ok: false,
      error: error.response?.data?.message || error.message,
      code: error.response?.status,
    };
  }
}

/**
 * Create payment intent for gift payment
 */
async function createGiftPaymentIntent(
  userId,
  amountAed,
  recipientPhone,
  userPhone,
  userName,
  userEmail,
  metadata = {}
) {
  try {
    const giftId = metadata.gift_id || null;

    const existingPending = await db("payment_transactions")
      .where({
        user_id: userId,
        provider: "ziina",
        type: "gift_purchase",
        status: "pending",
      })
      .modify((qb) => {
        if (giftId) qb.where({ gift_id: giftId });
      })
      .whereRaw("created_at > NOW() - INTERVAL '15 minutes'")
      .orderBy("created_at", "desc")
      .first();

    if (existingPending?.metadata?.payment_url) {
      return {
        ok: true,
        payment_url: existingPending.metadata.payment_url,
        payment_intent_id: existingPending.provider_payment_id,
        transaction_id: existingPending.id,
        amount: Number(existingPending.amount_aed),
        status: existingPending.status,
        reused: true,
      };
    }

    const payload = {
      amount: Math.round(Number(amountAed) * 100),
      currency_code: "AED",
      message: "Glowee Gift Payment",
      ...buildGiftUrls(giftId),
      test: false,
    };

    console.log("Creating Ziina gift payment intent...", {
      amountAed,
      recipientPhone,
      metadata,
    });
    console.log("ZIINA GIFT PAYLOAD:", payload);

    const response = await ziinaClient.post("/payment_intent", payload);
    const pi = response.data;

    if (!pi?.id || !pi?.redirect_url) {
      return {
        ok: false,
        error: "Ziina did not return a valid gift payment intent",
      };
    }

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
    console.error("Ziina create gift payment intent error:", {
      status: error.response?.status,
      data: error.response?.data,
      message: error.message,
    });

    return {
      ok: false,
      error: error.response?.data?.message || error.message,
      code: error.response?.status,
    };
  }
}

/**
 * Fetch payment intent status from Ziina
 */
async function getPaymentIntentStatus(paymentIntentId) {
  try {
    const response = await ziinaClient.get(`/payment_intent/${paymentIntentId}`);
    const paymentIntent = response.data;

    return {
      ok: true,
      status: paymentIntent.status,
      amount: paymentIntent.amount ? paymentIntent.amount / 100 : null,
      raw: paymentIntent,
    };
  } catch (error) {
    console.error("Ziina get payment intent status error:", {
      status: error.response?.status,
      data: error.response?.data,
      message: error.message,
    });

    return {
      ok: false,
      error: error.response?.data?.message || error.message,
    };
  }
}

/**
 * Mark successful Ziina payment and apply business logic
 */
async function handlePaymentIntentSuccess(paymentIntentId, paymentIntentData = {}) {
  const trx = await db.transaction();

  try {
    console.log("ZIINA SUCCESS paymentIntentId =>", paymentIntentId);

    const transaction = await trx("payment_transactions")
      .where({
        provider_payment_id: paymentIntentId,
        provider: "ziina",
      })
      .first();

    console.log("ZIINA SUCCESS transaction =>", transaction);

    if (!transaction) {
      await trx.rollback();
      return {
        ok: false,
        error: "Transaction not found",
      };
    }

    if (transaction.status === "succeeded") {
      await trx.commit();
      return {
        ok: true,
        already_processed: true,
        transaction_id: transaction.id,
        booking_id: transaction.booking_id || null,
        gift_id: transaction.gift_id || null,
        amount: Number(transaction.amount_aed || 0),
      };
    }

    let paymentMethodType = "card";
    let cardLast4 = null;
    let cardBrand = null;

    const source =
      paymentIntentData?.payment_method ||
      paymentIntentData?.source ||
      null;

    if (source) {
      cardLast4 = source.last4 || source.last_four || null;
      cardBrand = source.brand || source.scheme || null;

      if (String(cardBrand || "").toLowerCase().includes("apple")) {
        paymentMethodType = "apple_pay";
      }
    }

    const existingMetadata =
      typeof transaction.metadata === "object" && transaction.metadata !== null
        ? transaction.metadata
        : {};

    await trx("payment_transactions")
      .where({ id: transaction.id })
      .update({
        status: "succeeded",
        succeeded_at: trx.fn.now(),
        payment_method_type: paymentMethodType,
        card_last4: cardLast4,
        card_brand: cardBrand,
        metadata: {
          ...existingMetadata,
          ziina_status: paymentIntentData?.status || "succeeded",
          ziina_payment_intent: paymentIntentData,
        },
        updated_at: trx.fn.now(),
      });

    console.log("ZIINA SUCCESS updated transaction to succeeded =>", transaction.id);

    if (transaction.type === "wallet_topup") {
      const { addWalletBalance } = require("../controllers/walletController");
      const { addPoints } = require("../controllers/rewardController");

      await addWalletBalance(
        transaction.user_id,
        Number(transaction.net_amount_aed),
        `Wallet topup via Ziina${cardBrand ? ` (${cardBrand})` : ""}`,
        transaction.id,
        "topup",
        trx
      );

      if (Number(transaction.net_amount_aed) >= 100) {
        await addPoints(transaction.user_id, 20, "wallet_topup", transaction.id, trx);
      }
    }

    if (transaction.type === "booking_payment" && transaction.booking_id) {
      const existingSucceededBookingPayment = await trx("payment_transactions")
        .where({
          booking_id: transaction.booking_id,
          type: "booking_payment",
          status: "succeeded",
        })
        .whereNot({ id: transaction.id })
        .first();

      if (existingSucceededBookingPayment) {
        console.warn("DUPLICATE BOOKING PAYMENT DETECTED =>", {
          bookingId: transaction.booking_id,
          originalTransactionId: existingSucceededBookingPayment.id,
          duplicateTransactionId: transaction.id,
        });

        const { addWalletBalance } = require("../controllers/walletController");

        await addWalletBalance(
          transaction.user_id,
          Number(transaction.net_amount_aed || transaction.amount_aed || 0),
          `Duplicate booking payment refunded to wallet`,
          transaction.id,
          "duplicate_payment_refund",
          trx
        );

        await trx("payment_transactions")
          .where({ id: transaction.id })
          .update({
            status: "refunded_to_wallet",
            refunded_at: trx.fn.now(),
            metadata: {
              ...existingMetadata,
              duplicate_of_transaction_id: existingSucceededBookingPayment.id,
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

      console.log("UPDATING BOOKING TO CONFIRMED =>", transaction.booking_id);

      await trx("bookings")
        .where({ id: transaction.booking_id })
        .update({
          status: "confirmed",
          updated_at: trx.fn.now(),
        });

      const giftId = existingMetadata?.gift_id || null;

      if (giftId) {
        await trx("gifts")
          .where({ id: giftId })
          .update({
            status: "redeemed",
            redeemed_at: trx.fn.now(),
          });
      }
    }

if (transaction.type === "gift_purchase" && transaction.gift_id) {
  const gift = await trx("gifts")
    .where({ id: transaction.gift_id })
    .first();

  if (gift) {
    await trx("gifts")
      .where({ id: transaction.gift_id })
      .update({
        status: "active",
      });

    const { addPoints } = require("../controllers/rewardController");

    const alreadyRewarded = await trx("reward_transactions")
      .where({
        user_id: transaction.user_id,
        type: "gift_sent",
        ref_id: transaction.gift_id,
      })
      .first();

    if (!alreadyRewarded) {
      await addPoints(
        transaction.user_id,
        10,
        "gift_sent",
        transaction.gift_id,
        trx
      );
    }

    const metadata =
      typeof transaction.metadata === "object" && transaction.metadata !== null
        ? transaction.metadata
        : {};

        const senderName =
          metadata.sender_name ||
          metadata.name ||
          gift.sender_name ||
          "Someone special";

        const merchantName = metadata.merchant_name || null;
        const themeEmoji = metadata.theme_emoji || "🎁";
        const giftType = gift.salon_id ? "service" : "wallet";
        const recipientPhone = metadata.recipient_phone || gift.recipient_phone;
        const giftCode = metadata.gift_code || gift.code;

        const receiverUser = await trx("users")
          .where({ phone: recipientPhone })
          .first("id");

        await trx.commit();

        if (receiverUser?.id) {
          setImmediate(async () => {
            try {
              const { notifyGiftReceived } = require("../utils/notifications");
              await notifyGiftReceived(
                receiverUser.id,
                gift.id,
                senderName,
                Number(gift.amount_aed || transaction.amount_aed || 0)
              );
            } catch (e) {
              console.error("Gift push notification failed after Ziina success:", e?.message || e);
            }
          });
        }

        setImmediate(async () => {
          try {
            const receiverUserData = await db("users")
              .where({ phone: recipientPhone })
              .first("name");

            const payload = {
              receiverName: receiverUserData?.name || "there",
              senderName,
              giftLink: `${process.env.GLOWEE_WEB_BASE_URL}/gift/${gift.id}`,
              expiryText: new Date(gift.expires_at).toLocaleDateString("en-GB", {
                day: "2-digit",
                month: "short",
                year: "numeric",
              }),
            };

            const waResult = await sendGiftNotification(recipientPhone, payload);

            if (!waResult?.ok) {
              console.warn("WhatsApp failed, falling back to SMS:", waResult?.error);

              const smsResult = await sendGiftSms(recipientPhone, payload);

              if (!smsResult?.ok) {
                console.error("Gift SMS also failed:", smsResult?.error);
              }
            }
          } catch (e) {
            console.error(
              "Gift notification flow failed after Ziina success:",
              e?.message || e
            );
          }
        });

        return {
          ok: true,
          transaction_id: transaction.id,
          booking_id: transaction.booking_id || null,
          gift_id: transaction.gift_id || null,
          amount: Number(transaction.amount_aed || 0),
        };
      }
    }


    await trx.commit();

    return {
      ok: true,
      transaction_id: transaction.id,
      booking_id: transaction.booking_id || null,
      gift_id: transaction.gift_id || null,
      amount: Number(transaction.amount_aed || 0),
    };
  } catch (error) {
    await trx.rollback();
    console.error("Ziina handle payment success error:", error);
    return {
      ok: false,
      error: error.message,
    };
  }
}

async function createSubscriptionPaymentIntent({
  subscriptionId,
  salonId,
  amountAed,
  planName,
}) {
  try {
    const [payment] = await db("subscription_payments")
      .insert({
        subscription_id: subscriptionId,
        salon_id: salonId,
        provider: "ziina",
        amount_aed: Number(amountAed),
        currency_code: "AED",
        status: "pending",
        metadata: {
          plan_name: planName || null,
        },
        created_at: db.fn.now(),
        updated_at: db.fn.now(),
      })
      .returning("*");

    const payload = {
      amount: Math.round(Number(amountAed) * 100),
      currency_code: "AED",
      message: `Glowee Subscription · ${planName || "Salon Plan"}`,
      ...buildSubscriptionUrls(payment.id),
      test: false,
    };

    console.log("ZIINA SUBSCRIPTION PAYLOAD:", payload);

    const response = await ziinaClient.post("/payment_intent", payload);
    const pi = response.data;

    if (!pi?.id || !pi?.redirect_url) {
      await db("subscription_payments")
        .where({ id: payment.id })
        .update({
          status: "failed",
          metadata: {
            ...(payment.metadata || {}),
            error: "Ziina did not return a valid subscription payment intent",
          },
          updated_at: db.fn.now(),
        });

      return {
        ok: false,
        error: "Ziina did not return a valid subscription payment intent",
      };
    }

    await db("subscription_payments")
      .where({ id: payment.id })
      .update({
        provider_payment_id: pi.id,
        metadata: {
          ...(payment.metadata || {}),
          payment_url: pi.redirect_url,
          ziina_status: pi.status || "pending",
        },
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
    console.error("Ziina create subscription payment intent error:", {
      status: error.response?.status,
      data: error.response?.data,
      message: error.message,
    });

    return {
      ok: false,
      error: error.response?.data?.message || error.message,
      code: error.response?.status,
    };
  }
}

module.exports = {
  createWalletTopupPaymentIntent,
  createBookingPaymentIntent,
  createGiftPaymentIntent,
  createSubscriptionPaymentIntent,
  getPaymentIntentStatus,
  handlePaymentIntentSuccess,
};