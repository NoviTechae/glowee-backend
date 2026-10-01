// src/services/stampService.js
// Loyalty card: stamps, earned rewards, and using a reward on a booking.
const db = require("../db/knex");

const round2 = (n) => Math.round(Number(n) * 100) / 100;

// Booking statuses that mean "this booking is using the reward".
// Pending holds it; confirmed / completed / no-show have used it.
const HOLDING_STATUSES = ["pending", "confirmed", "completed", "no_show"];

// ---------------------------------------------------------------------------
// Stamps
// ---------------------------------------------------------------------------

/**
 * Adds a stamp when a booking is marked done. When the card fills up, it goes
 * back to zero and a reward is created with the salon's reward as it is today.
 * Safe to call more than once for the same booking.
 */
async function awardStampForCompletedBooking(bookingId, trxOuter = null) {
  const run = async (trx) => {
    const booking = await trx("bookings").where({ id: bookingId }).first("id", "user_id", "salon_id");
    if (!booking) return { ok: false, error: "Booking not found" };
    if (!booking.user_id || !booking.salon_id) return { ok: false, error: "Booking missing user or salon" };

    const settings = await trx("salon_stamp_settings").where({ salon_id: booking.salon_id, is_active: true }).first();
    if (!settings) return { ok: true, skipped: true, reason: "Loyalty card is off" };

    // Lock this customer's card so two bookings finishing together can't lose a stamp.
    await trx("user_salon_stamp_cards")
      .insert({ user_id: booking.user_id, salon_id: booking.salon_id, current_stamps: 0, available_rewards: 0, updated_at: trx.fn.now() })
      .onConflict(["user_id", "salon_id"])
      .ignore();
    const card = await trx("user_salon_stamp_cards").where({ user_id: booking.user_id, salon_id: booking.salon_id }).forUpdate().first();

    const already = await trx("salon_stamp_events").where({ booking_id: bookingId, type: "stamp_earned" }).first("id");
    if (already) return { ok: true, already_awarded: true };

    let stamps = Number(card.current_stamps || 0) + 1;
    let rewards = Number(card.available_rewards || 0);
    const required = Math.min(20, Math.max(2, Number(settings.stamps_required || 6)));
    let reward = null;

    await trx("salon_stamp_events").insert({
      user_id: booking.user_id,
      salon_id: booking.salon_id,
      booking_id: booking.id,
      type: "stamp_earned",
      value: 1,
      created_at: trx.fn.now(),
    });

    if (stamps >= required) {
      stamps = 0;
      rewards += 1;
      const months = [3, 6, 12].includes(Number(settings.reward_valid_months)) ? Number(settings.reward_valid_months) : 6;

      [reward] = await trx("user_stamp_rewards")
        .insert({
          user_id: booking.user_id,
          salon_id: booking.salon_id,
          label: settings.reward_text || "Loyalty reward",
          kind: settings.reward_kind || null,
          service_id: settings.reward_kind === "free_service" ? settings.reward_service_id : null,
          percent: settings.reward_kind === "percent_off" ? settings.reward_percent : null,
          earned_booking_id: booking.id,
          earned_at: trx.fn.now(),
          expires_at: trx.raw(`NOW() + (? || ' months')::interval`, [months]),
        })
        .returning("*");

      await trx("salon_stamp_events").insert({
        user_id: booking.user_id,
        salon_id: booking.salon_id,
        booking_id: booking.id,
        type: "reward_unlocked",
        value: 1,
        created_at: trx.fn.now(),
      });
    }

    // available_rewards is kept for older app versions; the rewards table is the truth.
    await trx("user_salon_stamp_cards")
      .where({ id: card.id })
      .update({ current_stamps: stamps, available_rewards: rewards, updated_at: trx.fn.now() });

    return { ok: true, user_id: booking.user_id, salon_id: booking.salon_id, current_stamps: stamps, reward_unlocked: Boolean(reward) };
  };

  try {
    return trxOuter ? await run(trxOuter) : await db.transaction(run);
  } catch (error) {
    if (trxOuter) throw error;
    return { ok: false, error: error.message };
  }
}

// ---------------------------------------------------------------------------
// Rewards
// ---------------------------------------------------------------------------

/**
 * Rewards a customer can use at a salon right now. If bookingId is given, the
 * reward already applied to that booking counts as usable too.
 */
async function listUsableRewards(userId, salonId, { bookingId = null, trx = db } = {}) {
  return trx("user_stamp_rewards as r")
    .leftJoin("bookings as b", "b.id", "r.booking_id")
    .leftJoin("services as s", "s.id", "r.service_id")
    .where({ "r.user_id": userId, "r.salon_id": salonId })
    .where(function () {
      this.whereNull("r.booking_id")
        .orWhereRaw("b.status::text <> ALL(?)", [HOLDING_STATUSES])
        .modify((q) => {
          if (bookingId) q.orWhere("r.booking_id", bookingId);
        });
    })
    .where(function () {
      // An expired reward stays usable only on the booking that already holds it.
      this.where("r.expires_at", ">", trx.fn.now()).modify((q) => {
        if (bookingId) q.orWhere("r.booking_id", bookingId);
      });
    })
    .orderBy("r.expires_at", "asc")
    .select(["r.*", "s.name as service_name"]);
}

/** Every reward a customer holds, across salons (for the wallet screen). */
async function listUsableRewardsForUser(userId, trx = db) {
  return trx("user_stamp_rewards as r")
    .leftJoin("bookings as b", "b.id", "r.booking_id")
    .where("r.user_id", userId)
    .where("r.expires_at", ">", trx.fn.now())
    .where(function () {
      this.whereNull("r.booking_id").orWhereRaw("b.status::text <> ALL(?)", [HOLDING_STATUSES]);
    })
    .orderBy("r.expires_at", "asc")
    .select(["r.id", "r.salon_id", "r.label", "r.kind", "r.service_id", "r.percent", "r.expires_at"]);
}

/**
 * Rewards earned before rewards had a type use what the salon offers today.
 * Returns { kind, service_id, percent } or null if the salon hasn't set it up.
 */
async function resolveRewardTerms(reward, trx = db) {
  if (reward.kind) return { kind: reward.kind, service_id: reward.service_id, percent: reward.percent };
  const s = await trx("salon_stamp_settings").where({ salon_id: reward.salon_id }).first("reward_kind", "reward_service_id", "reward_percent");
  if (!s?.reward_kind) return null;
  return { kind: s.reward_kind, service_id: s.reward_service_id, percent: s.reward_percent };
}

/**
 * How much a reward takes off this booking. Discounts apply to services only,
 * never to the home visit fee, and never go below zero.
 * Returns { eligible, discount_aed, reason?, service_id? }.
 */
async function rewardDiscountForBooking(reward, booking, trx = db) {
  const terms = await resolveRewardTerms(reward, trx);
  if (!terms) return { eligible: false, discount_aed: 0, reason: "The salon is updating this reward. Try again later." };

  const subtotal = round2(booking.subtotal_aed);

  if (terms.kind === "free_service") {
    if (!terms.service_id) return { eligible: false, discount_aed: 0, reason: "This reward is no longer offered by the salon." };
    const item = await trx("booking_items")
      .where({ booking_id: booking.id, service_id: terms.service_id })
      .orderBy("price_aed_snapshot", "desc")
      .first(trx.raw("COALESCE(NULLIF(unit_price_aed, 0), price_aed_snapshot) AS unit_price_aed"), "line_total_aed");
    if (!item) return { eligible: false, discount_aed: 0, reason: "Add this service to your booking to use the reward.", service_id: terms.service_id };
    // One of that service is free.
    const value = round2(Math.min(Number(item.unit_price_aed), Number(item.line_total_aed)));
    return { eligible: true, discount_aed: Math.min(value, subtotal), service_id: terms.service_id };
  }

  if (terms.kind === "percent_off") {
    const pct = Math.min(100, Math.max(0, Number(terms.percent || 0)));
    return { eligible: pct > 0, discount_aed: round2(Math.min(subtotal, (subtotal * pct) / 100)) };
  }

  return { eligible: false, discount_aed: 0, reason: "This reward can't be used in the app." };
}

/**
 * Puts a reward on a pending booking, swaps it, or removes it (rewardId = null).
 * Must run inside the booking-payment lock. Returns the updated booking.
 */
async function setBookingReward(trx, booking, rewardId) {
  if (booking.status !== "pending") throw Object.assign(new Error("This booking can't be changed now"), { status: 400 });
  if ((booking.stamp_reward_id || null) === (rewardId || null)) return booking;

  const oldDiscount = round2(booking.stamp_discount_aed || 0);

  // Take the old reward off.
  if (booking.stamp_reward_id) {
    await trx("user_stamp_rewards")
      .where({ id: booking.stamp_reward_id, booking_id: booking.id })
      .update({ booking_id: null, discount_aed: null, applied_at: null });
  }

  let newDiscount = 0;
  if (rewardId) {
    const usable = await listUsableRewards(booking.user_id, booking.salon_id, { bookingId: booking.id, trx });
    const reward = usable.find((r) => r.id === rewardId);
    if (!reward) throw Object.assign(new Error("This reward isn't available any more"), { status: 400 });

    // Lock it so it can't land on two bookings at once.
    const locked = await trx("user_stamp_rewards").where({ id: reward.id }).forUpdate().first();
    if (locked.booking_id && locked.booking_id !== booking.id) {
      const holder = await trx("bookings").where({ id: locked.booking_id }).first("status");
      if (holder && HOLDING_STATUSES.includes(holder.status)) {
        throw Object.assign(new Error("This reward is being used on another booking"), { status: 409 });
      }
    }

    const calc = await rewardDiscountForBooking(locked, booking, trx);
    if (!calc.eligible) throw Object.assign(new Error(calc.reason || "This reward can't be used on this booking"), { status: 400 });
    newDiscount = calc.discount_aed;

    await trx("user_stamp_rewards")
      .where({ id: locked.id })
      .update({ booking_id: booking.id, discount_aed: newDiscount, applied_at: trx.fn.now() });
  }

  const total = round2(Math.max(0, Number(booking.total_aed) + oldDiscount - newDiscount));
  const [updated] = await trx("bookings")
    .where({ id: booking.id })
    .update({ stamp_reward_id: rewardId || null, stamp_discount_aed: newDiscount, total_aed: total, updated_at: trx.fn.now() })
    .returning("*");
  return updated;
}

/** Rewards usable on this booking, with what each would take off. For the payment screen. */
async function rewardOptionsForBooking(booking, trx = db) {
  const rewards = await listUsableRewards(booking.user_id, booking.salon_id, { bookingId: booking.id, trx });
  const out = [];
  for (const r of rewards) {
    const calc = await rewardDiscountForBooking(r, booking, trx);
    out.push({
      id: r.id,
      label: r.label,
      expires_at: r.expires_at,
      applied: r.booking_id === booking.id,
      eligible: calc.eligible,
      discount_aed: calc.discount_aed,
      reason: calc.eligible ? null : calc.reason || null,
      service_id: calc.service_id || r.service_id || null,
    });
  }
  return out;
}

module.exports = {
  HOLDING_STATUSES,
  awardStampForCompletedBooking,
  listUsableRewards,
  listUsableRewardsForUser,
  resolveRewardTerms,
  rewardDiscountForBooking,
  setBookingReward,
  rewardOptionsForBooking,
};