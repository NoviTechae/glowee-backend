// src/db/migrations/043_add_profile_fields_to_users.js
exports.up = async function (knex) {
  const hasEmail = await knex.schema.hasColumn("users", "email");
  const hasDob = await knex.schema.hasColumn("users", "date_of_birth");

  await knex.schema.alterTable("users", (table) => {
    if (!hasEmail) table.string("email", 255).nullable();
    if (!hasDob) table.date("date_of_birth").nullable();
  });
};

exports.down = async function (knex) {
  const hasEmail = await knex.schema.hasColumn("users", "email");
  const hasDob = await knex.schema.hasColumn("users", "date_of_birth");

  await knex.schema.alterTable("users", (table) => {
    if (hasEmail) table.dropColumn("email");
    if (hasDob) table.dropColumn("date_of_birth");
  });
};