// src/controllers/ratingController.js
const knex = require("../db/knex");

exports.rateBranch = async (req, res, next) => {
  try {
    const { branchId } = req.params;
    const { rating, comment, booking_id, user_id } = req.body;

    if (!rating || rating < 1 || rating > 5) {
      return res.status(400).json({ message: "Invalid rating" });
    }

    // ❌ لا يقيم مرتين
    const exists = await knex("booking_ratings")
      .where({ booking_id })
      .first();

    if (exists) {
      return res.status(400).json({ message: "Already rated" });
    }

    const [row] = await knex("booking_ratings")
      .insert({
        branch_id: branchId,
        booking_id,
        user_id,
        rating,
        comment: comment || null,
        created_at: knex.fn.now(),
      })
      .returning("*");

    res.json({ success: true, rating: row });
  } catch (err) {
    next(err);
  }
};