// src/db/migrations/045_create_partner_feedback.js

exports.up = async function (knex) {
  await knex.schema.createTable("partner_feedback", (table) => {
    table
      .uuid("id")
      .primary()
      .defaultTo(knex.raw("gen_random_uuid()"));

    table
      .uuid("salon_id")
      .notNullable()
      .references("id")
      .inTable("salons")
      .onDelete("CASCADE");

    table.string("type", 30).notNullable();
    table.string("title", 150).notNullable();
    table.text("message").notNullable();

    table
      .string("status", 30)
      .notNullable()
      .defaultTo("new");

    table.timestamps(true, true);

    table.index(["salon_id"]);
    table.index(["status"]);
    table.index(["created_at"]);
  });

  await knex.raw(`
    ALTER TABLE partner_feedback
    ADD CONSTRAINT partner_feedback_type_check
    CHECK (
      type IN (
        'feature',
        'improvement',
        'problem',
        'other'
      )
    )
  `);

  await knex.raw(`
    ALTER TABLE partner_feedback
    ADD CONSTRAINT partner_feedback_status_check
    CHECK (
      status IN (
        'new',
        'reviewing',
        'planned',
        'completed',
        'declined'
      )
    )
  `);
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists(
    "partner_feedback"
  );
};