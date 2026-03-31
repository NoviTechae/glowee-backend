// src/db/migrations/019_branch_hours.js
exports.up = (knex) =>
  knex.schema.createTable("branch_hours", (t) => {
    t.uuid("id").primary().defaultTo(knex.raw("uuid_generate_v4()"));
    t.uuid("branch_id").notNullable().references("id").inTable("branches").onDelete("CASCADE");

    // 0=Sunday ... 6=Saturday
    t.integer("day_of_week").notNullable(); // 0-6

    t.boolean("is_closed").notNullable().defaultTo(false);
    t.string("open_time", 5);  // "09:00"
    t.string("close_time", 5); // "22:00"

    t.timestamp("created_at").notNullable().defaultTo(knex.fn.now());
    t.timestamp("updated_at").notNullable().defaultTo(knex.fn.now());

    t.unique(["branch_id", "day_of_week"]);
    t.index(["branch_id"]);
  });

exports.down = (knex) => knex.schema.dropTableIfExists("branch_hours");