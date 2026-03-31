// src/db/migrations/004_branches.js
exports.up = (knex) =>
  knex.schema.createTable("branches", (t) => {
    t.uuid("id").primary().defaultTo(knex.raw("uuid_generate_v4()"));

    t.uuid("salon_id")
      .notNullable()
      .references("id")
      .inTable("salons")
      .onDelete("CASCADE");

    t.string("name", 120).notNullable();

    t.string("country", 60)
      .notNullable()
      .defaultTo("United Arab Emirates");

    t.string("city", 60).notNullable();
    t.string("area", 80).notNullable();
    t.string("address_line", 200);

    // إحداثيات
    t.decimal("lat", 9, 6).notNullable();
    t.decimal("lng", 9, 6).notNullable();

    // PostGIS
    t.specificType("geo", "geography(Point, 4326)").notNullable();

    // وقت تجهيز (لو تحتاجينه للحجز)
    t.integer("ready_mins").notNullable().defaultTo(15);

    // هل يقدم خدمة منازل؟
    t.boolean("supports_home_services")
      .notNullable()
      .defaultTo(false);

    // بيانات تواصل خاصة بالفرع
    t.string("phone", 30);
    t.string("whatsapp", 30);
    t.string("email", 120);
    t.string("instagram", 120);
    t.string("website", 200);

    // تقييمات snapshot
    t.decimal("rating", 3, 2)
      .notNullable()
      .defaultTo(0);

    t.integer("reviews_count")
      .notNullable()
      .defaultTo(0);

    t.boolean("is_active")
      .notNullable()
      .defaultTo(true);

    t.timestamp("created_at")
      .notNullable()
      .defaultTo(knex.fn.now());

    t.timestamp("updated_at")
      .notNullable()
      .defaultTo(knex.fn.now());

    // Indexes
    t.index(["salon_id"]);
    t.index(["city"]);
    t.index(["area"]);
    t.index(["is_active"]);

    // PostGIS index
    t.index(["geo"], "branches_geo_gix", "gist");
  });

exports.down = (knex) =>
  knex.schema.dropTableIfExists("branches");