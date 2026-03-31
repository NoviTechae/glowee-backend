// src/db/migrations/035_create_blocked_time_slots.js

/**
 * Migration: Create blocked_time_slots table
 * 
 * Purpose: Allow salons to block time slots for walk-in customers or external bookings
 * to prevent double-booking in the mobile app.
 */

exports.up = async (knex) => {
  await knex.schema.createTable("blocked_time_slots", (table) => {
    // Primary Key
    table.uuid("id").primary().defaultTo(knex.raw("uuid_generate_v4()"));

    // Foreign Keys - ALL UUIDs!
    table.uuid("salon_id").notNullable();
    table.uuid("branch_id").notNullable();
    table.uuid("staff_id").nullable(); // NULL = block for all staff

    // Time Slot Details
    table.date("blocked_date").notNullable();
    table.time("start_time").notNullable();
    table.time("end_time").notNullable();

    // Additional Info
    table.text("reason").nullable();
    table.string("customer_name", 255).nullable();
    table.string("customer_phone", 50).nullable();

    // Audit - ALSO UUID!
    table.uuid("created_by_account_id").nullable();
    table.timestamp("created_at").notNullable().defaultTo(knex.fn.now());
    table.timestamp("updated_at").notNullable().defaultTo(knex.fn.now());

    // Foreign Key Constraints
    table.foreign("salon_id").references("salons.id").onDelete("CASCADE");
    table.foreign("branch_id").references("branches.id").onDelete("CASCADE");
    table.foreign("staff_id").references("staff.id").onDelete("CASCADE");
    table.foreign("created_by_account_id").references("dashboard_accounts.id").onDelete("SET NULL");

    // Indexes for Performance
    table.index(["salon_id", "branch_id", "blocked_date"]); // Main query pattern
    table.index(["branch_id", "staff_id", "blocked_date"]); // Staff-specific queries
  });
};

exports.down = async (knex) => {
  await knex.schema.dropTableIfExists("blocked_time_slots");
};