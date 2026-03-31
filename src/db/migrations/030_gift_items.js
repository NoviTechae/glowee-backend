// src/db/migrations/030_gift_items.js

exports.up = async (knex) => {
  // Create gift_items table for proper storage of service items
  await knex.schema.createTable("gift_items", (t) => {
    t.uuid("id").primary().defaultTo(knex.raw("uuid_generate_v4()"));
    
    t.uuid("gift_id").notNullable().references("id").inTable("gifts").onDelete("CASCADE");
    t.uuid("service_availability_id").notNullable().references("id").inTable("service_availability").onDelete("RESTRICT");
    
    // Snapshot of service details at time of gift creation
    t.string("service_name", 200).notNullable();
    t.integer("qty").notNullable().defaultTo(1);
    t.decimal("unit_price_aed", 10, 2).notNullable();
    t.decimal("line_total_aed", 10, 2).notNullable();
    t.integer("duration_mins").notNullable().defaultTo(0);
    
    t.timestamp("created_at").notNullable().defaultTo(knex.fn.now());
    
    t.index("gift_id");
    t.index("service_availability_id");
  });
};

exports.down = async (knex) => {
  await knex.schema.dropTableIfExists("gift_items");
};