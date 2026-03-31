// src/db/migrations/006_services.js
exports.up = (knex) =>
  knex.schema.createTable("services", (t) => {
    t.uuid("id").primary().defaultTo(knex.raw("uuid_generate_v4()"));
    t.uuid("salon_id").notNullable().references("id").inTable("salons").onDelete("CASCADE");
    t.uuid("category_id").references("id").inTable("service_categories").onDelete("SET NULL");

    t.string("name", 120).notNullable();
    t.unique(["salon_id", "name"]);
    t.text("description");
    t.string("image_url");

    // flags
    t.boolean("is_active").notNullable().defaultTo(true);

    t.timestamp("created_at").notNullable().defaultTo(knex.fn.now());
    t.timestamp("updated_at").notNullable().defaultTo(knex.fn.now());

    t.index(["salon_id"]);
    t.index(["category_id"]);
  });

exports.down = (knex) => knex.schema.dropTableIfExists("services");