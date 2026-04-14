// src/routes/publicBookingsCreate.js
const router = require("express").Router();
const { z } = require("zod");
const db = require("../db/knex");
const authRequired = require("../middleware/authRequired");

// Body schema
const BodySchema = z
  .object({
    mode: z.enum(["in_salon", "home"]),
    start_iso: z.string(),
    staff_id: z.string().uuid().nullable().optional(),

    items: z.array(
      z.object({
        availability_id: z.string().uuid(),
        qty: z.number().int().min(1),
      })
    ).min(1),

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

      if (
        typeof body.latitude !== "number" ||
        typeof body.longitude !== "number"
      ) {
        await trx.rollback();
        return res.status(400).json({ error: "latitude and longitude are required for home bookings" });
      }
    }

    const start = new Date(String(body.start_iso));
    if (Number.isNaN(start.getTime())) {
      await trx.rollback();
      return res.status(400).json({ error: "Invalid start_iso" });
    }

    const dow = start.getDay();
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
        const travel = Number(r.travel_fee_aed || 0);
        fees += travel * qty;
      }
    }

    const end = new Date(start.getTime() + totalDuration * 60 * 1000);

    const okHours = withinWorkingHours(hourRow.open_time, hourRow.close_time, start, end);
    if (!okHours) {
      await trx.rollback();
      return res.status(400).json({ error: "Selected time is outside working hours" });
    }

    const serviceIds = Array.from(new Set(saRows.map((r) => r.service_id)));
    const ACTIVE_STATUSES = ["pending", "confirmed"];

    async function staffIsFree(staffId) {
      const overlap = await trx("booking_item_assignments as bia")
        .join("booking_items as bi", "bi.id", "bia.booking_item_id")
        .join("bookings as b", "b.id", "bi.booking_id")
        .where("bia.staff_id", staffId)
        .andWhere("bia.branch_id", branchId)
        .whereIn("b.status", ACTIVE_STATUSES)
        .andWhere("bia.starts_at", "<", end.toISOString())
        .andWhere("bia.ends_at", ">", start.toISOString())
        .first("bia.id");

      return !overlap;
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
        const free = await staffIsFree(c.id);
        if (free) {
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
        customer_note: body.location_note ?? null,
        created_at: trx.fn.now(),
        updated_at: trx.fn.now(),
      })
      .returning("*");

    // ✅ حفظ العنوان تلقائياً بعد إنشاء الحجز المنزلي
    if (body.mode === "home") {
      const latNum = Number(body.latitude);
      const lngNum = Number(body.longitude);

      const addressLine = [
        body.house_number ? `House ${String(body.house_number).trim()}` : null,
        body.street_name ? String(body.street_name).trim() : null,
        body.address_line1 ? String(body.address_line1).trim() : null,
        body.address_line2 ? String(body.address_line2).trim() : null,
      ]
        .filter(Boolean)
        .join(", ");

      const existingAddress = await trx("user_addresses")
        .where({ user_id: userId })
        .andWhere("lat", latNum)
        .andWhere("lng", lngNum)
        .first();

      if (existingAddress) {
        await trx("user_addresses")
          .where({ id: existingAddress.id })
          .update({
            city: body.map_label?.trim() || "UAE",
            area: String(body.area || "").trim(),
            address_line: addressLine,
            geo: trx.raw(
              "ST_SetSRID(ST_MakePoint(?, ?), 4326)::geography",
              [lngNum, latNum]
            ),
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
          geo: trx.raw(
            "ST_SetSRID(ST_MakePoint(?, ?), 4326)::geography",
            [lngNum, latNum]
          ),
          is_default: false,
          created_at: trx.fn.now(),
        });
      }
    }

    for (const r of saRows) {
      const qty = Number(itemsById.get(r.availability_id) || 1);
      const unit = Number(r.price_aed || 0);
      const lineTotal = unit * qty;
      const duration = Number(r.duration_mins || 0);

      const [bi] = await trx("booking_items")
        .insert({
          booking_id: booking.id,
          service_id: r.service_id,
          service_availability_id: r.availability_id,
          service_name_snapshot: r.service_name,
          price_aed_snapshot: unit,
          duration_min_snapshot: duration,
          duration_mins: duration,
          qty,
          line_total_aed: lineTotal,
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
    } catch {}
    next(e);
  }
});

module.exports = router;