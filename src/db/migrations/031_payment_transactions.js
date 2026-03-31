// src/db/migrations/031_payment_transactions.js

exports.up = async (knex) => {
  await knex.schema.createTable("payment_transactions", (t) => {
    t.uuid("id").primary().defaultTo(knex.raw("uuid_generate_v4()"));
    
    // User
    t.bigInteger("user_id").notNullable().references("id").inTable("users").onDelete("CASCADE");
    
    // Payment details
    t.enum("provider", ["tap", "apple_pay", "google_pay", "mada"], {
      useNative: true,
      enumName: "payment_provider",
    }).notNullable();
    
    t.enum("type", ["wallet_topup", "booking_payment", "gift_purchase"], {
      useNative: true,
      enumName: "payment_type",
    }).notNullable();
    
    t.enum("status", ["pending", "authorized", "captured", "succeeded", "failed", "refunded", "cancelled"], {
      useNative: true,
      enumName: "payment_status",
    }).notNullable().defaultTo("pending");
    
    // Amount
    t.decimal("amount_aed", 12, 2).notNullable();
    t.decimal("fee_aed", 12, 2).defaultTo(0); // Platform fee
    t.decimal("net_amount_aed", 12, 2).notNullable(); // Amount after fee
    
    // Provider-specific IDs
    t.string("provider_payment_id", 255); // Tap charge_id
    t.string("provider_customer_id", 255); // Tap customer_id
    t.string("provider_session_id", 255); // For checkout sessions
    
    // Reference
    t.uuid("booking_id").references("id").inTable("bookings").onDelete("SET NULL");
    t.uuid("gift_id").references("id").inTable("gifts").onDelete("SET NULL");
    t.uuid("wallet_transaction_id").references("id").inTable("wallet_transactions").onDelete("SET NULL");
    
    // Payment method details (for display)
    t.string("payment_method_type", 50); // card, mada, apple_pay, google_pay
    t.string("card_last4", 4);
    t.string("card_brand", 20); // VISA, MASTERCARD, MADA, AMEX
    
    // Error tracking
    t.text("error_message");
    t.string("error_code", 50);
    
    // Metadata
    t.jsonb("metadata"); // Store additional provider-specific data
    
    // Timestamps
    t.timestamp("created_at").notNullable().defaultTo(knex.fn.now());
    t.timestamp("updated_at").defaultTo(knex.fn.now());
    t.timestamp("authorized_at");
    t.timestamp("succeeded_at");
    t.timestamp("failed_at");
    t.timestamp("refunded_at");
    
    // Indexes
    t.index("user_id");
    t.index("provider");
    t.index("status");
    t.index("provider_payment_id");
    t.index(["user_id", "created_at"]);
  });
};

exports.down = async (knex) => {
  await knex.schema.dropTableIfExists("payment_transactions");
  await knex.raw(`DROP TYPE IF EXISTS payment_provider`);
  await knex.raw(`DROP TYPE IF EXISTS payment_type`);
  await knex.raw(`DROP TYPE IF EXISTS payment_status`);
};