// src/db/migrations/037_fix_missing_updated_at_columns.js
exports.up = async function (knex) {
  const hasCategoryUpdatedAt = await knex.schema.hasColumn("service_categories", "updated_at");
  if (!hasCategoryUpdatedAt) {
    await knex.schema.alterTable("service_categories", (t) => {
      t.timestamp("updated_at").notNullable().defaultTo(knex.fn.now());
    });
  }

  const hasAvailabilityUpdatedAt = await knex.schema.hasColumn("service_availability", "updated_at");
  if (!hasAvailabilityUpdatedAt) {
    await knex.schema.alterTable("service_availability", (t) => {
      t.timestamp("updated_at").notNullable().defaultTo(knex.fn.now());
    });
  }
};

exports.down = async function (knex) {
  const hasCategoryUpdatedAt = await knex.schema.hasColumn("service_categories", "updated_at");
  if (hasCategoryUpdatedAt) {
    await knex.schema.alterTable("service_categories", (t) => {
      t.dropColumn("updated_at");
    });
  }

  const hasAvailabilityUpdatedAt = await knex.schema.hasColumn("service_availability", "updated_at");
  if (hasAvailabilityUpdatedAt) {
    await knex.schema.alterTable("service_availability", (t) => {
      t.dropColumn("updated_at");
    });
  }
};