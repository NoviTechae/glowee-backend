// src/db/migrations/029_enhance_users_table.js

exports.up = async (knex) => {
  await knex.schema.table("users", (t) => {
    // Contact & Identity
    t.string("email", 255);
    
    // Wallet (optional - you already have separate wallets table, but this is for quick access)
    t.decimal("wallet_balance_aed", 10, 2).defaultTo(0);
    t.decimal("total_credits_aed", 10, 2).defaultTo(0); // Lifetime credits earned
    
    // Account Status
    t.boolean("is_active").notNullable().defaultTo(true);
    t.boolean("is_blocked").notNullable().defaultTo(false);
    t.string("blocked_reason", 500);
    
    // Profile
    t.date("date_of_birth");
    t.enum("gender", ["male", "female", "other", "prefer_not_to_say"]);
    t.string("profile_image_url", 500);
    
    // Preferences
    t.boolean("email_notifications").defaultTo(true);
    t.boolean("sms_notifications").defaultTo(true);
    t.boolean("push_notifications").defaultTo(true);
    
    // Marketing & Referrals
    t.string("referral_code", 20).unique();
    t.bigInteger("referred_by_user_id").references("id").inTable("users").onDelete("SET NULL");
    
    // Tracking
    t.timestamp("updated_at").defaultTo(knex.fn.now());
    t.timestamp("blocked_at");
    t.timestamp("email_verified_at");
    t.timestamp("phone_verified_at");
    
    // Indexes
    t.index("email");
    t.index("is_blocked");
    t.index("is_active");
    t.index("referral_code");
  });

  // Update existing users to have verified phone (since they already registered)
  await knex("users").update({
    phone_verified_at: knex.fn.now(),
    is_active: true,
    is_blocked: false,
    wallet_balance_aed: 0,
    total_credits_aed: 0,
  });
};

exports.down = async (knex) => {
  await knex.schema.table("users", (t) => {
    t.dropColumn("email");
    t.dropColumn("wallet_balance_aed");
    t.dropColumn("total_credits_aed");
    t.dropColumn("is_active");
    t.dropColumn("is_blocked");
    t.dropColumn("blocked_reason");
    t.dropColumn("date_of_birth");
    t.dropColumn("gender");
    t.dropColumn("profile_image_url");
    t.dropColumn("email_notifications");
    t.dropColumn("sms_notifications");
    t.dropColumn("push_notifications");
    t.dropColumn("referral_code");
    t.dropColumn("referred_by_user_id");
    t.dropColumn("updated_at");
    t.dropColumn("blocked_at");
    t.dropColumn("email_verified_at");
    t.dropColumn("phone_verified_at");
  });
};