// src/db/migrations/002_otp_codes.js
exports.up = async (knex) => {
  await knex.schema.createTable('otp_codes', (t) => {
    t.bigIncrements('id').primary();
    t.string('phone', 20).notNullable(); // +9715XXXXXXXX
    t.text('code_hash').notNullable();
    t.timestamp('expires_at', { useTz: false }).notNullable();
    t.integer('attempts').notNullable().defaultTo(0);
    t.timestamp('consumed_at', { useTz: false });
    t.timestamp('created_at', { useTz: false }).notNullable().defaultTo(knex.fn.now());

    t.index(['phone', 'created_at'], 'otp_codes_phone_created_at_idx');
    t.index(['phone', 'expires_at'], 'otp_codes_phone_expires_at_idx');
  });
};

exports.down = (knex) => knex.schema.dropTableIfExists('otp_codes');