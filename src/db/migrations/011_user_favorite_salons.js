// src/db/migrations/011_user_favorite_salons.js
exports.up = (knex) =>
  knex.schema.createTable("user_favorite_salons", (t) => {
    t.bigInteger("user_id").notNullable().references("id").inTable("users").onDelete("CASCADE");
    t.uuid("salon_id").notNullable().references("id").inTable("salons").onDelete("CASCADE");
    t.timestamp("created_at").notNullable().defaultTo(knex.fn.now());

    t.primary(["user_id", "salon_id"]);
  });

exports.down = (knex) => knex.schema.dropTableIfExists("user_favorite_salons");