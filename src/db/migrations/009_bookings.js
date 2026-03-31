// src/db/migrations/009_bookings.js
exports.up = (knex) =>
  knex.schema.createTable("bookings", (t) => {
    t.uuid("id").primary().defaultTo(knex.raw("uuid_generate_v4()"));
    t.bigInteger("user_id").notNullable().references("id").inTable("users").onDelete("RESTRICT");

    t.uuid("salon_id").notNullable().references("id").inTable("salons").onDelete("RESTRICT");
    t.uuid("branch_id").notNullable().references("id").inTable("branches").onDelete("RESTRICT");

    t.enu("mode", ["in_salon", "home"], { useNative: true, enumName: "booking_mode" }).notNullable();

    // home location (اختياري لو in_salon)
    t.uuid("address_id").references("id").inTable("user_addresses").onDelete("SET NULL");

    t.timestamp("scheduled_at").notNullable();
    t.enu("status", ["pending", "confirmed", "completed", "cancelled"], {
      useNative: true,
      enumName: "booking_status",
    }).notNullable().defaultTo("pending");

    t.decimal("subtotal_aed", 10, 2).notNullable().defaultTo(0);
    t.decimal("fees_aed", 10, 2).notNullable().defaultTo(0);
    t.decimal("total_aed", 10, 2).notNullable().defaultTo(0);

    t.text("customer_note");
    t.timestamp("created_at").notNullable().defaultTo(knex.fn.now());
    t.timestamp("updated_at").notNullable().defaultTo(knex.fn.now());

    t.index(["user_id", "created_at"]);
    t.index(["branch_id", "scheduled_at"]);
    t.index(["status"]);
  });

exports.down = async (knex) => {
  await knex.schema.dropTableIfExists("bookings");
  await knex.raw(`DROP TYPE IF EXISTS booking_mode`);
  await knex.raw(`DROP TYPE IF EXISTS booking_status`);
};