//src/db/migrations/021_staff_branches.js
exports.up = (knex) =>
  knex.schema.createTable("branch_staff", (t) => {
    t.uuid("branch_id").notNullable()
      .references("id").inTable("branches").onDelete("CASCADE");

    t.uuid("staff_id").notNullable()
      .references("id").inTable("staff").onDelete("CASCADE");

    t.boolean("is_active").notNullable().defaultTo(true);
    t.timestamp("created_at").notNullable().defaultTo(knex.fn.now());

    t.primary(["branch_id", "staff_id"]);
    t.index(["staff_id"]);
    t.index(["branch_id"]);
  });
exports.down = (knex) => knex.schema.dropTableIfExists("branch_staff");