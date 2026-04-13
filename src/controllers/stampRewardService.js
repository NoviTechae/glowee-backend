// src/services/stampRewardService.js
const db = require("../db/knex");

async function getStampRewardForSalon(userId, salonId, trx = db) {
  const card = await trx("user_salon_stamp_cards as c")
    .leftJoin("salon_stamp_settings as s", function () {
      this.on("s.salon_id", "c.salon_id").andOn("s.is_active", "=", trx.raw("true"));
    })
    .where("c.user_id", userId)
    .andWhere("c.salon_id", salonId)
    .select([
      "c.user_id",
      "c.salon_id",
      "c.available_rewards",
      "s.reward_text",
      "s.is_active",
    ])
    .first();

  const availableRewards = Number(card?.available_rewards || 0);

  return {
    available: availableRewards > 0,
    available_rewards: availableRewards,
    reward_text: card?.reward_text || "Free Service",
  };
}

async function consumeStampRewardForBooking({
  userId,
  salonId,
  bookingId,
  trx,
}) {
  if (!trx) {
    throw new Error("Transaction is required");
  }

  const card = await trx("user_salon_stamp_cards")
    .where({
      user_id: userId,
      salon_id: salonId,
    })
    .forUpdate()
    .first();

  if (!card || Number(card.available_rewards || 0) <= 0) {
    throw new Error("No available stamp reward");
  }

  const nextRewards = Number(card.available_rewards || 0) - 1;

  await trx("user_salon_stamp_cards")
    .where({
      user_id: userId,
      salon_id: salonId,
    })
    .update({
      available_rewards: nextRewards,
      updated_at: trx.fn.now(),
    });

  await trx("salon_stamp_events").insert({
    user_id: userId,
    salon_id: salonId,
    booking_id: bookingId,
    type: "reward_used",
    value: 1,
    created_at: trx.fn.now(),
  });

  return {
    ok: true,
    available_rewards: nextRewards,
  };
}

module.exports = {
  getStampRewardForSalon,
  consumeStampRewardForBooking,
};