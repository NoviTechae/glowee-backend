//src/controllers/receiverController.js
const knex = require('../db/knex'); // مهم جدًا

exports.getUserReceivers = async (req, res) => {
  const rows = await knex("user_receivers")
    .where("user_id", req.user.sub)
    .orderBy("created_at", "desc");

  res.json(rows);
};

exports.addReceiver = async (req, res) => {
  const { name, phone } = req.body;

  const [row] = await knex("user_receivers")
    .insert({
      user_id: req.user.sub,
      name,
      phone,
    })
    .onConflict(["user_id", "phone"])
    .ignore()
    .returning("*");

  res.json(row);
};

exports.deleteReceiver = async (req, res) => {
  await knex("user_receivers")
    .where({
      user_id: req.user.sub,
      phone: req.params.phone,
    })
    .del();

  res.json({ ok: true });
};