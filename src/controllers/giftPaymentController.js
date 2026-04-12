// src/controllers/giftPaymentController.js

const db = require("../db/knex");
const ziinaService = require("../services/ziina");
const { spendWalletBalance, addWalletBalance } = require("./walletController");
const { addPoints } = require("./rewardController");
const { sendGiftNotification } = require("../services/whatsapp");

/**
 * POST /gifts/send-with-payment
 * Send gift with payment
 *
 * Body:
 * {
 *   "recipient_phone": "+971501234567",
 *   "gift_type": "money" | "service",
 *   "amount_aed": 200,
 *   "service_items": [...], // Only for service gifts
 *   "payment_method": "card" | "wallet" | "split",
 *   "message": "Happy Birthday!",
 *   "sender_name": "Ali",
 *   "theme_id": "birthday",
 *   "salon_id": "uuid | null"
 * }
 */
const sendGiftWithPayment = async (req, res, next) => {
  const trx = await db.transaction();

  try {
    const {
      recipient_phone,
      gift_type,
      amount_aed,
      service_items,
      payment_method,
      message,
      sender_name,
      theme_id,
      salon_id,
    } = req.body;

    const userId = req.user.sub;
    const user = await trx("users").where({ id: userId }).first();

    if (!user) {
      await trx.rollback();
      return res.status(404).json({ error: "User not found" });
    }

    if (!recipient_phone) {
      await trx.rollback();
      return res.status(400).json({ error: "recipient_phone is required" });
    }

    if (!["money", "service"].includes(gift_type)) {
      await trx.rollback();
      return res.status(400).json({
        error: "Invalid gift type",
        valid_types: ["money", "service"],
      });
    }

    const totalAmount = Number(amount_aed);

    if (!Number.isFinite(totalAmount) || totalAmount <= 0) {
      await trx.rollback();
      return res.status(400).json({ error: "Invalid amount_aed" });
    }

    if (gift_type === "service" && (!Array.isArray(service_items) || service_items.length === 0)) {
      await trx.rollback();
      return res.status(400).json({
        error: "service_items are required for service gifts",
      });
    }

    // money gift => only card
    if (gift_type === "money" && payment_method !== "card") {
      await trx.rollback();
      return res.status(400).json({
        error: "Money gifts must be paid with card/Apple Pay",
        valid_methods: ["card"],
        reason: "Money gifts cannot be paid from wallet",
      });
    }

    // service gift => wallet/card/split
    if (gift_type === "service" && !["wallet", "card", "split"].includes(payment_method)) {
      await trx.rollback();
      return res.status(400).json({
        error: "Invalid payment method for service gift",
        valid_methods: ["wallet", "card", "split"],
      });
    }

    const { v4: uuidv4 } = require("uuid");
    const giftCode = uuidv4().replace(/-/g, "").slice(0, 12).toUpperCase();
    const expiresAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);

    let salonName = null;
    if (salon_id) {
      const salon = await trx("salons").where({ id: salon_id }).first("name");
      salonName = salon?.name || null;
    }

    const safeSenderName = sender_name || user.name || "Someone special";
    const themeEmoji =
      theme_id === "birthday"
        ? "🎂"
        : theme_id === "wedding"
        ? "💍"
        : theme_id === "anniversary"
        ? "💐"
        : "🎁";

    // ========================================
    // 1) WALLET ONLY (service gifts only)
    // ========================================
    if (payment_method === "wallet") {
      if (gift_type === "money") {
        await trx.rollback();
        return res.status(400).json({
          error: "Cannot pay for money gifts with wallet",
        });
      }

      const wallet = await trx("wallets").where({ user_id: userId }).first();
      const walletBalance = wallet ? Number(wallet.balance_aed) : 0;

      if (walletBalance < totalAmount) {
        await trx.rollback();
        return res.status(400).json({
          error: "Insufficient wallet balance",
          wallet_balance: walletBalance,
          required: totalAmount,
          shortfall: totalAmount - walletBalance,
        });
      }

      const [gift] = await trx("gifts")
        .insert({
          sender_user_id: userId,
          recipient_phone,
          salon_id: salon_id || null,
          amount_aed: totalAmount,
          code: giftCode,
          expires_at: expiresAt,
          message: message || null,
          theme_id: theme_id || null,
          sender_name: safeSenderName,
          status: "active",
          created_at: trx.fn.now(),
        })
        .returning("*");

      if (Array.isArray(service_items) && service_items.length > 0) {
        for (const item of service_items) {
          await trx("gift_items").insert({
            gift_id: gift.id,
            service_availability_id: item.availability_id,
            service_name: item.service_name || "Service",
            qty: Number(item.qty || 1),
            unit_price_aed: Number(item.unit_price_aed || 0),
            line_total_aed: Number(item.unit_price_aed || 0) * Number(item.qty || 1),
            duration_mins: Number(item.duration_mins || 0),
            created_at: trx.fn.now(),
          });
        }
      }

      await spendWalletBalance(
        userId,
        totalAmount,
        `Gift sent to ${recipient_phone}`,
        gift.id,
        "gift_sent",
        trx
      );

      await addPoints(userId, 10, "gift_sent", gift.id, trx);

      await trx("payment_transactions").insert({
        user_id: userId,
        provider: "wallet",
        type: "gift_purchase",
        status: "succeeded",
        amount_aed: totalAmount,
        net_amount_aed: totalAmount,
        gift_id: gift.id,
        payment_method_type: "wallet",
        succeeded_at: trx.fn.now(),
        created_at: trx.fn.now(),
      });

      await trx.commit();

      setImmediate(() => {
        sendGiftNotification(recipient_phone, {
          code: giftCode,
          senderName: safeSenderName,
          giftType: salon_id ? "service" : "wallet",
          merchantName: salonName,
          themeEmoji,
        }).catch((err) => {
          console.error("Gift WhatsApp failed (wallet flow):", err?.message || err);
        });
      });

      return res.json({
        ok: true,
        gift_id: gift.id,
        code: giftCode,
        payment_method: "wallet",
        amount_paid: totalAmount,
      });
    }

    // ========================================
    // 2) CARD ONLY
    // ========================================
    if (payment_method === "card") {
      const [gift] = await trx("gifts")
        .insert({
          sender_user_id: userId,
          recipient_phone,
          salon_id: salon_id || null,
          amount_aed: totalAmount,
          code: giftCode,
          expires_at: expiresAt,
          message: message || null,
          theme_id: theme_id || null,
          sender_name: safeSenderName,
          status: "pending",
          created_at: trx.fn.now(),
        })
        .returning("*");

      if (gift_type === "service" && Array.isArray(service_items) && service_items.length > 0) {
        for (const item of service_items) {
          await trx("gift_items").insert({
            gift_id: gift.id,
            service_availability_id: item.availability_id,
            service_name: item.service_name || "Service",
            qty: Number(item.qty || 1),
            unit_price_aed: Number(item.unit_price_aed || 0),
            line_total_aed: Number(item.unit_price_aed || 0) * Number(item.qty || 1),
            duration_mins: Number(item.duration_mins || 0),
            created_at: trx.fn.now(),
          });
        }
      }

      await trx.commit();

      const ziinaResult = await ziinaService.createGiftPaymentIntent(
        userId,
        totalAmount,
        recipient_phone,
        user.phone,
        user.name,
        user.email,
        {
          gift_id: gift.id,
          gift_type,
          gift_code: giftCode,
          sender_name: safeSenderName,
          merchant_name: salonName,
          theme_emoji: themeEmoji,
        }
      );

      if (!ziinaResult.ok) {
        await db("gifts").where({ id: gift.id }).update({ status: "cancelled" });

        return res.status(400).json({
          error: ziinaResult.error,
          code: ziinaResult.code,
        });
      }

      return res.json({
        ok: true,
        gift_id: gift.id,
        payment_method: "card",
        provider: "ziina",
        payment_url: ziinaResult.payment_url,
        payment_intent_id: ziinaResult.payment_intent_id,
        transaction_id: ziinaResult.transaction_id,
        amount: totalAmount,
      });
    }

    // ========================================
    // 3) SPLIT (service gifts only)
    // ========================================
    if (payment_method === "split") {
      if (gift_type === "money") {
        await trx.rollback();
        return res.status(400).json({
          error: "Cannot use split payment for money gifts",
          valid_methods: ["card"],
        });
      }

      const wallet = await trx("wallets").where({ user_id: userId }).first();
      const walletBalance = wallet ? Number(wallet.balance_aed) : 0;

      if (walletBalance === 0) {
        await trx.rollback();
        return res.status(400).json({
          error: "No wallet balance for split payment",
          suggestion: "Use card payment instead",
        });
      }

      const walletAmount = Math.min(walletBalance, totalAmount);
      const cardAmount = totalAmount - walletAmount;

      const [gift] = await trx("gifts")
        .insert({
          sender_user_id: userId,
          recipient_phone,
          salon_id: salon_id || null,
          amount_aed: totalAmount,
          code: giftCode,
          expires_at: expiresAt,
          message: message || null,
          theme_id: theme_id || null,
          sender_name: safeSenderName,
          status: "pending",
          created_at: trx.fn.now(),
        })
        .returning("*");

      if (Array.isArray(service_items) && service_items.length > 0) {
        for (const item of service_items) {
          await trx("gift_items").insert({
            gift_id: gift.id,
            service_availability_id: item.availability_id,
            service_name: item.service_name || "Service",
            qty: Number(item.qty || 1),
            unit_price_aed: Number(item.unit_price_aed || 0),
            line_total_aed: Number(item.unit_price_aed || 0) * Number(item.qty || 1),
            duration_mins: Number(item.duration_mins || 0),
            created_at: trx.fn.now(),
          });
        }
      }

      await spendWalletBalance(
        userId,
        walletAmount,
        `Partial gift payment to ${recipient_phone}`,
        gift.id,
        "gift_sent",
        trx
      );

      await trx("payment_transactions").insert({
        user_id: userId,
        provider: "wallet",
        type: "gift_purchase",
        status: "succeeded",
        amount_aed: walletAmount,
        net_amount_aed: walletAmount,
        gift_id: gift.id,
        payment_method_type: "wallet",
        succeeded_at: trx.fn.now(),
        metadata: { split_payment: true },
        created_at: trx.fn.now(),
      });

      await trx.commit();

      const ziinaResult = await ziinaService.createGiftPaymentIntent(
        userId,
        cardAmount,
        recipient_phone,
        user.phone,
        user.name,
        user.email,
        {
          gift_id: gift.id,
          gift_type,
          split_payment: true,
          wallet_used: walletAmount,
          gift_code: giftCode,
          sender_name: safeSenderName,
          merchant_name: salonName,
          theme_emoji: themeEmoji,
        }
      );

      if (!ziinaResult.ok) {
        const refundTrx = await db.transaction();

        try {
          await addWalletBalance(
            userId,
            walletAmount,
            "Refund - Split payment failed",
            gift.id,
            "refund",
            refundTrx
          );

          await refundTrx.commit();
        } catch (refundError) {
          await refundTrx.rollback();
          console.error("Split gift wallet refund failed:", refundError);
        }

        await db("gifts").where({ id: gift.id }).update({ status: "cancelled" });

        return res.status(400).json({
          error: ziinaResult.error,
          wallet_refunded: true,
        });
      }

      return res.json({
        ok: true,
        gift_id: gift.id,
        payment_method: "split",
        provider: "ziina",
        wallet_amount: walletAmount,
        card_amount: cardAmount,
        payment_url: ziinaResult.payment_url,
        payment_intent_id: ziinaResult.payment_intent_id,
        transaction_id: ziinaResult.transaction_id,
      });
    }

    await trx.rollback();
    return res.status(400).json({
      error: "Invalid payment method",
    });
  } catch (error) {
    try {
      await trx.rollback();
    } catch {}
    next(error);
  }
};

/**
 * GET /gifts/payment-options
 * Get available payment options for sending a gift
 */
const getGiftPaymentOptions = async (req, res, next) => {
  try {
    const { gift_type, amount_aed } = req.query;
    const userId = req.user.sub;

    if (!gift_type || !amount_aed) {
      return res.status(400).json({
        error: "gift_type and amount_aed required",
      });
    }

    const totalAmount = Number(amount_aed);
    const wallet = await db("wallets").where({ user_id: userId }).first();
    const walletBalance = wallet ? Number(wallet.balance_aed) : 0;

    const options = {
      gift_type,
      total_amount: totalAmount,
      wallet_balance: walletBalance,
      payment_methods: [],
    };

    if (gift_type === "money") {
      options.payment_methods.push({
        method: "card",
        label: "Pay with Card/Apple Pay",
        amount: totalAmount,
        available: true,
        providers: ["visa", "mastercard", "mada", "apple_pay", "google_pay"],
        required: true,
        note: "Money gifts must be paid with card",
      });
    }

    if (gift_type === "service") {
      if (walletBalance >= totalAmount) {
        options.payment_methods.push({
          method: "wallet",
          label: "Pay from Wallet",
          amount: totalAmount,
          available: true,
        });
      }

      options.payment_methods.push({
        method: "card",
        label: "Pay with Card/Apple Pay",
        amount: totalAmount,
        available: true,
        providers: ["visa", "mastercard", "mada", "apple_pay", "google_pay"],
      });

      if (walletBalance > 0 && walletBalance < totalAmount) {
        options.payment_methods.push({
          method: "split",
          label: "Wallet + Card",
          wallet_amount: walletBalance,
          card_amount: totalAmount - walletBalance,
          available: true,
          description: `Pay AED ${walletBalance} from wallet + AED ${(totalAmount - walletBalance).toFixed(2)} with card`,
        });
      }
    }

    return res.json({
      ok: true,
      ...options,
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  sendGiftWithPayment,
  getGiftPaymentOptions,
};