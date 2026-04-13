const knex = require("../db/knex");

exports.rateBranch = async (req, res, next) => {
  try {
    const { branchId } = req.params;
    const { rating, comment, booking_id } = req.body;
    const userId = req.user.sub;

    if (!rating || rating < 1 || rating > 5) {
      return res.status(400).json({ error: "Invalid rating" });
    }

    if (!booking_id) {
      return res.status(400).json({ error: "booking_id is required" });
    }

    const booking = await knex("bookings")
      .where({
        id: booking_id,
        user_id: userId,
        branch_id: branchId,
      })
      .first();

    if (!booking) {
      return res.status(404).json({ error: "Booking not found" });
    }

    if (booking.status !== "completed") {
      return res.status(400).json({ error: "Booking not completed" });
    }

    const exists = await knex("booking_ratings")
      .where({ booking_id })
      .first();

    if (exists) {
      return res.status(400).json({ error: "Already rated" });
    }

    const [row] = await knex("booking_ratings")
      .insert({
        branch_id: branchId,
        salon_id: booking.salon_id,
        booking_id,
        user_id: userId,
        rating,
        comment: comment || null,
        created_at: knex.fn.now(),
      })
      .returning("*");

    const [{ avg, count }] = await knex("booking_ratings")
      .where({ branch_id: branchId })
      .avg("rating as avg")
      .count("* as count");

    await knex("branches")
      .where({ id: branchId })
      .update({
        rating: Number(avg || 0),
        reviews_count: Number(count || 0),
        updated_at: knex.fn.now(),
      });

    res.json({ ok: true, rating: row });
  } catch (err) {
    next(err);
  }
};