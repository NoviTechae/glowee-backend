// 054_stamp_rewards.js
// Loyalty rewards that keep the shape they had when earned.
//
// - salon_stamp_settings: what the reward covers (a free service or a % off)
//   and how long a reward lasts.
// - user_stamp_rewards: one row per earned reward. Whether it's available,
//   held, or used is worked out from the booking it's attached to.
// - bookings: which reward a booking uses and how much it took off.

exports.up = async function (knex) {
  await knex.schema.alterTable("salon_stamp_settings", (t) => {
    t.text("reward_kind").nullable(); // 'free_service' | 'percent_off'
    t.uuid("reward_service_id").nullable().references("id").inTable("services").onDelete("SET NULL");
    t.integer("reward_percent").nullable();
    t.integer("reward_valid_months").notNullable().defaultTo(6);
  });

  await knex.raw(`
    ALTER TABLE salon_stamp_settings
      ADD CONSTRAINT salon_stamp_settings_reward_kind_check
        CHECK (reward_kind IS NULL OR reward_kind IN ('free_service', 'percent_off')),
      ADD CONSTRAINT salon_stamp_settings_reward_percent_check
        CHECK (reward_percent IS NULL OR (reward_percent BETWEEN 5 AND 100)),
      ADD CONSTRAINT salon_stamp_settings_valid_months_check
        CHECK (reward_valid_months IN (3, 6, 12)),
      ADD CONSTRAINT salon_stamp_settings_stamps_required_check
        CHECK (stamps_required BETWEEN 2 AND 20) NOT VALID
  `);

  await knex.schema.createTable("user_stamp_rewards", (t) => {
    t.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    t.bigInteger("user_id").notNullable().references("id").inTable("users").onDelete("CASCADE");
    t.uuid("salon_id").notNullable().references("id").inTable("salons").onDelete("CASCADE");

    // What the customer was promised, frozen when they earned it.
    t.string("label", 255).notNullable();
    t.text("kind").nullable(); // NULL = earned before this change; uses the salon's current setup
    t.uuid("service_id").nullable().references("id").inTable("services").onDelete("SET NULL");
    t.integer("percent").nullable();

    t.uuid("earned_booking_id").nullable().references("id").inTable("bookings").onDelete("SET NULL");
    t.timestamp("earned_at", { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp("expires_at", { useTz: true }).notNullable();

    // The booking it's applied to. Held while that booking waits for payment,
    // used once it's confirmed, free again if it's cancelled.
    t.uuid("booking_id").nullable().references("id").inTable("bookings").onDelete("SET NULL");
    t.decimal("discount_aed", 10, 2).nullable();
    t.timestamp("applied_at", { useTz: true }).nullable();

    t.index(["user_id", "salon_id"]);
    t.index(["booking_id"]);
  });

  await knex.schema.alterTable("bookings", (t) => {
    t.uuid("stamp_reward_id").nullable().references("id").inTable("user_stamp_rewards").onDelete("SET NULL");
    t.decimal("stamp_discount_aed", 10, 2).notNullable().defaultTo(0);
  });

  // Rewards customers already have become rows, valid for 6 months from today.
  await knex.raw(`
    INSERT INTO user_stamp_rewards (user_id, salon_id, label, kind, earned_at, expires_at)
    SELECT c.user_id, c.salon_id,
           COALESCE(NULLIF(s.reward_text, ''), 'Loyalty reward'),
           NULL, NOW(), NOW() + INTERVAL '6 months'
    FROM user_salon_stamp_cards c
    LEFT JOIN salon_stamp_settings s ON s.salon_id = c.salon_id
    CROSS JOIN LATERAL generate_series(1, GREATEST(c.available_rewards, 0))
    WHERE c.available_rewards > 0
  `);
};

exports.down = async function (knex) {
  await knex.schema.alterTable("bookings", (t) => {
    t.dropColumn("stamp_reward_id");
    t.dropColumn("stamp_discount_aed");
  });
  await knex.schema.dropTableIfExists("user_stamp_rewards");
  await knex.raw(`
    ALTER TABLE salon_stamp_settings
      DROP CONSTRAINT IF EXISTS salon_stamp_settings_reward_kind_check,
      DROP CONSTRAINT IF EXISTS salon_stamp_settings_reward_percent_check,
      DROP CONSTRAINT IF EXISTS salon_stamp_settings_valid_months_check,
      DROP CONSTRAINT IF EXISTS salon_stamp_settings_stamps_required_check
  `);
  await knex.schema.alterTable("salon_stamp_settings", (t) => {
    t.dropColumn("reward_kind");
    t.dropColumn("reward_service_id");
    t.dropColumn("reward_percent");
    t.dropColumn("reward_valid_months");
  });
};