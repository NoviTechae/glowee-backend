// backend/src/db/migrations/034_create_notifications.js

exports.up = async function (knex) {
  await knex.schema.createTable("notifications", (table) => {
    table.increments("id").primary(); // استخدام auto-increment بدل uuid
    table.bigInteger("user_id").unsigned().notNullable(); // bigint بدل uuid
    table.foreign("user_id").references("users.id").onDelete("CASCADE");
    
    table.string("title", 255).notNullable();
    table.text("body").notNullable();
    table.string("type", 50).nullable();
    
    table.jsonb("data").nullable();
    
    table.boolean("read").notNullable().defaultTo(false);
    
    table.timestamp("created_at").notNullable().defaultTo(knex.fn.now());
    table.timestamp("updated_at").notNullable().defaultTo(knex.fn.now());
    
    // Indexes
    table.index("user_id");
    table.index("read");
    table.index("created_at");
    table.index(["user_id", "read"]);
  });
};

exports.down = function (knex) {
  return knex.schema.dropTableIfExists("notifications");
};