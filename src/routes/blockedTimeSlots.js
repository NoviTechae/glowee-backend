// backend/src/routes/blockedTimeSlots.js

const express = require("express");
const router = express.Router();
const db = require("../db/knex");

// ✅ CORRECT: Use the same middleware as dashboardSalon.js
const dashboardAuthRequired = require("../middleware/dashboardAuthRequired");

// Helper function: Check if user is salon
function requireSalon(req, res, next) {
  if (req.dashboard?.role !== "salon") {
    return res.status(403).json({ error: "Salon only" });
  }
  if (!req.dashboard?.salon_id) {
    return res.status(401).json({ error: "Missing salon_id" });
  }
  next();
}

/**
 * GET /dashboard/salon/blocked-slots
 * Get all blocked time slots for salon
 * Query params: ?branch_id=xxx&date=2024-03-15&staff_id=xxx
 */
router.get("/", dashboardAuthRequired, requireSalon, async (req, res, next) => {
  try {
    const salon_id = req.dashboard.salon_id;
    const { branch_id, date, staff_id } = req.query;

    let query = db("blocked_time_slots as bts")
      .leftJoin("branches as b", "b.id", "bts.branch_id")
      .leftJoin("staff as s", "s.id", "bts.staff_id")
      .where("bts.salon_id", salon_id)
      .select([
        "bts.id",
        "bts.branch_id",
        "b.name as branch_name",
        "bts.staff_id",
        "s.name as staff_name",
        "bts.blocked_date",
        "bts.start_time",
        "bts.end_time",
        "bts.reason",
        "bts.customer_name",
        "bts.customer_phone",
        "bts.created_at",
      ])
      .orderBy("bts.blocked_date", "desc")
      .orderBy("bts.start_time", "asc");

    if (branch_id) {
      query = query.where("bts.branch_id", branch_id);
    }

    if (date) {
      query = query.where("bts.blocked_date", date);
    }

    if (staff_id) {
      query = query.where("bts.staff_id", staff_id);
    }

    const slots = await query;

    res.json({ data: slots });
  } catch (e) {
    next(e);
  }
});

/**
 * POST /dashboard/salon/blocked-slots
 * Create a new blocked time slot
 */
router.post("/", dashboardAuthRequired, requireSalon, async (req, res, next) => {
  try {
    const salon_id = req.dashboard.salon_id;
    const account_id = req.dashboard.account_id;
    const {
      branch_id,
      staff_id,
      blocked_date,
      start_time,
      end_time,
      reason,
      customer_name,
      customer_phone,
    } = req.body;

    // Validation
    if (!branch_id) {
      return res.status(400).json({ error: "Branch is required" });
    }

    if (!blocked_date) {
      return res.status(400).json({ error: "Date is required" });
    }

    if (!start_time || !end_time) {
      return res.status(400).json({ error: "Start time and end time are required" });
    }

    // Verify branch belongs to salon
    const branch = await db("branches")
      .where({ id: branch_id, salon_id })
      .first();

    if (!branch) {
      return res.status(404).json({ error: "Branch not found" });
    }

    // If staff_id provided, verify it belongs to salon
    if (staff_id) {
      const staff = await db("staff")
        .where({ id: staff_id, salon_id })
        .first();

      if (!staff) {
        return res.status(404).json({ error: "Staff not found" });
      }
    }

    // Check for overlapping blocks
    const overlapping = await db("blocked_time_slots")
      .where({
        salon_id,
        branch_id,
        blocked_date,
      })
      .where((qb) => {
        if (staff_id) {
          qb.where("staff_id", staff_id).orWhereNull("staff_id");
        }
      })
      .where((qb) => {
        qb.where((q) => {
          q.where("start_time", "<=", start_time).andWhere("end_time", ">", start_time);
        })
        .orWhere((q) => {
          q.where("start_time", "<", end_time).andWhere("end_time", ">=", end_time);
        })
        .orWhere((q) => {
          q.where("start_time", ">=", start_time).andWhere("end_time", "<=", end_time);
        });
      })
      .first();

    if (overlapping) {
      return res.status(400).json({ 
        error: "This time slot overlaps with an existing blocked slot",
        overlapping: {
          start_time: overlapping.start_time,
          end_time: overlapping.end_time,
        }
      });
    }

    // Create blocked slot
    const [slot] = await db("blocked_time_slots")
      .insert({
        salon_id,
        branch_id,
        staff_id: staff_id || null,
        blocked_date,
        start_time,
        end_time,
        reason: reason || null,
        customer_name: customer_name || null,
        customer_phone: customer_phone || null,
        created_by_account_id: account_id,
      })
      .returning("*");

    // Get full details with branch and staff names
    const fullSlot = await db("blocked_time_slots as bts")
      .leftJoin("branches as b", "b.id", "bts.branch_id")
      .leftJoin("staff as s", "s.id", "bts.staff_id")
      .where("bts.id", slot.id)
      .select([
        "bts.*",
        "b.name as branch_name",
        "s.name as staff_name",
      ])
      .first();

    res.status(201).json({ 
      slot: fullSlot,
      message: "Time slot blocked successfully" 
    });
  } catch (e) {
    next(e);
  }
});

/**
 * PUT /dashboard/salon/blocked-slots/:id
 * Update a blocked time slot
 */
router.put("/:id", dashboardAuthRequired, requireSalon, async (req, res, next) => {
  try {
    const salon_id = req.dashboard.salon_id;
    const { id } = req.params;
    const {
      blocked_date,
      start_time,
      end_time,
      reason,
      customer_name,
      customer_phone,
    } = req.body;

    // Verify slot exists and belongs to salon
    const existing = await db("blocked_time_slots")
      .where({ id, salon_id })
      .first();

    if (!existing) {
      return res.status(404).json({ error: "Blocked slot not found" });
    }

    // Update
    await db("blocked_time_slots")
      .where({ id })
      .update({
        blocked_date: blocked_date || existing.blocked_date,
        start_time: start_time || existing.start_time,
        end_time: end_time || existing.end_time,
        reason: reason !== undefined ? reason : existing.reason,
        customer_name: customer_name !== undefined ? customer_name : existing.customer_name,
        customer_phone: customer_phone !== undefined ? customer_phone : existing.customer_phone,
        updated_at: db.fn.now(),
      });

    // Get updated slot
    const updated = await db("blocked_time_slots as bts")
      .leftJoin("branches as b", "b.id", "bts.branch_id")
      .leftJoin("staff as s", "s.id", "bts.staff_id")
      .where("bts.id", id)
      .select([
        "bts.*",
        "b.name as branch_name",
        "s.name as staff_name",
      ])
      .first();

    res.json({ 
      slot: updated,
      message: "Blocked slot updated successfully" 
    });
  } catch (e) {
    next(e);
  }
});

/**
 * DELETE /dashboard/salon/blocked-slots/:id
 * Delete a blocked time slot
 */
router.delete("/:id", dashboardAuthRequired, requireSalon, async (req, res, next) => {
  try {
    const salon_id = req.dashboard.salon_id;
    const { id } = req.params;

    // Verify slot exists and belongs to salon
    const existing = await db("blocked_time_slots")
      .where({ id, salon_id })
      .first();

    if (!existing) {
      return res.status(404).json({ error: "Blocked slot not found" });
    }

    // Delete
    await db("blocked_time_slots")
      .where({ id })
      .delete();

    res.json({ message: "Blocked slot deleted successfully" });
  } catch (e) {
    next(e);
  }
});

/**
 * GET /dashboard/salon/blocked-slots/calendar
 * Get blocked slots for calendar view (month view)
 * Query: ?branch_id=xxx&month=2024-03&staff_id=xxx
 */
router.get("/calendar", dashboardAuthRequired, requireSalon, async (req, res, next) => {
  try {
    const salon_id = req.dashboard.salon_id;
    const { branch_id, month, staff_id } = req.query;

    if (!month) {
      return res.status(400).json({ error: "Month is required (format: YYYY-MM)" });
    }

    // Parse month (format: YYYY-MM)
    const [year, monthNum] = month.split("-");
    const startDate = `${year}-${monthNum}-01`;
    const endDate = new Date(year, monthNum, 0).toISOString().split("T")[0];

    let query = db("blocked_time_slots as bts")
      .leftJoin("branches as b", "b.id", "bts.branch_id")
      .leftJoin("staff as s", "s.id", "bts.staff_id")
      .where("bts.salon_id", salon_id)
      .whereBetween("bts.blocked_date", [startDate, endDate])
      .select([
        "bts.id",
        "bts.branch_id",
        "b.name as branch_name",
        "bts.staff_id",
        "s.name as staff_name",
        "bts.blocked_date",
        "bts.start_time",
        "bts.end_time",
        "bts.reason",
      ])
      .orderBy("bts.blocked_date", "asc")
      .orderBy("bts.start_time", "asc");

    if (branch_id) {
      query = query.where("bts.branch_id", branch_id);
    }

    if (staff_id) {
      query = query.where("bts.staff_id", staff_id);
    }

    const slots = await query;

    // Group by date
    const byDate = {};
    slots.forEach((slot) => {
      const date = slot.blocked_date;
      if (!byDate[date]) {
        byDate[date] = [];
      }
      byDate[date].push(slot);
    });

    res.json({ 
      data: slots,
      byDate,
      month,
    });
  } catch (e) {
    next(e);
  }
});

module.exports = router;