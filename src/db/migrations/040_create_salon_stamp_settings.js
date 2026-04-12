// migrations/040_create_salon_stamp_settings.js

exports.up = async function (knex) {
  await knex.schema.createTable("salon_stamp_settings", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));

    table.uuid("salon_id").notNullable().unique()
      .references("id").inTable("salons")
      .onDelete("CASCADE");

    table.integer("stamps_required").notNullable().defaultTo(6);
    table.string("reward_text").defaultTo("Free reward");

    // صور الستامبس (array)
    table.jsonb("stamp_images").defaultTo("[]");

    table.boolean("is_active").defaultTo(true);

    table.timestamp("created_at").defaultTo(knex.fn.now());
    table.timestamp("updated_at").defaultTo(knex.fn.now());
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists("salon_stamp_settings");
};