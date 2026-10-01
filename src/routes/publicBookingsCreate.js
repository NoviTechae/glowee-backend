// src/routes/publicBookingsCreate.js
const router = require("express").Router();
const { z } = require("zod");
const db = require("../db/knex");
const authRequired = require("../middleware/authRequired");
const { coverageForPoint, rulesForDay } = require("../utils/homeCoverage");
const { inDubai, busyForDay } = require("../utils/slots");

// Body schema
const BodySchema = z
  .object({
    mode: z.enum(["in_salon", "home"]),
    start_iso: z.string(),
    staff_id: z.string().uuid().nullable().optional(),

    items: z
      .array(
        z.object({
          availability_id: z.string().uuid(),
          qty: z.number().int().min(1),
        })
      )
      .min(1),

    contact_name: z.string().optional(),
    contact_phone: z.string().optional(),

    city: z.string().optional(),
    area: z.string().optional(),

    address_line1: z.string().optional(),
    address_line2: z.string().optional(),

    house_number: z.string().optional(),
    street_name: z.string().optional(),

    latitude: z.number().nullable().optional(),
    longitude: z.number().nullable().optional(),

    map_label: z.string().optional(),
    selected_address_id: z.string().uuid().optional(),

    location_note: z.string().optional(),
    customer_note: z.string().optional(),

    gift_id: z.string().uuid().optional(),
    redeem_mode: z.enum(["gift"]).optional(),
  })
  .strict();

const DAY_INDEX = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

function dubaiDayOfWeek(date) {
  return DAY_INDEX[
    new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Dubai", weekday: "short" }).format(date)
  ];
}

function parseHHMMToMinutes(t) {
  if (!t) return null;
  const [h, m] = String(t).split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  return h * 60 + m;
}

function getUaeMinutes(date) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Dubai",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);

  const hour = Number(parts.find((p) => p.type === "hour").value);
  const minute = Number(parts.find((p) => p.type === "minute").value);

  return hour * 60 + minute;
}

function withinWorkingHours(open_time, close_time, startDate, endDate) {
  const openM = parseHHMMToMinutes(open_time);
  const closeM = parseHHMMToMinutes(close_time);
  if (openM == null || closeM == null) return false;

  const sM = getUaeMinutes(startDate);
  const eM = getUaeMinutes(endDate);

  if (closeM < openM) {
    const startOk = sM >= openM || sM <= closeM;
    const endOk = eM >= openM || eM <= closeM;
    return startOk && endOk;
  }

  return sM >= openM && eM <= closeM;
}

router.post("/salons/:salonId/branches/:branchId/bookings", authRequired, async (req, res, next) => {
  const trx = await db.transaction();

  try {
    const { salonId, branchId } = req.params;
    const body = BodySchema.parse(req.body);

    if (body.mode === "home") {
      if (!body.contact_name?.trim()) {
        await trx.rollback();
        return res.status(400).json({ error: "contact_name is required for home bookings" });
      }

      if (!body.contact_phone?.trim()) {
        await trx.rollback();
        return res.status(400).json({ error: "contact_phone is required for home bookings" });
      }

      if (!body.area?.trim()) {
        await trx.rollback();
        return res.status(400).json({ error: "area is required for home bookings" });
      }

      if (!body.address_line1?.trim()) {
        await trx.rollback();
        return res.status(400).json({ error: "address_line1 is required for home bookings" });
      }

      if (typeof body.latitude !== "number" || typeof body.longitude !== "number") {
        await trx.rollback();
        return res.status(400).json({ error: "latitude and longitude are required for home bookings" });
      }
    }

    const start = new Date(String(body.start_iso));
    if (Number.isNaN(start.getTime())) {
      await trx.rollback();
      return res.status(400).json({ error: "Invalid start_iso" });
    }

    const branchRow = await trx("branches")
      .where({ id: branchId, salon_id: salonId, is_active: true })
      .first([
        "id",
        "offers_in_salon",
        "supports_home_services",
        "home_radius_km",
        "home_min_order_aed",
      ]);

    if (!branchRow) {
      await trx.rollback();
      return res.status(404).json({ error: "Branch not found" });
    }

    if (body.mode === "in_salon" && !branchRow.offers_in_salon) {
      await trx.rollback();
      return res.status(400).json({ error: "This business only offers home service." });
    }

    // Area rules for a home visit: which days, and any area minimum or visit fee.
    let homeRules = null;

    if (body.mode === "home") {
      if (!branchRow.supports_home_services) {
        await trx.rollback();
        return res.status(400).json({ error: "This branch doesn't offer home service." });
      }

      // Coverage is checked against the service address, not where the customer is now.
      const coverage = await coverageForPoint(trx, branchId, body.longitude, body.latitude);

      if (!coverage.covered) {
        await trx.rollback();
        return res.status(400).json({
          error: "This salon doesn't cover this address for home service.",
          code: "ADDRESS_NOT_COVERED",
        });
      }

      homeRules = rulesForDay(coverage, dubaiDayOfWeek(start));

      if (!homeRules.allowed) {
        await trx.rollback();
        return res.status(400).json({
          error: "This salon doesn't visit this area on that day. Choose another day.",
          code: "DAY_NOT_COVERED",
          service_days: coverage.days,
        });
      }
    }

    const dow = inDubai(start).dow;
    const hourRow = await trx("branch_hours")
      .where({ branch_id: branchId, day_of_week: dow })
      .first();

    if (!hourRow || hourRow.is_closed) {
      await trx.rollback();
      return res.status(400).json({ error: "Branch is closed on that day" });
    }

    const availabilityIds = body.items.map((x) => x.availability_id);

    const saRows = await trx("service_availability as sa")
      .join("services as s", "s.id", "sa.service_id")
      .whereIn("sa.id", availabilityIds)
      .andWhere("sa.branch_id", branchId)
      .andWhere("s.salon_id", salonId)
      .andWhere("sa.mode", body.mode)
      .select([
        "sa.id as availability_id",
        "sa.duration_mins",
        "sa.price_aed",
        "sa.travel_fee_aed",
        "sa.is_active as availability_active",
        "s.id as service_id",
        "s.name as service_name",
        "s.is_active as service_active",
      ]);

    if (saRows.length !== availabilityIds.length) {
      await trx.rollback();
      return res.status(400).json({ error: "Invalid services in cart" });
    }

    for (const r of saRows) {
      if (!r.availability_active || !r.service_active) {
        await trx.rollback();
        return res.status(400).json({ error: "One or more services are inactive" });
      }
    }

    const itemsById = new Map(body.items.map((x) => [x.availability_id, x.qty]));
    let totalDuration = 0;
    let subtotal = 0;
    let fees = 0;

    for (const r of saRows) {
      const qty = Number(itemsById.get(r.availability_id) || 1);
      totalDuration += Number(r.duration_mins) * qty;

      const unit = Number(r.price_aed || 0);
      subtotal += unit * qty;

      if (body.mode === "home") {
        // One trip per booking: charge the highest travel fee once.
        fees = Math.max(fees, Number(r.travel_fee_aed || 0));
      }
    }

    // An area's own visit fee replaces the per-service one.
    if (body.mode === "home" && homeRules?.visitFee != null) {
      fees = homeRules.visitFee;
    }

    const minOrder = Number(homeRules?.minOrder ?? branchRow.home_min_order_aed ?? 0);

    if (body.mode === "home" && minOrder > 0 && subtotal < minOrder) {
      await trx.rollback();
      return res.status(400).json({
        error: `Home service at this salon starts from AED ${minOrder.toFixed(
          2
        )}. Add AED ${(minOrder - subtotal).toFixed(2)} more to book.`,
        code: "BELOW_HOME_MIN_ORDER",
        min_order_aed: minOrder,
        subtotal_aed: subtotal,
      });
    }

    const end = new Date(start.getTime() + totalDuration * 60 * 1000);

    const okHours = withinWorkingHours(hourRow.open_time, hourRow.close_time, start, end);
    if (!okHours) {
      await trx.rollback();
      return res.status(400).json({ error: "Selected time is outside working hours" });
    }

    const serviceIds = Array.from(new Set(saRows.map((r) => r.service_id)));

    // One booking at a time per branch, so two customers can't take the same slot.
    await trx.raw("SELECT pg_advisory_xact_lock(hashtext(?))", [`branch-booking:${branchId}`]);

    async function staffIsFree(staffId) {
      const s = start.getTime();
      const e = end.getTime();
      const hit = (spans) => spans.some(([bs, be]) => s < be && e > bs);

      // An appointment can run past midnight, so check both UAE days it touches.
      const days = [...new Set([inDubai(start).dateKey, inDubai(new Date(e - 1)).dateKey])];
      for (const dateKey of days) {
        const busy = await busyForDay(trx, { branchId, staffIds: [staffId], dateKey });
        if (hit(busy.wholeBranch) || hit(busy.byStaff.get(staffId) || [])) return false;
      }
      return true;
    }

    let chosenStaffId = body.staff_id ?? null;

    if (chosenStaffId) {
      const stRow = await trx("staff as st")
        .join("branch_staff as bs", "bs.staff_id", "st.id")
        .where("st.id", chosenStaffId)
        .andWhere("st.salon_id", salonId)
        .andWhere("st.is_active", true)
        .andWhere("bs.branch_id", branchId)
        .andWhere("bs.is_active", true)
        .first("st.id");

      if (!stRow) {
        await trx.rollback();
        return res.status(400).json({ error: "Staff not in this branch" });
      }

      const cntRow = await trx("staff_services")
        .where("staff_id", chosenStaffId)
        .whereIn("service_id", serviceIds)
        .countDistinct({ c: "service_id" })
        .first();

      if (Number(cntRow?.c || 0) !== serviceIds.length) {
        await trx.rollback();
        return res.status(400).json({ error: "Staff does not provide all selected services" });
      }

      const free = await staffIsFree(chosenStaffId);
      if (!free) {
        await trx.rollback();
        return res.status(400).json({ error: "Staff not available for that time" });
      }
    } else {
      const candidates = await trx("staff as st")
        .join("branch_staff as bs", "bs.staff_id", "st.id")
        .join("staff_services as ss", "ss.staff_id", "st.id")
        .where("st.salon_id", salonId)
        .andWhere("st.is_active", true)
        .andWhere("bs.branch_id", branchId)
        .andWhere("bs.is_active", true)
        .whereIn("ss.service_id", serviceIds)
        .groupBy("st.id", "st.name", "st.created_at")
        .havingRaw("COUNT(DISTINCT ss.service_id) = ?", [serviceIds.length])
        .select(["st.id", "st.name"])
        .orderBy("st.created_at", "desc");

      let found = null;
      for (const c of candidates) {
        if (await staffIsFree(c.id)) {
          found = c;
          break;
        }
      }

      if (!found) {
        await trx.rollback();
        return res.status(400).json({ error: "No staff available for that time" });
      }

      chosenStaffId = found.id;
    }

    const total = subtotal + fees;
    const userId = req.user.sub;

    const addressLine =
      body.mode === "home"
        ? [
          body.house_number ? `House ${String(body.house_number).trim()}` : null,
          body.street_name ? String(body.street_name).trim() : null,
          body.address_line1 ? String(body.address_line1).trim() : null,
          body.address_line2 ? String(body.address_line2).trim() : null,
        ]
          .filter(Boolean)
          .join(", ")
        : null;

    const [booking] = await trx("bookings")
      .insert({
        user_id: userId,
        salon_id: salonId,
        branch_id: branchId,
        mode: body.mode,
        scheduled_at: start.toISOString(),
        status: "pending",
        subtotal_aed: subtotal,
        fees_aed: fees,
        total_aed: total,
        customer_note: body.customer_note?.trim() || body.location_note?.trim() || null,
        contact_name: body.mode === "home" ? body.contact_name.trim() : null,
        contact_phone: body.mode === "home" ? body.contact_phone.trim() : null,
        service_area: body.mode === "home" ? String(body.area).trim() : null,
        service_address: addressLine,
        service_lat: body.mode === "home" ? body.latitude : null,
        service_lng: body.mode === "home" ? body.longitude : null,
        created_at: trx.fn.now(),
        updated_at: trx.fn.now(),
      })
      .returning("*");

    // Save the home address to the customer's address book.
    if (body.mode === "home") {
      const latNum = Number(body.latitude);
      const lngNum = Number(body.longitude);

      const existingAddress = await trx("user_addresses")
        .where({ user_id: userId })
        .andWhere("lat", latNum)
        .andWhere("lng", lngNum)
        .first();

      const geo = trx.raw("ST_SetSRID(ST_MakePoint(?, ?), 4326)::geography", [lngNum, latNum]);

      if (existingAddress) {
        await trx("user_addresses")
          .where({ id: existingAddress.id })
          .update({
            city: body.map_label?.trim() || "UAE",
            area: String(body.area || "").trim(),
            address_line: addressLine,
            geo,
          });
      } else {
        await trx("user_addresses").insert({
          user_id: userId,
          label: "Home",
          city: body.map_label?.trim() || "UAE",
          area: String(body.area || "").trim(),
          address_line: addressLine,
          lat: latNum,
          lng: lngNum,
          geo,
          is_default: false,
          created_at: trx.fn.now(),
        });
      }
    }

    for (const r of saRows) {
      const qty = Number(itemsById.get(r.availability_id) || 1);
      const unit = Number(r.price_aed || 0);
      const duration = Number(r.duration_mins || 0);

      const [bi] = await trx("booking_items")
        .insert({
          booking_id: booking.id,
          service_id: r.service_id,
          service_availability_id: r.availability_id,
          service_name: r.service_name,
          service_name_snapshot: r.service_name,
          unit_price_aed: unit,
          price_aed_snapshot: unit,
          duration_min_snapshot: duration,
          duration_mins: duration,
          qty,
          line_total_aed: unit * qty,
          created_at: trx.fn.now(),
        })
        .returning("*");

      await trx("booking_item_assignments").insert({
        booking_id: booking.id,
        booking_item_id: bi.id,
        branch_id: branchId,
        staff_id: chosenStaffId,
        starts_at: start.toISOString(),
        ends_at: end.toISOString(),
        created_at: trx.fn.now(),
      });
    }

    await trx.commit();

    return res.json({
      ok: true,
      booking_id: booking.id,
      staff_id: chosenStaffId,
      scheduled_at: start.toISOString(),
      ends_at: end.toISOString(),
      totals: {
        subtotal_aed: subtotal,
        fees_aed: fees,
        total_aed: total,
        duration_mins: totalDuration,
      },
    });
  } catch (e) {
    try {
      await trx.rollback();
    } catch { }
    next(e);
  }
});

module.exports = router;