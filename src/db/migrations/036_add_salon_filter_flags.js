// src/db/migrations/036_add_salon_filter_flags.js

exports.up = (knex) =>
  knex.schema.alterTable("salons", (t) => {
    // فلتر Trending
    t.boolean("is_featured").notNullable().defaultTo(false);

    // فلتر Super discounts
    t.integer("discount_percent").nullable().defaultTo(null);

    // فلتر 2x stamps
    t.boolean("double_stamps").notNullable().defaultTo(false);

    t.index(["is_featured"]);
    t.index(["double_stamps"]);
  });

exports.down = (knex) =>
  knex.schema.alterTable("salons", (t) => {
    t.dropColumn("is_featured");
    t.dropColumn("discount_percent");
    t.dropColumn("double_stamps");
  });