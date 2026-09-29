// src/routes/publicAvailabilityStaff.js
const router = require("express").Router();
const { z } = require("zod");
const db = require("../db/knex");
const { whereBookingHoldsSlot } = require("../utils/bookingHold");

const QuerySchema = z.object({
  start_iso: z.string().min(10),
}).strict();

router.get(
  "/:salonId/branches/:branchId/availability/:availabilityId/staff",
  async (req, res, next) => {
    try {
      const { salonId, branchId, availabilityId } = req.params;
      const q = QuerySchema.parse(req.query);

      // 1) تأكد availability + جلب الخدمة والمدة
      const sa = await db("service_availability as sa")
        .join("services as s", "s.id", "sa.service_id")
        .where("sa.id", availabilityId)
        .andWhere("sa.branch_id", branchId)
        .andWhere("s.salon_id", salonId)
        .select([
          "sa.id",
          "sa.service_id",
          "sa.duration_mins",
          "sa.is_active",
          "s.is_active as service_active",
        ])
        .first();

      if (!sa || !sa.is_active || !sa.service_active) {
        return res.status(404).json({ error: "Availability not found" });
      }

      // 2) حساب end_iso من duration
      const start = new Date(String(q.start_iso));
      if (Number.isNaN(start.getTime())) {
        return res.status(400).json({ error: "Invalid start_iso" });
      }
      const end = new Date(start.getTime() + Number(sa.duration_mins) * 60 * 1000);

      // 3) staff في نفس الفرع + يشتغلون الخدمة + متاحين (no overlap)
      const rows = await db("staff as st")
        .join("branch_staff as bs", "bs.staff_id", "st.id")
        .join("staff_services as ss", "ss.staff_id", "st.id")
        .leftJoin(
          db("booking_item_assignments as bia")
            .join("bookings as b", "b.id", "bia.booking_id")
            .modify((qb) => whereBookingHoldsSlot(qb, db))
            .where("bia.branch_id", branchId)
            .andWhere("bia.starts_at", "<", end.toISOString())
            .andWhere("bia.ends_at", ">", start.toISOString())
            .select("bia.staff_id")
            .as("busy"),
          "busy.staff_id",
          "st.id"
        )
        .where("st.salon_id", salonId)
        .andWhere("bs.branch_id", branchId)
        .andWhere("bs.is_active", true)
        .andWhere("st.is_active", true)
        .andWhere("ss.service_id", sa.service_id)
        .whereNull("busy.staff_id")
        .select(["st.id", "st.name"])
        .orderBy("st.created_at", "desc");
      return res.json({
        data: rows,
        meta: {
          start_iso: start.toISOString(),
          end_iso: end.toISOString(),
          duration_mins: sa.duration_mins,
        },
      });
    } catch (e) {
      next(e);
    }
  }
);

module.exports = router;