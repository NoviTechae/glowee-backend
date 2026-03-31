// migrations/016_user_receivers.js
exports.up = (knex) =>
  knex.schema.createTable("user_receivers", (t) => {
    t.uuid("id").primary().defaultTo(knex.raw("uuid_generate_v4()"));
    t.bigInteger("user_id").notNullable().references("id").inTable("users").onDelete("CASCADE");

    t.string("name", 120).notNullable();
    t.string("phone", 30).notNullable();

    t.timestamp("created_at").defaultTo(knex.fn.now());

    t.unique(["user_id", "phone"]);
    t.index(["user_id"]);
  });

exports.down = (knex) => knex.schema.dropTableIfExists("user_receivers");