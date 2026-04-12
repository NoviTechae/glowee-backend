// migrations/041_create_user_salon_stamp_cards.js

exports.up = async function (knex) {
  await knex.schema.createTable("user_salon_stamp_cards", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));

table.integer("user_id").notNullable()
      .references("id").inTable("users")
      .onDelete("CASCADE");

    table.uuid("salon_id").notNullable()
      .references("id").inTable("salons")
      .onDelete("CASCADE");

    table.integer("current_stamps").defaultTo(0);
    table.integer("available_rewards").defaultTo(0);

    table.timestamp("updated_at").defaultTo(knex.fn.now());

    table.unique(["user_id", "salon_id"]);
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists("user_salon_stamp_cards");
};