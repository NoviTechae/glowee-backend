// migrations/044_add_gift_id_to_bookings.js
exports.up = async function (knex) {
  await knex.schema.alterTable("bookings", (table) => {
    table
      .uuid("gift_id")
      .nullable()
      .references("id")
      .inTable("gifts")
      .onDelete("SET NULL");
  });
};

exports.down = async function (knex) {
  await knex.schema.alterTable("bookings", (table) => {
    table.dropColumn("gift_id");
  });
};