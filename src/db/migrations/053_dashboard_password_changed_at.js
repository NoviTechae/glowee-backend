// 053_dashboard_password_changed_at.js
// Lets a password change sign out every other session of that dashboard account.

exports.up = async function (knex) {
  const has = await knex.schema.hasColumn("dashboard_accounts", "password_changed_at");
  if (!has) {
    await knex.schema.alterTable("dashboard_accounts", (t) => {
      t.timestamp("password_changed_at", { useTz: true }).nullable();
    });
  }
};

exports.down = async function (knex) {
  const has = await knex.schema.hasColumn("dashboard_accounts", "password_changed_at");
  if (has) {
    await knex.schema.alterTable("dashboard_accounts", (t) => {
      t.dropColumn("password_changed_at");
    });
  }
};