const router = require("express").Router();
const authRequired = require("../middleware/authRequired");
const db = require("../db/knex");

// GET all addresses
router.get("/", authRequired, async (req, res) => {
  const userId = req.user.sub;

  const data = await db("user_addresses")
    .where({ user_id: userId })
    .orderBy("is_default", "desc");

  res.json({ ok: true, data });
});

// ADD address
router.post("/", authRequired, async (req, res) => {
  const userId = req.user.sub;

  const {
    label,
    city,
    area,
    address_line,
    lat,
    lng,
    is_default,
  } = req.body;

  if (!city || !area || !address_line || !lat || !lng) {
    return res.status(400).json({ error: "Missing fields" });
  }

  // إذا default → شيلي القديم
  if (is_default) {
    await db("user_addresses")
      .where({ user_id: userId })
      .update({ is_default: false });
  }

  const [row] = await db("user_addresses")
    .insert({
      user_id: userId,
      label,
      city,
      area,
      address_line,
      lat,
      lng,
      geo: db.raw(
        "ST_SetSRID(ST_MakePoint(?, ?), 4326)",
        [lng, lat]
      ),
      is_default: !!is_default,
    })
    .returning("*");

  res.json({ ok: true, data: row });
});

// SET default
router.patch("/:id/default", authRequired, async (req, res) => {
  const userId = req.user.sub;
  const { id } = req.params;

  await db("user_addresses")
    .where({ user_id: userId })
    .update({ is_default: false });

  await db("user_addresses")
    .where({ id, user_id: userId })
    .update({ is_default: true });

  res.json({ ok: true });
});

module.exports = router;