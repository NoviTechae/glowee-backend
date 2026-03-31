// src/db/migrations/001_users.js
exports.up = knex => knex.schema.createTable('users', t => {
  t.bigIncrements('id').primary();
  t.string('phone', 20).notNullable().unique();
  t.string('name', 120);
  t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
  t.timestamp('last_login');
});

exports.down = knex => knex.schema.dropTableIfExists('users');
