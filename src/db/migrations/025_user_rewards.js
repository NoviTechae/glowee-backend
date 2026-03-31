// src/db/migrations/025_user_rewards.js
exports.up = async (knex) => {
  await knex.schema.createTable("user_rewards", (t) => {
    // ✅ users.id عندك bigint
    t.bigInteger("user_id").primary().references("id").inTable("users").onDelete("CASCADE");

    t.integer("points_balance").notNullable().defaultTo(0);
    t.integer("total_earned").notNullable().defaultTo(0);
    t.integer("total_spent").notNullable().defaultTo(0);

    // ✅ monthly streak (حسب منطقك)
    t.integer("monthly_streak_count").notNullable().defaultTo(0);     // كم شهر streak
    t.integer("current_month_bookings").notNullable().defaultTo(0);   // حجوزات الشهر الحالي
    t.string("last_booking_month", 7).nullable();                    // "YYYY-MM"

    // ✅ Level system (سنة)
    t.string("level_name", 20).notNullable().defaultTo("Bronze");
    t.timestamp("level_expires_at", { useTz: true }).nullable(); // متى ينتهي الليفل

    t.timestamp("created_at", { useTz: true }).defaultTo(knex.fn.now());
    t.timestamp("updated_at", { useTz: true }).defaultTo(knex.fn.now());
  });

  await knex.schema.createTable("reward_transactions", (t) => {
    t.increments("id").primary();
    t.bigInteger("user_id").notNullable().references("id").inTable("users").onDelete("CASCADE");
    t.string("type", 50).notNullable(); // booking_completed | gift_sent | wallet_topup | conversion | streak_bonus ...
    t.integer("points").notNullable();  // + أو -
    t.uuid("ref_id").nullable();
    t.timestamp("created_at", { useTz: true }).defaultTo(knex.fn.now());
  });
};

exports.down = async (knex) => {
  await knex.schema.dropTableIfExists("reward_transactions");
  await knex.schema.dropTableIfExists("user_rewards");
};