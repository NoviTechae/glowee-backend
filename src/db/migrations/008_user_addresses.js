// src/db/migrations/008_user_addresses.js
exports.up = (knex) =>
  knex.schema.createTable("user_addresses", (t) => {
    t.uuid("id").primary().defaultTo(knex.raw("uuid_generate_v4()"));
    t.bigInteger("user_id").notNullable().references("id").inTable("users").onDelete("CASCADE");

    t.string("label", 60); // Home / Work
    t.string("city", 60).notNullable();
    t.string("area", 80).notNullable();
    t.string("address_line", 200).notNullable();

    t.decimal("lat", 9, 6).notNullable();
    t.decimal("lng", 9, 6).notNullable();
    t.specificType("geo", "geography(Point, 4326)").notNullable();

    t.boolean("is_default").notNullable().defaultTo(false);
    t.timestamp("created_at").notNullable().defaultTo(knex.fn.now());

    t.index(["user_id"]);
    t.index(["geo"], "user_addresses_geo_gix", "gist");
  });

exports.down = (knex) => knex.schema.dropTableIfExists("user_addresses");