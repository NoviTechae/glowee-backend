// src/db/migrations/033_add_push_token_to_users.js
exports.up = function (knex) {
  return knex.schema.table("users", (table) => {
    table.text("push_token").nullable();
    table.timestamp("push_token_updated_at").nullable();
  });
};

exports.down = function (knex) {
  return knex.schema.table("users", (table) => {
    table.dropColumn("push_token");
    table.dropColumn("push_token_updated_at");
  });
};