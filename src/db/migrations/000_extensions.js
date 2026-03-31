// src/db/migrations/000_extensions.js
exports.up = async (knex) => {
  await knex.raw(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);
  await knex.raw(`CREATE EXTENSION IF NOT EXISTS "postgis"`);
};

exports.down = async (knex) => {
  // عادة ما ننزل الإكستنشنز في بيئة production
};