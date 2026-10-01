const db = require("../src/db/knex");
const bcrypt = require("bcrypt");

const DEMO_SALON_NAME = "Glowee Demo Beauty";
const DEMO_EMAIL = "demo@glowee.ae";
const DEMO_PASSWORD = "GloweeDemo2026!";

function atLocalDate(daysOffset, hour, minute = 0) {
  const d = new Date();
  d.setDate(d.getDate() + daysOffset);
  d.setHours(hour, minute, 0, 0);
  return d;
}

function previousMonthDate(daysAgo = 5, hour = 14) {
  const d = new Date();
  d.setMonth(d.getMonth() - 1);
  d.setDate(Math.max(1, d.getDate() - daysAgo));
  d.setHours(hour, 0, 0, 0);
  return d;
}

async function main() {
  console.log("🌸 Creating Glowee demo data...");

  await db.transaction(async (trx) => {
    // -------------------------------------------------
    // Safety: prevent duplicate demo data
    // -------------------------------------------------
    const existingSalon = await trx("salons")
      .where({ name: DEMO_SALON_NAME })
      .first();

    const existingAccount = await trx("dashboard_accounts")
      .where({ email: DEMO_EMAIL })
      .first();

    if (existingSalon || existingAccount) {
      throw new Error(
        "Demo data already exists. Run the cleanup script before seeding again."
      );
    }

    // -------------------------------------------------
    // Salon
    // -------------------------------------------------
    const [salon] = await trx("salons")
      .insert({
        name: DEMO_SALON_NAME,
        about:
          "A premium Glowee demo beauty business created for dashboard presentation purposes.",
        phone: "+971500000000",
        email: DEMO_EMAIL,
        instagram: "@glowee.demo",
        website: "https://glowee.novitech.ae",
        salon_type: "in_salon",
        is_active: true,
        is_featured: false,
        double_stamps: false,
      })
      .returning("*");

    console.log("✓ Demo salon:", salon.id);

    // -------------------------------------------------
    // Dashboard account
    // -------------------------------------------------
    const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);

    await trx("dashboard_accounts").insert({
      role: "salon",
      email: DEMO_EMAIL,
      password_hash: passwordHash,
      salon_id: salon.id,
      is_active: true,
    });

    // -------------------------------------------------
    // Branch / Location
    // -------------------------------------------------
    const lat = 24.2075;
    const lng = 55.7447;

    const [branch] = await trx("branches")
      .insert({
        salon_id: salon.id,
        name: "Al Ain",
        country: "United Arab Emirates",
        city: "Al Ain",
        area: "Al Jimi",
        address_line: "Al Jimi, Al Ain",
        lat,
        lng,
        geo: trx.raw(
          "ST_SetSRID(ST_MakePoint(?, ?), 4326)::geography",
          [lng, lat]
        ),
        ready_mins: 15,
        supports_home_services: false,
        phone: "+971500000000",
        whatsapp: "+971500000000",
        email: DEMO_EMAIL,
        instagram: "@glowee.demo",
        rating: 4.8,
        reviews_count: 38,
        is_active: true,
      })
      .returning("*");

    console.log("✓ Demo location");

    // -------------------------------------------------
    // Categories
    // -------------------------------------------------
    const categoryNames = [
      "Hair",
      "Nails",
      "Makeup",
      "Beauty",
    ];

    const categories = {};

    for (let i = 0; i < categoryNames.length; i++) {
      const [category] = await trx("service_categories")
        .insert({
          salon_id: salon.id,
          name: categoryNames[i],
          sort_order: i,
          is_active: true,
        })
        .returning("*");

      categories[categoryNames[i]] = category;
    }

    console.log("✓ Categories");

    // -------------------------------------------------
    // Services
    // -------------------------------------------------
    const serviceDefs = [
      {
        name: "Blow Dry",
        category: "Hair",
        description: "Professional wash and blow dry.",
        price: 180,
        duration: 45,
      },
      {
        name: "Gel Manicure",
        category: "Nails",
        description: "Gel manicure with nail preparation and polish.",
        price: 220,
        duration: 60,
      },
      {
        name: "Hair Styling",
        category: "Hair",
        description: "Professional styling for any occasion.",
        price: 300,
        duration: 60,
      },
      {
        name: "Soft Glam Makeup",
        category: "Makeup",
        description: "Soft glam makeup application.",
        price: 450,
        duration: 75,
      },
      {
        name: "Classic Pedicure",
        category: "Nails",
        description: "Classic pedicure and polish.",
        price: 250,
        duration: 60,
      },
    ];

    const services = [];

    for (const item of serviceDefs) {
      const [service] = await trx("services")
        .insert({
          salon_id: salon.id,
          category_id: categories[item.category].id,
          name: item.name,
          description: item.description,
          is_active: true,
        })
        .returning("*");

      const [availability] = await trx("service_availability")
        .insert({
          service_id: service.id,
          branch_id: branch.id,
          mode: "in_salon",
          duration_mins: item.duration,
          price_aed: item.price,
          travel_fee_aed: 0,
          is_active: true,
        })
        .returning("*");

      services.push({
        ...item,
        id: service.id,
        availability_id: availability.id,
      });
    }

    console.log("✓ Services");

    // -------------------------------------------------
    // Team
    // -------------------------------------------------
    const staffNames = [
      "Mariam",
      "Layla",
      "Noura",
    ];

    const staff = [];

    for (let i = 0; i < staffNames.length; i++) {
      const [member] = await trx("staff")
        .insert({
          salon_id: salon.id,
          name: staffNames[i],
          phone: `+97150999010${i + 1}`,
          is_active: true,
        })
        .returning("*");

      staff.push(member);

      await trx("branch_staff").insert({
        branch_id: branch.id,
        staff_id: member.id,
      });

      for (const service of services) {
        await trx("staff_services").insert({
          staff_id: member.id,
          service_id: service.id,
        });
      }
    }

    console.log("✓ Team");

    // -------------------------------------------------
    // Fake customers
    // -------------------------------------------------
    const customerDefs = [
      ["Sara M.", "+971509991001", "sara.demo@glowee.ae"],
      ["Noura K.", "+971509991002", "noura.demo@glowee.ae"],
      ["Maya A.", "+971509991003", "maya.demo@glowee.ae"],
      ["Hessa R.", "+971509991004", "hessa.demo@glowee.ae"],
      ["Reem S.", "+971509991005", "reem.demo@glowee.ae"],
      ["Alya H.", "+971509991006", "alya.demo@glowee.ae"],
      ["Fatma A.", "+971509991007", "fatma.demo@glowee.ae"],
      ["Maha K.", "+971509991008", "maha.demo@glowee.ae"],
    ];

    const customers = [];

    for (const [name, phone, email] of customerDefs) {
      const [user] = await trx("users")
        .insert({
          name,
          phone,
          email,
          is_active: true,
          is_blocked: false,
          wallet_balance_aed: 0,
          total_credits_aed: 0,
        })
        .returning("*");

      customers.push(user);
    }

    console.log("✓ Demo customers");

    // -------------------------------------------------
    // Booking helper
    // -------------------------------------------------
    let bookingCounter = 0;

    async function createBooking({
      status,
      scheduledAt,
      serviceIndex,
    }) {
      const service = services[serviceIndex % services.length];
      const customer =
        customers[bookingCounter % customers.length];

      const fee = 5;
      const subtotal = service.price;
      const total = subtotal + fee;

      const [booking] = await trx("bookings")
        .insert({
          user_id: customer.id,
          salon_id: salon.id,
          branch_id: branch.id,
          mode: "in_salon",
          scheduled_at: scheduledAt,
          status,
          subtotal_aed: subtotal,
          fees_aed: fee,
          total_aed: total,
          customer_note:
            bookingCounter % 4 === 0
              ? "Demo booking"
              : null,
          points_earned: 0,
          streak_bonus_applied: false,
        })
        .returning("*");

      const [bookingItem] = await trx("booking_items")
        .insert({
          booking_id: booking.id,
          service_id: service.id,
          service_availability_id: service.availability_id,

          service_name_snapshot: service.name,
          price_aed_snapshot: service.price,
          duration_min_snapshot: service.duration,

          duration_mins: service.duration,
          line_total_aed: service.price,
          service_name: service.name,
          unit_price_aed: service.price,
          qty: 1,
        })
        .returning("*");

      // Assignment makes booking details look complete
      const member =
        staff[bookingCounter % staff.length];

const startsAt = new Date(scheduledAt);
const endsAt = new Date(
  startsAt.getTime() + service.duration * 60 * 1000
);

await trx("booking_item_assignments").insert({
  booking_id: booking.id,
  booking_item_id: bookingItem.id,
  branch_id: branch.id,
  staff_id: member.id,
  starts_at: startsAt,
  ends_at: endsAt,
});

      bookingCounter++;
    }

    // -------------------------------------------------
    // BOOKINGS
    //
    // 30 total
    // 22 completed
    // 4 pending
    // 2 confirmed
    // 2 cancelled
    // -------------------------------------------------

    // 18 completed bookings this month / recent days
    for (let i = 0; i < 18; i++) {
      await createBooking({
        status: "completed",
        scheduledAt: atLocalDate(
          i < 6 ? 0 : -1,
          9 + (i % 9),
          (i % 2) * 30
        ),
        serviceIndex: i,
      });
    }

    // 4 completed from previous month
    for (let i = 0; i < 4; i++) {
      await createBooking({
        status: "completed",
        scheduledAt: previousMonthDate(
          2 + i,
          11 + i
        ),
        serviceIndex: i + 2,
      });
    }

    // 4 pending — 2 today, 2 tomorrow
    for (let i = 0; i < 4; i++) {
      await createBooking({
        status: "pending",
        scheduledAt: atLocalDate(
          i < 2 ? 0 : 1,
          15 + i,
          0
        ),
        serviceIndex: i + 1,
      });
    }

    // 2 confirmed — today
    for (let i = 0; i < 2; i++) {
      await createBooking({
        status: "confirmed",
        scheduledAt: atLocalDate(
          0,
          17 + i,
          30
        ),
        serviceIndex: i + 3,
      });
    }

    // 2 cancelled
    for (let i = 0; i < 2; i++) {
      await createBooking({
        status: "cancelled",
        scheduledAt: atLocalDate(
          -1,
          13 + i,
          0
        ),
        serviceIndex: i,
      });
    }

    console.log("✓ 30 demo bookings");
  });

  console.log("");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("✨ GLOWEE DEMO READY");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`Email:    ${DEMO_EMAIL}`);
  console.log(`Password: ${DEMO_PASSWORD}`);
  console.log("");
  console.log("Salon: Glowee Demo Beauty");
  console.log("Bookings: 30");
  console.log("Completed: 22");
  console.log("Pending: 4");
  console.log("Confirmed: 2");
  console.log("Cancelled: 2");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
}

main()
  .catch((err) => {
    console.error("");
    console.error("❌ Demo seed failed:");
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.destroy();
  });
