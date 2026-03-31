// src/db/migrations/023_booking_item_assignments.js
exports.up = async (knex) => {
  await knex.schema.createTable("booking_item_assignments", (t) => {
    t.uuid("id").primary().defaultTo(knex.raw("uuid_generate_v4()"));

    t.uuid("booking_id").notNullable()
      .references("id").inTable("bookings").onDelete("CASCADE");

    t.uuid("booking_item_id").notNullable()
      .references("id").inTable("booking_items").onDelete("CASCADE");

    t.uuid("branch_id").notNullable()
      .references("id").inTable("branches").onDelete("CASCADE");

    t.uuid("staff_id")
      .references("id").inTable("staff").onDelete("SET NULL");

    t.timestamp("starts_at", { useTz: true }).notNullable();
    t.timestamp("ends_at", { useTz: true }).notNullable();

    t.timestamp("created_at").notNullable().defaultTo(knex.fn.now());

    t.index(["branch_id", "starts_at"]);
    t.index(["staff_id", "starts_at"]);
    t.index(["booking_id"]);
    t.index(["booking_item_id"]);
  });
};

exports.down = (knex) =>
  knex.schema.dropTableIfExists("booking_item_assignments");