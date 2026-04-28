// src/controllers/searchController.js
const knex = require("../db/knex");

exports.getPopularSearches = async (req, res, next) => {
  try {
    const rows = await knex("services")
      .where("is_active", true)
      .whereNotNull("name")
      .select("name")
      .count("* as total")
      .groupBy("name")
      .orderBy("total", "desc")
      .limit(8);

    const data = rows
      .map((row) => row.name)
      .filter(Boolean);

    return res.json({
      ok: true,
      data,
    });
  } catch (err) {
    next(err);
  }
};