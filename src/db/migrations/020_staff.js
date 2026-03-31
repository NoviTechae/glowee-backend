//src/db/migrations/020_staff.js
exports.up = (knex) =>
  knex.schema.createTable("staff", (t) => {
    t.uuid("id").primary().defaultTo(knex.raw("uuid_generate_v4()"));

    // كل موظفة تتبع صالون (مو فرع) لأن ممكن تشتغل أكثر من فرع
    t.uuid("salon_id").notNullable()
      .references("id").inTable("salons").onDelete("CASCADE");

    t.string("name", 120).notNullable();
    t.string("phone", 30);
    t.string("image_url");
    t.boolean("is_active").notNullable().defaultTo(true);

    t.timestamp("created_at").notNullable().defaultTo(knex.fn.now());
    t.timestamp("updated_at").notNullable().defaultTo(knex.fn.now());

    t.index(["salon_id"]);
    t.index(["is_active"]);
  });

exports.down = (knex) => knex.schema.dropTableIfExists("staff");