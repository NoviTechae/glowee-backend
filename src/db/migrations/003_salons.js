// src/db/migrations/003_salons.js
exports.up = (knex) =>
  knex.schema.createTable("salons", (t) => {
    t.uuid("id").primary().defaultTo(knex.raw("uuid_generate_v4()"));
    t.string("name", 120).notNullable();
    t.text("about");
    t.string("logo_url");
    t.string("cover_url");
    t.string("phone", 30);
    t.string("email", 120);
    t.string("instagram", 120);
    t.string("website", 200);

    // تشغيل/إيقاف
    t.boolean("is_active").notNullable().defaultTo(true);

    t.timestamp("created_at").notNullable().defaultTo(knex.fn.now());
    t.timestamp("updated_at").notNullable().defaultTo(knex.fn.now());

    t.index(["is_active"]);
  });

exports.down = (knex) => knex.schema.dropTableIfExists("salons");