// src/db/migrations/027_gift_seen.js
exports.up = (knex) =>
  knex.schema.table("gifts", (t) => {
    t.timestamp("seen_at").nullable();
    t.boolean("sender_seen_rewarded").notNullable().defaultTo(false);
  });

exports.down = (knex) =>
  knex.schema.table("gifts", (t) => {
    t.dropColumn("seen_at");
    t.dropColumn("sender_seen_rewarded");
  });