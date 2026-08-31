// src/db/migrations/046_extend_expired_gifts.js
exports.up = async function (knex) {
  const giftIds = [
    "3ac28e33-67e2-4b88-a26b-7f64102ae847",
    "70f166d5-dd0b-45ff-bc46-732e98d9249f",
  ];

  await knex("gifts")
    .whereIn("id", giftIds)
    .where("status", "expired")
    .update({
      status: "active",
      expires_at: knex.raw("NOW() + INTERVAL '1 year'"),
    });
};

exports.down = async function () {
  // Intentionally left empty.
};