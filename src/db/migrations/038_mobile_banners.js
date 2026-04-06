exports.up = async function (knex) {
  await knex.schema.createTable("mobile_banners", (t) => {
    t.uuid("id").primary().defaultTo(knex.raw("uuid_generate_v4()"));

    t.string("title").nullable(); // عنوان اختياري
    t.text("image_url").notNullable(); // رابط الصورة

    t.string("placement").notNullable().defaultTo("home"); 
    // مثال: home / offers / rewards

    t.integer("sort_order").notNullable().defaultTo(0); // ترتيب العرض

    t.boolean("is_active").notNullable().defaultTo(true);

    // 👇 مهم جداً لو تبين تضغط البانر
    t.string("action_type").nullable(); 
    // "salon" | "offer" | "url" | "category"

    t.string("action_value").nullable(); 
    // مثلا salon_id أو رابط خارجي

    t.timestamp("starts_at").nullable(); // بداية العرض
    t.timestamp("ends_at").nullable();   // نهاية العرض

    t.timestamp("created_at").defaultTo(knex.fn.now());
    t.timestamp("updated_at").defaultTo(knex.fn.now());
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists("mobile_banners");
};