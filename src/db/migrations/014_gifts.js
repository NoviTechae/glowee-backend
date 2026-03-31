// src/db/migrations/014_gifts.js
exports.up = (knex) =>
  knex.schema.createTable("gifts", (t) => {
    t.uuid("id").primary().defaultTo(knex.raw("uuid_generate_v4()"));

    // sender must be logged in
    t.bigInteger("sender_user_id").notNullable().references("id").inTable("users").onDelete("RESTRICT");

    // recipient (مبدئيًا بالرقم، لاحقًا إذا عنده حساب نربطه)
    t.string("recipient_phone", 20).notNullable();

    // اختيار صالون (اختياري) — لو null = Glowee credit عام
    t.uuid("salon_id").references("id").inTable("salons").onDelete("SET NULL");

    t.decimal("amount_aed", 12, 2).notNullable();
    t.string("currency", 10).notNullable().defaultTo("AED");

    // Gift code
    t.string("code", 32).notNullable();
    t.timestamp("expires_at").notNullable();

    t.enu("status", ["active", "redeemed", "expired", "cancelled"], {
      useNative: true,
      enumName: "gift_status",
    }).notNullable().defaultTo("active");

    t.string("sender_name", 80);
    t.text("message");
    t.string("theme_id", 60);

    t.timestamp("created_at").notNullable().defaultTo(knex.fn.now());
    t.timestamp("redeemed_at");

    t.unique(["code"]);
    t.index(["recipient_phone"]);
    t.index(["salon_id"]);
    t.index(["status"]);
  });

exports.down = async (knex) => {
  await knex.schema.dropTableIfExists("gifts");
  await knex.raw(`DROP TYPE IF EXISTS gift_status`);
};