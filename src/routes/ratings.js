// src/routes/ratings.js

const router = require("express").Router();
const db = require("../db/knex");
const authRequired = require("../middleware/authRequired");
const controller = require("../controllers/ratingController");

// =======================================
// GET /ratings/pending
// =======================================
router.get("/pending", authRequired, async (req, res, next) => {
  try {
    const userId = req.user.sub;

    const rows = await db("bookings as b")
      .leftJoin("booking_ratings as r", "r.booking_id", "b.id")
      .leftJoin("salons as s", "s.id", "b.salon_id")
      .leftJoin("branches as br", "br.id", "b.branch_id")
      .where("b.user_id", userId)
      .andWhere("b.status", "completed")
      .whereNull("r.id")
      .select([
        "b.id as booking_id",
        "b.salon_id",
        "b.branch_id",
        "s.name as salon_name",
        "br.name as branch_name",
      ])
      .orderBy("b.created_at", "desc")
      .limit(1);

    res.json({ data: rows });
  } catch (e) {
    next(e);
  }
});

// =======================================
// POST /ratings/:bookingId
// =======================================
router.post("/:bookingId", authRequired, async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const { bookingId } = req.params;
    const { rating, comment } = req.body;

    if (!rating || rating < 1 || rating > 5) {
      return res.status(400).json({ error: "Invalid rating" });
    }

    const booking = await db("bookings")
      .where({ id: bookingId, user_id: userId })
      .first();

    if (!booking) {
      return res.status(404).json({ error: "Booking not found" });
    }

    if (booking.status !== "completed") {
      return res.status(400).json({ error: "Booking not completed" });
    }

    const existing = await db("booking_ratings")
      .where({ booking_id: bookingId })
      .first();

    if (existing) {
      return res.status(400).json({ error: "Already rated" });
    }

    const result = await db.transaction(async (trx) => {
      const [inserted] = await trx("booking_ratings")
        .insert({
          booking_id: booking.id,
          user_id: userId,
          salon_id: booking.salon_id,
          branch_id: booking.branch_id,
          rating,
          comment: comment || null,
          created_at: trx.fn.now(),
        })
        .returning("*");

      // =========================
      // UPDATE BRANCH SNAPSHOT
      // =========================
      if (booking.branch_id) {
        const [{ avg, count }] = await trx("booking_ratings")
          .where({ branch_id: booking.branch_id })
          .avg("rating as avg")
          .count("* as count");

        await trx("branches")
          .where({ id: booking.branch_id })
          .update({
            rating: Number(avg || 0),
            reviews_count: Number(count || 0),
            updated_at: trx.fn.now(),
          });
      }

      return inserted;
    });

    res.json({ ok: true, rating: result });
  } catch (e) {
    next(e);
  }
});

router.post("/branches/:branchId/rate", controller.rateBranch);

module.exports = router;