// src/db/migrations/012_wallets.js
exports.up = (knex) =>
  knex.schema.createTable("wallets", (t) => {
    t.bigInteger("user_id").primary().references("id").inTable("users").onDelete("CASCADE");
    t.decimal("balance_aed", 12, 2).notNullable().defaultTo(0);
    t.timestamp("updated_at").notNullable().defaultTo(knex.fn.now());
  });

exports.down = (knex) => knex.schema.dropTableIfExists("wallets");