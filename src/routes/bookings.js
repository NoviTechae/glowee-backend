// src/routes/bookings.js
const router = require("express").Router();
const { z } = require("zod");
const db = require("../db/knex");

function overlap(qb, start, end) {
  return qb.where("bia.starts_at", "<", end).andWhere("bia.ends_at", ">", start);
}

const PreviewSchema = z.object({
  salon_id: z.string().uuid(),
  branch_id: z.string().uuid(),
  mode: z.enum(["in_salon", "home"]).default("in_salon"),
  starts_at: z.string().datetime(),
  items: z.array(
    z.object({
      availability_id: z.string().uuid(),
      qty: z.number().int().min(1).default(1),
    })
  ).min(1),
});

router.post("/preview", async (req, res, next) => {
  try {
    const body = PreviewSchema.parse(req.body);

    // ✅ 0) تأكد الفرع يتبع الصالون
    const branch = await db("branches")
      .where({ id: body.branch_id, salon_id: body.salon_id, is_active: true })
      .first("id");
    if (!branch) {
      return res.status(404).json({ error: "Branch not found for this salon" });
    }

    // 1) availability rows (مدة كل خدمة) + تأكد تتبع نفس الصالون
    const avIds = body.items.map(i => i.availability_id);

    const avRows = await db("service_availability as sa")
      .join("services as s", "s.id", "sa.service_id")
      .whereIn("sa.id", avIds)
      .andWhere("sa.branch_id", body.branch_id)
      .andWhere("sa.mode", body.mode)
      .andWhere("sa.is_active", true)
      .andWhere("s.is_active", true)
      .andWhere("s.salon_id", body.salon_id)
      .select([
        "sa.id as availability_id",
        "sa.duration_mins",
        "sa.service_id",
      ]);

    if (avRows.length !== avIds.length) {
      return res.status(400).json({ error: "Some services are not available for this branch/mode" });
    }

    // 2) total duration
    const durationById = new Map(avRows.map(r => [r.availability_id, Number(r.duration_mins)]));
    const serviceIds = [...new Set(avRows.map(r => r.service_id))];

    const totalDuration = body.items.reduce((sum, it) => {
      const d = durationById.get(it.availability_id) || 0;
      return sum + d * it.qty;
    }, 0);

    const startsAt = new Date(body.starts_at);
    const endsAt = new Date(startsAt.getTime() + totalDuration * 60 * 1000);

    // 3) candidates staff in branch
    const candidates = await db("staff as st")
      .join("branch_staff as bs", "bs.staff_id", "st.id")
      .where("bs.branch_id", body.branch_id)
      .andWhere("st.salon_id", body.salon_id) // ✅ مهم
      .andWhere("st.is_active", true)
      .select(["st.id", "st.name", "st.image_url"]);

    if (!candidates.length) {
      return res.json({
        total_duration_mins: totalDuration,
        starts_at: startsAt.toISOString(),
        ends_at: endsAt.toISOString(),
        any_staff_ok: false,
        available_staff: [],
      });
    }

    // 4) staff لازم يقدم كل الخدمات المطلوبة
    const staffServiceCounts = await db("staff_services as ss")
      .whereIn("ss.staff_id", candidates.map(c => c.id))
      .whereIn("ss.service_id", serviceIds)
      .groupBy("ss.staff_id")
      .select("ss.staff_id")
      .count("* as c");

    const requiredCount = serviceIds.length;
    const okStaffIds = new Set(
      staffServiceCounts
        .filter(r => Number(r.c) === requiredCount)
        .map(r => r.staff_id)
    );

    const filtered = candidates.filter(c => okStaffIds.has(c.id));

    if (!filtered.length) {
      return res.json({
        total_duration_mins: totalDuration,
        starts_at: startsAt.toISOString(),
        ends_at: endsAt.toISOString(),
        any_staff_ok: false,
        available_staff: [],
      });
    }

    // 5) time conflict
    const busyRows = await db("booking_item_assignments as bia")
      .whereIn("bia.staff_id", filtered.map(s => s.id))
      .andWhere("bia.branch_id", body.branch_id)
      .modify(qb => overlap(qb, startsAt, endsAt))
      .select(["bia.staff_id"]);

    const busy = new Set(busyRows.map(r => r.staff_id));
    const available = filtered.filter(s => !busy.has(s.id));

    return res.json({
      total_duration_mins: totalDuration,
      starts_at: startsAt.toISOString(),
      ends_at: endsAt.toISOString(),
      any_staff_ok: available.length > 0,
      available_staff: available,
    });
  } catch (e) {
    next(e);
  }
});

/**
 * ✨ NEW ENDPOINT: Get available time slots for a service
 * 
 * GET /bookings/availability
 * 
 * Query params:
 * - service_id (required): UUID of the service
 * - branch_id (required): UUID of the branch
 * - date (required): Date in YYYY-MM-DD format
 * - mode (optional): "in_salon" or "home" (default: "in_salon")
 * - staff_id (optional): Specific staff UUID (if customer wants specific staff)
 * 
 * Returns: Array of available time slots with available staff count
 */
router.get("/availability", async (req, res, next) => {
  try {
    const { service_id, branch_id, date, mode = "in_salon", staff_id } = req.query;

    // Validation
    if (!service_id || !branch_id || !date) {
      return res.status(400).json({ 
        error: "service_id, branch_id, and date are required" 
      });
    }

    // Validate date format
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: "Date must be in YYYY-MM-DD format" });
    }

    // Get service availability for this branch and mode
    const availability = await db("service_availability as sa")
      .join("services as s", "s.id", "sa.service_id")
      .where("sa.service_id", service_id)
      .andWhere("sa.branch_id", branch_id)
      .andWhere("sa.mode", mode)
      .andWhere("sa.is_active", true)
      .andWhere("s.is_active", true)
      .first([
        "sa.id",
        "sa.duration_mins",
        "sa.service_id",
        "s.salon_id",
      ]);

    if (!availability) {
      return res.status(404).json({ 
        error: "Service not available for this branch/mode" 
      });
    }

    // Get branch working hours for this date
    const dayOfWeek = new Date(date).getDay();
    const branchHours = await db("branch_hours")
      .where({ branch_id, day_of_week: dayOfWeek })
      .first(["open_time", "close_time", "is_closed"]);

    if (!branchHours || branchHours.is_closed) {
      return res.json({ 
        slots: [],
        message: "Branch is closed on this day" 
      });
    }

    // Get all staff who can provide this service at this branch
    let staffQuery = db("staff as st")
      .join("branch_staff as bs", "bs.staff_id", "st.id")
      .join("staff_services as ss", "ss.staff_id", "st.id")
      .where("bs.branch_id", branch_id)
      .andWhere("ss.service_id", service_id)
      .andWhere("st.salon_id", availability.salon_id)
      .andWhere("st.is_active", true)
      .select(["st.id", "st.name"]);

    // If specific staff requested
    if (staff_id) {
      staffQuery = staffQuery.where("st.id", staff_id);
    }

    const staffForService = await staffQuery;

    if (staffForService.length === 0) {
      return res.json({ 
        slots: [],
        message: staff_id ? "Staff not available" : "No staff available for this service" 
      });
    }

    const totalStaff = staffForService.length;
    const staffIds = staffForService.map(s => s.id);

    // Generate time slots based on branch hours
    const slots = generateTimeSlots(
      branchHours.open_time,
      branchHours.close_time,
      availability.duration_mins
    );

    // Check availability for each slot
    const availableSlots = [];

    for (const slot of slots) {
      const slotStart = new Date(`${date}T${slot.start_time}`);
      const slotEnd = new Date(`${date}T${slot.end_time}`);

      // Count staff with existing bookings at this time
      const bookedStaffRows = await db("booking_item_assignments as bia")
        .join("bookings as b", "b.id", "bia.booking_id")
        .whereIn("bia.staff_id", staffIds)
        .andWhere("bia.branch_id", branch_id)
        .whereIn("b.status", ["pending", "confirmed"])
        .andWhere("bia.starts_at", "<", slotEnd)
        .andWhere("bia.ends_at", ">", slotStart)
        .distinct("bia.staff_id")
        .select("bia.staff_id");

      const bookedStaffCount = bookedStaffRows.length;

      // Count staff blocked at this time
      const blockedStaffRows = await db("blocked_time_slots")
        .where("branch_id", branch_id)
        .andWhere("blocked_date", date)
        .andWhere("start_time", "<=", slot.start_time)
        .andWhere("end_time", ">", slot.start_time)
        .andWhere(function() {
          // Either specific staff is blocked OR all staff are blocked
          this.whereIn("staff_id", staffIds).orWhereNull("staff_id");
        })
        .select("staff_id");

      // If there's an "all staff" block, count all staff as blocked
      const hasAllStaffBlock = blockedStaffRows.some(row => row.staff_id === null);
      const blockedStaffCount = hasAllStaffBlock 
        ? totalStaff 
        : blockedStaffRows.filter(row => row.staff_id !== null).length;

      // Calculate available staff
      const availableStaffCount = totalStaff - bookedStaffCount - blockedStaffCount;

      // Only include slot if at least 1 staff is available
      if (availableStaffCount > 0) {
        availableSlots.push({
          start_time: slot.start_time,
          end_time: slot.end_time,
          available_staff_count: availableStaffCount,
          total_staff_count: totalStaff,
        });
      }
    }

    res.json({
      date,
      service_id,
      branch_id,
      mode,
      duration_mins: availability.duration_mins,
      slots: availableSlots,
    });

  } catch (e) {
    next(e);
  }
});

/**
 * Helper function: Generate time slots
 */
function generateTimeSlots(openTime, closeTime, durationMins) {
  const slots = [];
  
  // Parse times (format: "HH:MM:SS" or "HH:MM")
  const [openHour, openMin] = openTime.split(":").map(Number);
  const [closeHour, closeMin] = closeTime.split(":").map(Number);
  
  // Convert to minutes from midnight
  let currentMins = openHour * 60 + openMin;
  const closeMins = closeHour * 60 + closeMin;
  
  while (currentMins + durationMins <= closeMins) {
    const startHour = Math.floor(currentMins / 60);
    const startMin = currentMins % 60;
    
    const endMins = currentMins + durationMins;
    const endHour = Math.floor(endMins / 60);
    const endMin = endMins % 60;
    
    const startTime = `${String(startHour).padStart(2, '0')}:${String(startMin).padStart(2, '0')}:00`;
    const endTime = `${String(endHour).padStart(2, '0')}:${String(endMin).padStart(2, '0')}:00`;
    
    slots.push({
      start_time: startTime,
      end_time: endTime,
    });
    
    // Move to next slot (30 min intervals or service duration, whichever is smaller)
    currentMins += Math.min(30, durationMins);
  }
  
  return slots;
}

module.exports = router;