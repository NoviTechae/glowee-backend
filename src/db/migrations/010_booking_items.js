// src/db/migrations/010_booking_items.js
exports.up = (knex) =>
  knex.schema.createTable("booking_items", (t) => {
    t.uuid("id").primary().defaultTo(knex.raw("uuid_generate_v4()"));

    t.uuid("booking_id")
      .notNullable()
      .references("id")
      .inTable("bookings")
      .onDelete("CASCADE");

    t.uuid("service_id")
      .notNullable()
      .references("id")
      .inTable("services")
      .onDelete("RESTRICT");

    t.uuid("service_availability_id")
      .references("id")
      .inTable("service_availability")
      .onDelete("SET NULL");

    t.string("service_name_snapshot").notNullable();
    t.decimal("price_aed_snapshot", 10, 2).notNullable();
    t.integer("duration_min_snapshot").notNullable();

    t.timestamp("created_at").notNullable().defaultTo(knex.fn.now());

    t.index(["booking_id"]);
    t.index(["service_id"]);
  });

exports.down = (knex) =>
  knex.schema.dropTableIfExists("booking_items");
