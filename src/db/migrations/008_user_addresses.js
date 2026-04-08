// src/db/migrations/008_user_addresses.js

exports.up = async (knex) => {
  // تأكد من extensions
  await knex.raw(`CREATE EXTENSION IF NOT EXISTS "pgcrypto";`);
  await knex.raw(`CREATE EXTENSION IF NOT EXISTS "postgis";`);

  return knex.schema.createTable("user_addresses", (t) => {
    t.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));

    // 🔥 FIX: لازم UUID
    t.uuid("user_id")
      .notNullable()
      .references("id")
      .inTable("users")
      .onDelete("CASCADE");

    t.string("label", 60); // Home / Work
    t.string("city", 60).notNullable();
    t.string("area", 80).notNullable();
    t.string("address_line", 200).notNullable();

    t.decimal("lat", 9, 6).notNullable();
    t.decimal("lng", 9, 6).notNullable();

    // 🔥 PostGIS
    t.specificType("geo", "geography(Point, 4326)").notNullable();

    t.boolean("is_default").notNullable().defaultTo(false);
    t.timestamp("created_at").notNullable().defaultTo(knex.fn.now());

    t.index(["user_id"]);
    t.index(["geo"], "user_addresses_geo_gix", "gist");
  });
};

exports.down = (knex) =>
  knex.schema.dropTableIfExists("user_addresses");