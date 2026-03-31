//src/db/migrations/017_dashboard_accounts.js
exports.up = (knex) =>
  knex.schema.createTable("dashboard_accounts", (t) => {
    t.uuid("id").primary().defaultTo(knex.raw("uuid_generate_v4()"));

    t.enu("role", ["admin", "salon"], { useNative: true, enumName: "dashboard_role" }).notNullable();

    t.string("email", 160).notNullable().unique();
    t.text("password_hash").notNullable();

    // إذا role=salon نربطه بالصالون
    t.uuid("salon_id").references("id").inTable("salons").onDelete("SET NULL");

    t.boolean("is_active").notNullable().defaultTo(true);

    t.timestamp("created_at").notNullable().defaultTo(knex.fn.now());
    t.timestamp("updated_at").notNullable().defaultTo(knex.fn.now());

    t.index(["role"]);
    t.index(["salon_id"]);
  });

exports.down = async (knex) => {
  await knex.schema.dropTableIfExists("dashboard_accounts");
  await knex.raw(`DROP TYPE IF EXISTS dashboard_role`);
};