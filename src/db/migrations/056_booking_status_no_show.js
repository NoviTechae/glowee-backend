// 056_booking_status_no_show.js
// The salon can mark a customer who didn't come as "no_show", but the
// booking_status type never had that value. Adding it is safe for existing rows.

exports.up = async function (knex) {
  await knex.raw(`ALTER TYPE booking_status ADD VALUE IF NOT EXISTS 'no_show'`);
};

exports.down = async function () {
  // PostgreSQL can't remove a value from an enum type; leaving it is harmless.
};