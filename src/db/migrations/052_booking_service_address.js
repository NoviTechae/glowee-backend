// 052_booking_service_address.js
// Home visits need the address on the booking itself, so the salon knows where
// to go even if the customer later edits or deletes the address in the app.

exports.up = async function up(knex) {
  await knex.schema.alterTable("bookings", (t) => {
    t.string("contact_name", 120).nullable();
    t.string("contact_phone", 30).nullable();
    t.string("service_area", 120).nullable();
    t.string("service_address", 300).nullable();
    t.decimal("service_lat", 9, 6).nullable();
    t.decimal("service_lng", 9, 6).nullable();
  });

  // Existing bookings are left empty on purpose: guessing from the customer's
  // saved addresses could send a salon to the wrong place.
};

exports.down = async function down(knex) {
  await knex.schema.alterTable("bookings", (t) => {
    t.dropColumn("contact_name");
    t.dropColumn("contact_phone");
    t.dropColumn("service_area");
    t.dropColumn("service_address");
    t.dropColumn("service_lat");
    t.dropColumn("service_lng");
  });
};