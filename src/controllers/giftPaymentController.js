// src/controllers/giftPaymentController.js
const db = require("../db/knex");
const crypto = require("crypto");
const ziinaService = require("../services/ziina");
const { spendWalletBalance, addWalletBalance } = require("./walletController");
const { addPoints } = require("./rewardController");
const { sendGiftNotification } = require("../services/whatsapp");
const { notifyGiftReceived } = require("../utils/notifications");

const MIN_CARD_PAYMENT_AED = 2;
const MONEY_GIFT_MIN_AED = 10;
const MONEY_GIFT_MAX_AED = 5000;
const MAX_ITEMS = 10;
const MAX_QTY = 5;

const toNum = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const round2 = (n) => Math.round(n * 100) / 100;

function normalizeUAEPhone(input) {
  let p = String(input || "").trim().replace(/[\s-]+/g, "");
  if (p.startsWith("00")) p = "+" + p.slice(2);
  if (/^05\d{8}$/.test(p)) return "+971" + p.slice(1);
  if (/^5\d{8}$/.test(p)) return "+971" + p;
  if (/^9715\d{8}$/.test(p)) return "+" + p;
  if (/^\+9710\d{8}$/.test(p)) return "+971" + p.slice(5);
  return p;
}
const isValidUAEPhone = (p) => /^\+9715\d{8}$/.test(p);

function giftFee(type, subtotal) {
  if (subtotal <= 0) return 0;
  return type === "money" ? 4.95 : type === "service" ? 3.95 : 0;
}

/**
 * Prices for a service gift come from the salon's own price list, never from
 * the app. Every item must be an active service of the chosen salon.
 */
async function priceServiceItems(salonId, items, trx = db) {
  if (!Array.isArray(items) || !items.length) throw Object.assign(new Error("Choose at least one service"), { status: 400 });
  if (items.length > MAX_ITEMS) throw Object.assign(new Error(`A gift can have up to ${MAX_ITEMS} services`), { status: 400 });

  const ids = items.map((i) => i?.availability_id).filter(Boolean);
  if (ids.length !== items.length) throw Object.assign(new Error("A service is missing"), { status: 400 });

  const rows = await trx("service_availability as sa")
    .join("services as s", "s.id", "sa.service_id")
    .join("branches as b", "b.id", "sa.branch_id")
    .whereIn("sa.id", ids)
    .where("sa.is_active", true)
    .where("s.is_active", true)
    .where("b.is_active", true)
    .select(["sa.id", "sa.price_aed", "sa.duration_mins", "s.name as service_name", "b.salon_id"]);

  // All services must be from one salon (the one the app says, if it says one).
  const salons = new Set(rows.map((r) => r.salon_id));
  if (salons.size > 1 || (salonId && rows.length && !salons.has(salonId))) {
    throw Object.assign(new Error("All services in a gift must be from the same salon"), { status: 400 });
  }
  const resolvedSalonId = rows[0]?.salon_id || salonId || null;

  const byId = new Map(rows.map((r) => [r.id, r]));
  const priced = items.map((i) => {
    const row = byId.get(i.availability_id);
    if (!row) throw Object.assign(new Error("One of the services is no longer available. Refresh and try again."), { status: 400 });
    const qty = Math.min(MAX_QTY, Math.max(1, Math.floor(toNum(i.qty ?? i.quantity ?? 1))));
    const unit = round2(toNum(row.price_aed));
    return {
      service_availability_id: row.id,
      service_name: row.service_name,
      qty,
      unit_price_aed: unit,
      line_total_aed: round2(unit * qty),
      duration_mins: toNum(row.duration_mins),
    };
  });

  return { items: priced, salon_id: resolvedSalonId, subtotal: round2(priced.reduce((s, i) => s + i.line_total_aed, 0)) };
}

async function priceGift({ gift_type, amount_aed, salon_id, service_items }, trx = db) {
  if (gift_type === "money") {
    const amount = round2(toNum(amount_aed));
    if (amount < MONEY_GIFT_MIN_AED || amount > MONEY_GIFT_MAX_AED) {
      throw Object.assign(new Error(`Gift amount must be between AED ${MONEY_GIFT_MIN_AED} and AED ${MONEY_GIFT_MAX_AED}`), { status: 400 });
    }
    const fee = giftFee("money", amount);
    return { items: [], salon_id: null, subtotal_aed: amount, gift_fee_aed: fee, total_aed: round2(amount + fee) };
  }
  if (gift_type === "service") {
    const { items, subtotal, salon_id: resolved } = await priceServiceItems(salon_id, service_items, trx);
    const fee = giftFee("service", subtotal);
    return { items, salon_id: resolved, subtotal_aed: subtotal, gift_fee_aed: fee, total_aed: round2(subtotal + fee) };
  }
  throw Object.assign(new Error("Invalid gift type"), { status: 400 });
}

const insertItems = (trx, giftId, items) =>
  items.length ? trx("gift_items").insert(items.map((i) => ({ gift_id: giftId, ...i, created_at: trx.fn.now() }))) : null;

function notifyRecipient(phone, giftId, senderName, amount, expiresAt) {
  setImmediate(async () => {
    try {
      const receiver = await db("users").where({ phone }).first("id", "name");
      if (receiver) await notifyGiftReceived(receiver.id, giftId, senderName, amount);
      await sendGiftNotification(phone, {
        receiverName: receiver?.name || "there",
        senderName,
        giftLink: `${process.env.GLOWEE_WEB_BASE_URL}/gift/${giftId}`,
        expiryText: new Date(expiresAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Dubai" }),
      });
    } catch (err) {
      console.error("Gift notification failed:", err?.message || err);
    }
  });
}

/**
 * POST /gifts/send-with-payment
 * Body: { recipient_phone, gift_type: "money"|"service", amount_aed?, salon_id?, service_items?: [{ availability_id, qty }],
 *         payment_method: "card"|"wallet"|"split", message?, sender_name?, theme_id? }
 */
const sendGiftWithPayment = async (req, res, next) => {
  const trx = await db.transaction();
  let open = true;
  const close = async (fn) => {
    open = false;
    await fn();
  };

  try {
    const { recipient_phone, gift_type, amount_aed, service_items, payment_method, message, sender_name, theme_id, salon_id } = req.body || {};
    const userId = req.user.sub;

    const user = await trx("users").where({ id: userId }).first();
    if (!user) {
      await close(() => trx.rollback());
      return res.status(404).json({ error: "User not found" });
    }

    const recipientPhone = normalizeUAEPhone(recipient_phone);
    if (!isValidUAEPhone(recipientPhone)) {
      await close(() => trx.rollback());
      return res.status(400).json({ error: "Enter a UAE mobile number for the person receiving the gift" });
    }

    // Money gifts are card only (not paid from wallet), service gifts any method.
    const allowed = gift_type === "money" ? ["card"] : ["wallet", "card", "split"];
    if (!allowed.includes(payment_method)) {
      await close(() => trx.rollback());
      return res.status(400).json({ error: "This payment method isn't available for this gift", valid_methods: allowed });
    }

    const pricing = await priceGift({ gift_type, amount_aed, salon_id: gift_type === "service" ? salon_id : null, service_items }, trx);
    const { subtotal_aed: subtotal, gift_fee_aed: fee, total_aed: total } = pricing;

    // Money gifts are general Glowee credit; service gifts belong to their salon.
    const salonId = pricing.salon_id;
    const salon = salonId ? await trx("salons").where({ id: salonId }).first("name") : null;
    const safeSenderName = String(sender_name || user.name || "Someone special").slice(0, 60);
    const giftCode = crypto.randomBytes(9).toString("base64url").replace(/[-_]/g, "").slice(0, 12).toUpperCase();
    const expiresAt = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
    const themeEmoji = { birthday: "🎂", wedding: "💍", anniversary: "💐" }[theme_id] || "🎁";

    const giftRow = (status) => ({
      sender_user_id: userId,
      recipient_phone: recipientPhone,
      salon_id: salonId,
      amount_aed: subtotal,
      subtotal_aed: subtotal,
      gift_fee_aed: fee,
      total_aed: total,
      code: giftCode,
      expires_at: expiresAt,
      message: message ? String(message).slice(0, 500) : null,
      theme_id: theme_id || null,
      sender_name: safeSenderName,
      status,
      created_at: trx.fn.now(),
    });

    const ziinaMeta = (giftId, extra = {}) => ({
      gift_id: giftId,
      gift_type,
      gift_code: giftCode,
      sender_name: safeSenderName,
      merchant_name: salon?.name || null,
      theme_emoji: themeEmoji,
      subtotal_aed: subtotal,
      gift_fee_aed: fee,
      total_aed: total,
      ...extra,
    });

    // ---- Wallet only (service gifts)
    if (payment_method === "wallet") {
      const [gift] = await trx("gifts").insert(giftRow("active")).returning("*");
      await insertItems(trx, gift.id, pricing.items);

      try {
        await spendWalletBalance(userId, total, `Gift sent to ${recipientPhone}`, gift.id, "gift_sent", trx);
      } catch (e) {
        if (e.code !== "INSUFFICIENT_BALANCE") throw e;
        await close(() => trx.rollback());
        return res.status(400).json({ error: "Insufficient wallet balance", required: total });
      }

      await addPoints(userId, 10, "gift_sent", gift.id, trx);
      await trx("payment_transactions").insert({
        user_id: userId,
        provider: "wallet",
        type: "gift_purchase",
        status: "succeeded",
        amount_aed: total,
        fee_aed: fee,
        net_amount_aed: total,
        gift_id: gift.id,
        payment_method_type: "wallet",
        metadata: { gift_type, subtotal_aed: subtotal, gift_fee_aed: fee, total_aed: total },
        succeeded_at: trx.fn.now(),
        created_at: trx.fn.now(),
      });

      await close(() => trx.commit());
      notifyRecipient(recipientPhone, gift.id, safeSenderName, subtotal, gift.expires_at);
      return res.json({ ok: true, gift_id: gift.id, code: giftCode, payment_method: "wallet", amount_paid: total });
    }

    // ---- Card only
    if (payment_method === "card") {
      const [gift] = await trx("gifts").insert(giftRow("pending")).returning("*");
      await insertItems(trx, gift.id, pricing.items);
      await close(() => trx.commit());

      const r = await ziinaService.createGiftPaymentIntent(userId, total, recipientPhone, user.phone, user.name, user.email, ziinaMeta(gift.id));
      if (!r.ok) {
        await db("gifts").where({ id: gift.id }).update({ status: "cancelled" });
        return res.status(400).json({ error: r.error, code: r.code });
      }

      return res.json({
        ok: true,
        gift_id: gift.id,
        payment_method: "card",
        provider: "ziina",
        payment_url: r.payment_url,
        payment_intent_id: r.payment_intent_id,
        transaction_id: r.transaction_id,
        amount: total,
      });
    }

    // ---- Wallet + card (service gifts)
    const w = await trx("wallets").where({ user_id: userId }).first("balance_aed");
    const walletBalance = round2(Number(w?.balance_aed || 0));
    if (walletBalance <= 0) {
      await close(() => trx.rollback());
      return res.status(400).json({ error: "No wallet balance for split payment", suggestion: "Use card payment instead" });
    }
    const walletAmount = Math.min(walletBalance, total);
    const cardAmount = round2(total - walletAmount);
    if (cardAmount < MIN_CARD_PAYMENT_AED) {
      await close(() => trx.rollback());
      return res.status(400).json({
        error: cardAmount <= 0 ? "Your wallet covers the full amount. Pay from wallet instead." : `The card part must be at least AED ${MIN_CARD_PAYMENT_AED}.`,
      });
    }

    const [gift] = await trx("gifts").insert(giftRow("pending")).returning("*");
    await insertItems(trx, gift.id, pricing.items);
    await spendWalletBalance(userId, walletAmount, `Partial gift payment to ${recipientPhone}`, gift.id, "gift_sent", trx);
    await trx("payment_transactions").insert({
      user_id: userId,
      provider: "wallet",
      type: "gift_purchase",
      status: "succeeded",
      amount_aed: walletAmount,
      fee_aed: 0,
      net_amount_aed: walletAmount,
      gift_id: gift.id,
      payment_method_type: "wallet",
      metadata: { split_payment: true, wallet_portion: true, wallet_used: walletAmount, card_amount: cardAmount, gift_type },
      succeeded_at: trx.fn.now(),
      created_at: trx.fn.now(),
    });
    await close(() => trx.commit());

    const r = await ziinaService.createGiftPaymentIntent(
      userId,
      cardAmount,
      recipientPhone,
      user.phone,
      user.name,
      user.email,
      ziinaMeta(gift.id, { split_payment: true, wallet_used: walletAmount, card_amount: cardAmount })
    );

    if (!r.ok) {
      await returnGiftWalletPart(gift.id, "Refund - gift payment could not start");
      return res.status(400).json({ error: r.error, wallet_refunded: true });
    }

    return res.json({
      ok: true,
      gift_id: gift.id,
      payment_method: "split",
      provider: "ziina",
      wallet_amount: walletAmount,
      card_amount: cardAmount,
      payment_url: r.payment_url,
      payment_intent_id: r.payment_intent_id,
      transaction_id: r.transaction_id,
    });
  } catch (error) {
    if (open) {
      try {
        await trx.rollback();
      } catch {}
    }
    if (error.status === 400) return res.status(400).json({ error: error.message });
    next(error);
  }
};

/**
 * Cancels an unpaid gift and returns the wallet part of a wallet+card payment.
 * Used when the card payment can't start, and from the Ziina cancel page.
 * Safe to call more than once.
 */
async function returnGiftWalletPart(giftId, note = "Refund - gift payment cancelled") {
  return db.transaction(async (trx) => {
    const gift = await trx("gifts").where({ id: giftId }).forUpdate().first();
    if (!gift || gift.status !== "pending") return { ok: false, reason: "not_pending" };

    const parts = await trx("payment_transactions")
      .where({ gift_id: giftId, provider: "wallet", type: "gift_purchase", status: "succeeded" })
      .whereRaw("COALESCE((metadata->>'split_payment')::boolean, false) = true")
      .select(["id", "user_id", "amount_aed"]);

    for (const p of parts) {
      await addWalletBalance(p.user_id, Number(p.amount_aed), note, giftId, "refund", trx);
    }
    if (parts.length) {
      await trx("payment_transactions")
        .whereIn("id", parts.map((p) => p.id))
        .update({ status: "refunded", refunded_at: trx.fn.now(), updated_at: trx.fn.now() });
    }
    await trx("payment_transactions")
      .where({ gift_id: giftId, provider: "ziina", type: "gift_purchase", status: "pending" })
      .update({ status: "cancelled", updated_at: trx.fn.now() });
    await trx("gifts").where({ id: giftId }).update({ status: "cancelled" });
    return { ok: true, refunded: parts.reduce((s, p) => s + Number(p.amount_aed), 0) };
  });
}

/** GET /gifts/payment-options?gift_type=money|service&amount_aed=&salon_id=&service_items=[...] */
const getGiftPaymentOptions = async (req, res, next) => {
  try {
    const { gift_type, amount_aed, salon_id, service_items } = req.query;
    if (!gift_type) return res.status(400).json({ error: "gift_type required" });

    let items = [];
    if (typeof service_items === "string" && service_items.trim()) {
      try {
        items = JSON.parse(service_items);
      } catch {
        return res.status(400).json({ error: "Invalid service_items" });
      }
    }

    let pricing;
    try {
      pricing = await priceGift({ gift_type, amount_aed, salon_id, service_items: items });
    } catch (e) {
      if (e.status === 400) return res.status(400).json({ error: e.message });
      throw e;
    }

    const w = await db("wallets").where({ user_id: req.user.sub }).first("balance_aed");
    const walletBalance = round2(Number(w?.balance_aed || 0));
    const total = pricing.total_aed;

    const options = {
      gift_type,
      subtotal_aed: pricing.subtotal_aed,
      gift_fee_aed: pricing.gift_fee_aed,
      total_amount: total,
      wallet_balance: walletBalance,
      payment_methods: [],
    };

    const card = {
      method: "card",
      label: "Pay with Card/Apple Pay",
      amount: total,
      available: true,
      providers: ["visa", "mastercard", "apple_pay", "google_pay"],
    };

    if (gift_type === "money") {
      options.payment_methods.push({ ...card, required: true, note: "Money gifts must be paid with card" });
    } else {
      if (walletBalance >= total) options.payment_methods.push({ method: "wallet", label: "Pay from Wallet", amount: total, available: true });
      options.payment_methods.push(card);
      const cardPart = round2(total - walletBalance);
      if (walletBalance > 0 && cardPart >= MIN_CARD_PAYMENT_AED) {
        options.payment_methods.push({
          method: "split",
          label: "Wallet + Card",
          wallet_amount: walletBalance,
          card_amount: cardPart,
          available: true,
          description: `Pay AED ${walletBalance.toFixed(2)} from wallet + AED ${cardPart.toFixed(2)} with card`,
        });
      }
    }

    return res.json({ ok: true, ...options });
  } catch (error) {
    next(error);
  }
};

module.exports = { sendGiftWithPayment, getGiftPaymentOptions, returnGiftWalletPart };