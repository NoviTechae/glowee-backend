// src/db/migrations/013_wallet_transactions.js
exports.up = (knex) =>
  knex.schema.createTable("wallet_transactions", (t) => {
    t.uuid("id").primary().defaultTo(knex.raw("uuid_generate_v4()"));
    t.bigInteger("user_id").notNullable().references("id").inTable("users").onDelete("CASCADE");

    t.enu("type", ["topup", "spent", "gift_received", "gift_sent", "refund"], {
      useNative: true,
      enumName: "wallet_tx_type",
    }).notNullable();

    t.decimal("amount_aed", 12, 2).notNullable(); // + or -
    t.text("note");
    t.uuid("ref_id"); // booking_id or gift_id (optional)
    t.timestamp("created_at").notNullable().defaultTo(knex.fn.now());

    t.index(["user_id", "created_at"]);
  });

exports.down = async (knex) => {
  await knex.schema.dropTableIfExists("wallet_transactions");
  await knex.raw(`DROP TYPE IF EXISTS wallet_tx_type`);
};