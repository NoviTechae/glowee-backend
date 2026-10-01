// src/controllers/bookingPaymentController.js
const db = require("../db/knex");
const ziinaService = require("../services/ziina");
const { spendWalletBalance } = require("./walletController");
const { hasSlotConflict } = require("../utils/bookingHold");
const { setBookingReward, rewardOptionsForBooking, listUsableRewards } = require("../services/stampService");

// Smallest card charge we send to Ziina. Below this, ask for wallet or full card.
const MIN_CARD_AED = 2;
const round2 = (n) => Math.round(Number(n) * 100) / 100;

async function calculatePaymentSplit(userId, totalAmount, trx = db) {
  const wallet = await trx("wallets").where({ user_id: userId }).first("balance_aed");
  const balance = round2(wallet ? Number(wallet.balance_aed) : 0);
  const total = round2(totalAmount);

  if (balance >= total) return { wallet_amount: total, card_amount: 0, requires_card: false };
  if (balance > 0) return { wallet_amount: balance, card_amount: round2(total - balance), requires_card: true };
  return { wallet_amount: 0, card_amount: total, requires_card: true };
}

/**
 * POST /bookings/:id/pay
 * Body: {
 *   payment_method: "wallet" | "card" | "split",
 *   use_wallet?: boolean,
 *   stamp_reward_id?: uuid | null,   // apply this loyalty reward (null removes it)
 *   use_stamp_reward?: boolean        // older apps: true = use the first reward that fits
 * }
 */
const payForBooking = async (req, res, next) => {
  const trx = await db.transaction();
  let finished = false;
  const done = async (fn) => {
    finished = true;
    await fn();
  };

  try {
    const { id: bookingId } = req.params;
    const { payment_method, use_wallet, use_stamp_reward } = req.body || {};
    const rewardChoiceSent = Object.prototype.hasOwnProperty.call(req.body || {}, "stamp_reward_id");
    const userId = req.user.sub;

    await trx.raw("SELECT pg_advisory_xact_lock(hashtext(?))", [`booking-payment:${bookingId}`]);

    let booking = await trx("bookings").where({ id: bookingId, user_id: userId }).first();
    if (!booking) {
      await done(() => trx.rollback());
      return res.status(404).json({ error: "Booking not found" });
    }
    if (booking.status !== "pending") {
      await done(() => trx.rollback());
      return res.status(400).json({ error: "Booking already processed" });
    }
    if (await hasSlotConflict(bookingId, trx)) {
      await done(() => trx.rollback());
      return res.status(409).json({ error: "This time is no longer available. Please choose another time." });
    }

    const user = await trx("users").where({ id: userId }).first();
    if (!user) {
      await done(() => trx.rollback());
      return res.status(404).json({ error: "User not found" });
    }

    // ---- Loyalty reward: apply, swap or remove before anything is charged.
    let rewardId = booking.stamp_reward_id || null;
    if (rewardChoiceSent) rewardId = req.body.stamp_reward_id || null;
    else if (use_stamp_reward === true && !booking.stamp_reward_id) {
      const usable = await listUsableRewards(userId, booking.salon_id, { bookingId, trx });
      const options = await rewardOptionsForBooking(booking, trx);
      const fit = options.find((o) => o.eligible && usable.some((u) => u.id === o.id));
      if (!fit) {
        await done(() => trx.rollback());
        return res.status(400).json({ error: "No loyalty reward can be used on this booking" });
      }
      rewardId = fit.id;
    } else if (use_stamp_reward === false) rewardId = null;

    if (rewardId !== (booking.stamp_reward_id || null)) {
      // The amount on an open card payment page would no longer match.
      const openCard = await trx("payment_transactions")
        .where({ booking_id: bookingId, provider: "ziina", type: "booking_payment", status: "pending" })
        .first("id");
      if (openCard) {
        await done(() => trx.rollback());
        return res.status(409).json({
          error: "Finish or cancel the card payment you started before changing your reward.",
          code: "PAYMENT_IN_PROGRESS",
        });
      }
      booking = await setBookingReward(trx, booking, rewardId);
    }

    const totalAmount = round2(booking.total_aed);

    // ---- Nothing left to pay (the reward covers it all)
    if (totalAmount <= 0) {
      if (!booking.stamp_reward_id) {
        await done(() => trx.rollback());
        return res.status(400).json({ error: "This booking has no amount to pay" });
      }
      await trx("bookings").where({ id: bookingId }).update({ status: "confirmed", updated_at: trx.fn.now() });
      await trx("payment_transactions").insert({
        user_id: userId,
        provider: "wallet", // enum has no stamp_reward provider
        type: "booking_payment",
        status: "succeeded",
        amount_aed: 0,
        fee_aed: 0,
        net_amount_aed: 0,
        booking_id: bookingId,
        payment_method_type: "stamp_reward",
        succeeded_at: trx.fn.now(),
        metadata: { stamp_reward: true, stamp_reward_id: booking.stamp_reward_id, discount_aed: Number(booking.stamp_discount_aed) },
        created_at: trx.fn.now(),
        updated_at: trx.fn.now(),
      });
      await done(() => trx.commit());
      return res.json({ ok: true, used_stamp_reward: true, booking_id: bookingId, amount_paid: 0, status: "confirmed" });
    }

    if (!payment_method && use_wallet !== true) {
      // Reward applied (or removed); the app now asks how to pay the rest.
      await done(() => trx.commit());
      return res.json({
        ok: true,
        booking_id: bookingId,
        status: "pending",
        amount_due: totalAmount,
        stamp_reward_id: booking.stamp_reward_id || null,
        stamp_discount_aed: Number(booking.stamp_discount_aed || 0),
        requires_payment: true,
      });
    }

    // ---- Wallet only
    if (payment_method === "wallet") {
      try {
        await spendWalletBalance(userId, totalAmount, `Booking payment #${bookingId}`, bookingId, "spent", trx);
      } catch (e) {
        if (e.code !== "INSUFFICIENT_BALANCE") throw e;
        const w = await trx("wallets").where({ user_id: userId }).first("balance_aed");
        const balance = Number(w?.balance_aed || 0);
        await done(() => trx.rollback());
        return res.status(400).json({
          error: "Insufficient wallet balance",
          wallet_balance: balance,
          required: totalAmount,
          shortfall: round2(totalAmount - balance),
        });
      }

      // An earlier wallet+card attempt may have taken a wallet part: give it back.
      const leftovers = await trx("payment_transactions")
        .where({ booking_id: bookingId, type: "booking_payment", provider: "wallet", status: "succeeded" })
        .whereRaw("COALESCE((metadata->>'wallet_portion')::boolean, false) = true")
        .where("amount_aed", ">", 0)
        .select(["id", "amount_aed"]);
      if (leftovers.length) {
        const { addWalletBalance } = require("./walletController");
        for (const p of leftovers) {
          await addWalletBalance(userId, Number(p.amount_aed), `Refund - booking paid from wallet #${bookingId}`, bookingId, "refund", trx);
        }
        await trx("payment_transactions")
          .whereIn("id", leftovers.map((p) => p.id))
          .update({ status: "refunded", refunded_at: trx.fn.now(), updated_at: trx.fn.now() });
        await trx("payment_transactions")
          .where({ booking_id: bookingId, provider: "ziina", type: "booking_payment", status: "pending" })
          .update({ status: "cancelled", updated_at: trx.fn.now() });
      }

      await trx("bookings").where({ id: bookingId }).update({ status: "confirmed", updated_at: trx.fn.now() });
      await trx("payment_transactions").insert({
        user_id: userId,
        provider: "wallet",
        type: "booking_payment",
        status: "succeeded",
        amount_aed: totalAmount,
        fee_aed: 0,
        net_amount_aed: totalAmount,
        booking_id: bookingId,
        payment_method_type: "wallet",
        succeeded_at: trx.fn.now(),
        created_at: trx.fn.now(),
        updated_at: trx.fn.now(),
      });

      await done(() => trx.commit());
      return res.json({ ok: true, booking_id: bookingId, payment_method: "wallet", amount_paid: totalAmount, status: "confirmed" });
    }

    // ---- Card only
    if (payment_method === "card") {
      await done(() => trx.commit()); // release the lock before calling Ziina

      const r = await ziinaService.createBookingPaymentIntent(userId, bookingId, totalAmount, user.phone, user.name, user.email);
      if (!r.ok) return res.status(400).json({ error: r.error, code: r.code });

      return res.json({
        ok: true,
        booking_id: bookingId,
        payment_method: "card",
        provider: "ziina",
        payment_url: r.payment_url,
        payment_intent_id: r.payment_intent_id,
        transaction_id: r.transaction_id,
        amount: totalAmount,
      });
    }

    // ---- Wallet + card
    if (payment_method === "split" || use_wallet === true) {
      // Reuse a pending split so the wallet part is never taken twice.
      const existing = await trx("payment_transactions")
        .where({ user_id: userId, booking_id: bookingId, provider: "ziina", type: "booking_payment", status: "pending" })
        .whereRaw("COALESCE((metadata->>'split_payment')::boolean, false) = true")
        .orderBy("created_at", "desc")
        .first();

      const sameTotal =
        round2(Number(existing?.metadata?.wallet_amount || 0) + Number(existing?.metadata?.card_amount || existing?.amount_aed || 0)) === totalAmount;
      if (existing?.provider_payment_id && existing?.metadata?.payment_url && sameTotal) {
        await done(() => trx.commit());
        return res.json({
          ok: true,
          booking_id: bookingId,
          payment_method: "split",
          provider: "ziina",
          wallet_amount: Number(existing.metadata.wallet_amount || 0),
          card_amount: Number(existing.metadata.card_amount || existing.amount_aed || 0),
          payment_url: existing.metadata.payment_url,
          payment_intent_id: existing.provider_payment_id,
          transaction_id: existing.id,
          reused: true,
        });
      }

      const split = await calculatePaymentSplit(userId, totalAmount, trx);
      if (split.wallet_amount === 0) {
        await done(() => trx.rollback());
        return res.status(400).json({ error: "No wallet balance to use for split payment", suggestion: "Use card payment instead" });
      }
      if (!split.requires_card) {
        await done(() => trx.rollback());
        return res.status(400).json({ error: "Your wallet covers the full amount. Pay from wallet instead.", suggestion: "wallet" });
      }
      if (split.card_amount < MIN_CARD_AED) {
        await done(() => trx.rollback());
        return res.status(400).json({
          error: `The card part must be at least AED ${MIN_CARD_AED}. Pay the full amount by card instead.`,
          suggestion: "card",
        });
      }

      await spendWalletBalance(userId, split.wallet_amount, `Partial booking payment #${bookingId}`, bookingId, "spent", trx);
      await trx("payment_transactions").insert({
        user_id: userId,
        provider: "wallet",
        type: "booking_payment",
        status: "succeeded",
        amount_aed: split.wallet_amount,
        fee_aed: 0,
        net_amount_aed: split.wallet_amount,
        booking_id: bookingId,
        payment_method_type: "wallet",
        succeeded_at: trx.fn.now(),
        metadata: { split_payment: true, wallet_portion: true },
        created_at: trx.fn.now(),
        updated_at: trx.fn.now(),
      });

      const r = await ziinaService.createBookingPaymentIntent(userId, bookingId, split.card_amount, user.phone, user.name, user.email, {
        split_payment: true,
        wallet_amount: split.wallet_amount,
        card_amount: split.card_amount,
      });

      if (!r.ok) {
        // The wallet part is still inside this transaction; rolling back returns it.
        await done(() => trx.rollback());
        return res.status(400).json({ error: r.error, wallet_refunded: true });
      }

      await done(() => trx.commit());
      return res.json({
        ok: true,
        booking_id: bookingId,
        payment_method: "split",
        provider: "ziina",
        wallet_amount: split.wallet_amount,
        card_amount: split.card_amount,
        payment_url: r.payment_url,
        payment_intent_id: r.payment_intent_id,
        transaction_id: r.transaction_id,
      });
    }

    await done(() => trx.rollback());
    return res.status(400).json({ error: "Invalid payment method", valid_methods: ["wallet", "card", "split"] });
  } catch (error) {
    if (!finished) {
      try {
        await trx.rollback();
      } catch {}
    }
    if (error.status === 400 || error.status === 409) return res.status(error.status).json({ error: error.message });
    next(error);
  }
};

/** GET /bookings/:id/payment-options */
const getPaymentOptions = async (req, res, next) => {
  try {
    const booking = await db("bookings").where({ id: req.params.id, user_id: req.user.sub }).first();
    if (!booking) return res.status(404).json({ error: "Booking not found" });

    const totalAmount = round2(booking.total_aed);
    const split = await calculatePaymentSplit(req.user.sub, totalAmount);
    const rewards = booking.status === "pending" ? await rewardOptionsForBooking(booking) : [];

    const options = {
      total_amount: totalAmount,
      subtotal_aed: Number(booking.subtotal_aed),
      fees_aed: Number(booking.fees_aed),
      stamp_discount_aed: Number(booking.stamp_discount_aed || 0),
      wallet_balance: split.wallet_amount,
      payment_methods: [],
    };

    if (totalAmount > 0) {
      if (!split.requires_card) {
        options.payment_methods.push({ method: "wallet", label: "Pay from Wallet", amount: totalAmount, available: true });
      }
      options.payment_methods.push({
        method: "card",
        label: "Pay with Card/Apple Pay",
        amount: totalAmount,
        available: true,
        provider: "ziina",
        providers: ["visa", "mastercard", "apple_pay", "google_pay"],
      });
      if (split.wallet_amount > 0 && split.requires_card && split.card_amount >= MIN_CARD_AED) {
        options.payment_methods.push({
          method: "split",
          label: "Wallet + Card",
          wallet_amount: split.wallet_amount,
          card_amount: split.card_amount,
          available: true,
          provider: "ziina",
          description: `Pay AED ${split.wallet_amount.toFixed(2)} from wallet + AED ${split.card_amount.toFixed(2)} with card`,
        });
      }
      if (split.requires_card) {
        const need = round2(totalAmount - split.wallet_amount);
        options.suggestions = { topup_needed: need, message: `Top up AED ${need.toFixed(2)} to pay fully from wallet` };
      }
    }

    const usable = rewards.filter((r) => r.eligible);
    return res.json({
      ok: true,
      ...options,
      // Loyalty rewards for this salon: each with what it takes off, or why it can't be used yet.
      stamp_rewards: rewards,
      applied_stamp_reward_id: booking.stamp_reward_id || null,
      // Older app versions read this.
      stamp_reward: {
        available: usable.length > 0,
        available_rewards: usable.length,
        reward_text: usable[0]?.label || rewards[0]?.label || null,
      },
    });
  } catch (error) {
    next(error);
  }
};

module.exports = { payForBooking, getPaymentOptions, calculatePaymentSplit };