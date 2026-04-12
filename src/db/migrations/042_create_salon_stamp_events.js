// migrations/042_create_salon_stamp_events.js

exports.up = async function (knex) {
  await knex.schema.createTable("salon_stamp_events", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));

    table.uuid("user_id").notNullable();
    table.uuid("salon_id").notNullable();

    table.uuid("booking_id").nullable();

    table.enu("type", [
      "stamp_earned",
      "reward_unlocked",
      "reward_used",
    ]);

    table.integer("value").defaultTo(1);

    table.timestamp("created_at").defaultTo(knex.fn.now());
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists("salon_stamp_events");
};