// 050_branch_home_min_order.js
// Optional minimum order for home service, per branch (services total, before any visit fee).

exports.up = async function up(knex) {
  await knex.schema.alterTable("branches", (t) => {
    t.decimal("home_min_order_aed", 10, 2).nullable();
  });

  await knex.raw(`
    ALTER TABLE branches
      ADD CONSTRAINT branches_home_min_order_positive
        CHECK (home_min_order_aed IS NULL OR home_min_order_aed >= 0)
  `);
};

exports.down = async function down(knex) {
  await knex.raw(`ALTER TABLE branches DROP CONSTRAINT IF EXISTS branches_home_min_order_positive`);
  await knex.schema.alterTable("branches", (t) => {
    t.dropColumn("home_min_order_aed");
  });
};