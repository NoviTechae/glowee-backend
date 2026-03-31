// src/db/migrations/007_service_availability.js
exports.up = (knex) =>
  knex.schema.createTable("service_availability", (t) => {
    t.uuid("id").primary().defaultTo(knex.raw("uuid_generate_v4()"));

    t.uuid("service_id").notNullable().references("id").inTable("services").onDelete("CASCADE");
    t.uuid("branch_id").notNullable().references("id").inTable("branches").onDelete("CASCADE");

    // in_salon | home
    t.enu("mode", ["in_salon", "home"], { useNative: true, enumName: "service_mode" }).notNullable();

    t.integer("duration_mins").notNullable();
    t.decimal("price_aed", 10, 2).notNullable();

    // home service extra options
    t.decimal("travel_fee_aed", 10, 2).notNullable().defaultTo(0);

    t.boolean("is_active").notNullable().defaultTo(true);
    t.timestamp("created_at").notNullable().defaultTo(knex.fn.now());

    t.unique(["service_id", "branch_id", "mode"]);
    t.index(["branch_id", "mode", "is_active"]);
  });

exports.down = async (knex) => {
  await knex.schema.dropTableIfExists("service_availability");
  await knex.raw(`DROP TYPE IF EXISTS service_mode`);
};