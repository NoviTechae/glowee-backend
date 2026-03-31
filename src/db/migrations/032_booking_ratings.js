// src/db/migrations/032_booking_ratings.js

exports.up = (knex) =>
  knex.schema.createTable("booking_ratings", (t) => {
    t.uuid("id").primary().defaultTo(knex.raw("uuid_generate_v4()"));

    t.uuid("booking_id")
      .notNullable()
      .unique()
      .references("id")
      .inTable("bookings")
      .onDelete("CASCADE");

    // users.id = bigint
    t.bigInteger("user_id")
      .notNullable()
      .references("id")
      .inTable("users")
      .onDelete("CASCADE");

    t.uuid("salon_id")
      .notNullable()
      .references("id")
      .inTable("salons")
      .onDelete("CASCADE");

    t.uuid("branch_id")
      .nullable()
      .references("id")
      .inTable("branches")
      .onDelete("SET NULL");

    t.integer("rating").notNullable();
    t.text("comment");

    t.timestamp("created_at").notNullable().defaultTo(knex.fn.now());

    t.index(["salon_id"]);
    t.index(["user_id"]);
    t.index(["rating"]);
  });

exports.down = (knex) =>
  knex.schema.dropTableIfExists("booking_ratings");