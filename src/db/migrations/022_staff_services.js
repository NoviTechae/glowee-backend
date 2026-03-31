// src/db/migrations/022_staff_services.js
exports.up = (knex) =>
  knex.schema.createTable("staff_services", (t) => {
    t.uuid("staff_id").notNullable()
      .references("id").inTable("staff").onDelete("CASCADE");

    t.uuid("service_id").notNullable()
      .references("id").inTable("services").onDelete("CASCADE");

    t.primary(["staff_id", "service_id"]);
    t.index(["service_id"]);
  });

exports.down = (knex) =>
  knex.schema.dropTableIfExists("staff_services");