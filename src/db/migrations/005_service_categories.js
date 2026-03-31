// src/db/migrations/005_service_categories.js
exports.up = (knex) =>
  knex.schema.createTable("service_categories", (t) => {
    t.uuid("id").primary().defaultTo(knex.raw("uuid_generate_v4()"));
    t.uuid("salon_id").notNullable().references("id").inTable("salons").onDelete("CASCADE");
    t.string("name", 80).notNullable(); // Hair, Nails...
    t.integer("sort_order").notNullable().defaultTo(0);
    t.boolean("is_active").notNullable().defaultTo(true);
    t.timestamp("created_at").notNullable().defaultTo(knex.fn.now());

    t.unique(["salon_id", "name"]);
    t.index(["salon_id"]);
  });

exports.down = (knex) => knex.schema.dropTableIfExists("service_categories");