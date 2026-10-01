// 055_booking_items_price_backfill.js
// Older bookings saved the price and service name only in the *_snapshot
// columns. Copy them across so the salon sees them and free-service loyalty
// rewards are priced correctly. Safe to run more than once.

exports.up = async function (knex) {
  await knex.raw(`
    UPDATE booking_items
       SET unit_price_aed = price_aed_snapshot
     WHERE unit_price_aed = 0 AND price_aed_snapshot > 0
  `);
  await knex.raw(`
    UPDATE booking_items
       SET service_name = service_name_snapshot
     WHERE service_name IS NULL
  `);
};

exports.down = async function () {
  // Nothing to undo: the copied values match the snapshot columns.
};