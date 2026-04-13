// src/controllers/profileController.js
const db = require("../db/knex");

function toNull(v) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s ? s : null;
}

function isValidEmail(email) {
  if (!email) return true;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email).trim());
}

function isValidDob(dob) {
  if (!dob) return true;
  return /^\d{4}-\d{2}-\d{2}$/.test(String(dob).trim());
}

// GET /me/profile
exports.getMyProfile = async (req, res, next) => {
  try {
    const userId = req.user.sub || req.user.id;

    const user = await db("users")
      .where({ id: userId })
      .first([
        "id",
        "name",
        "phone",
        "email",
        "date_of_birth",
        "created_at",
        "updated_at",
      ]);

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    return res.json({
      ok: true,
      data: {
        id: user.id,
        name: user.name || "",
        phone: user.phone || "",
        email: user.email || "",
        date_of_birth: user.date_of_birth || "",
        created_at: user.created_at,
        updated_at: user.updated_at,
      },
    });
  } catch (err) {
    next(err);
  }
};

// PUT /me/profile
exports.updateMyProfile = async (req, res, next) => {
  try {
    const userId = req.user.sub || req.user.id;
    const { name, email, date_of_birth } = req.body;

    const cleanName = String(name || "").trim();
    const cleanEmail = toNull(email);
    const cleanDob = toNull(date_of_birth);

    if (cleanName.length < 2) {
      return res.status(400).json({ error: "Name must be at least 2 characters" });
    }

    if (cleanName.length > 35) {
      return res.status(400).json({ error: "Name must be 35 characters or less" });
    }

    if (!isValidEmail(cleanEmail)) {
      return res.status(400).json({ error: "Invalid email" });
    }

    if (!isValidDob(cleanDob)) {
      return res.status(400).json({ error: "Invalid date_of_birth format. Use YYYY-MM-DD" });
    }

    const [updated] = await db("users")
      .where({ id: userId })
      .update({
        name: cleanName,
        email: cleanEmail,
        date_of_birth: cleanDob,
        updated_at: db.fn.now(),
      })
      .returning([
        "id",
        "name",
        "phone",
        "email",
        "date_of_birth",
        "created_at",
        "updated_at",
      ]);

    if (!updated) {
      return res.status(404).json({ error: "User not found" });
    }

    return res.json({
      ok: true,
      data: {
        id: updated.id,
        name: updated.name || "",
        phone: updated.phone || "",
        email: updated.email || "",
        date_of_birth: updated.date_of_birth || "",
        created_at: updated.created_at,
        updated_at: updated.updated_at,
      },
    });
  } catch (err) {
    next(err);
  }
};

// GET /me/addresses
exports.getMyAddresses = async (req, res, next) => {
  try {
    const userId = req.user.sub || req.user.id;

    const rows = await db("user_addresses")
      .where({ user_id: userId })
      .orderBy("created_at", "desc")
      .select([
        "id",
        "label",
        "contact_name",
        "contact_phone",
        "city",
        "area",
        "address_line1",
        "address_line2",
        "location_note",
        "lat",
        "lng",
        "created_at",
        "updated_at",
      ]);

    return res.json({ ok: true, data: rows });
  } catch (err) {
    next(err);
  }
};

// POST /me/addresses
exports.createMyAddress = async (req, res, next) => {
  try {
    const userId = req.user.sub || req.user.id;

    const {
      label,
      contact_name,
      contact_phone,
      city,
      area,
      address_line1,
      address_line2,
      location_note,
      lat,
      lng,
    } = req.body;

    if (!String(area || "").trim()) {
      return res.status(400).json({ error: "Area is required" });
    }

    if (!String(address_line1 || "").trim()) {
      return res.status(400).json({ error: "Address line 1 is required" });
    }

    const [row] = await db("user_addresses")
      .insert({
        user_id: userId,
        label: toNull(label),
        contact_name: toNull(contact_name),
        contact_phone: toNull(contact_phone),
        city: toNull(city),
        area: String(area).trim(),
        address_line1: String(address_line1).trim(),
        address_line2: toNull(address_line2),
        location_note: toNull(location_note),
        lat: lat != null ? Number(lat) : null,
        lng: lng != null ? Number(lng) : null,
        created_at: db.fn.now(),
        updated_at: db.fn.now(),
      })
      .returning([
        "id",
        "label",
        "contact_name",
        "contact_phone",
        "city",
        "area",
        "address_line1",
        "address_line2",
        "location_note",
        "lat",
        "lng",
        "created_at",
        "updated_at",
      ]);

    return res.json({ ok: true, data: row });
  } catch (err) {
    next(err);
  }
};

// PUT /me/addresses/:id
exports.updateMyAddress = async (req, res, next) => {
  try {
    const userId = req.user.sub || req.user.id;
    const { id } = req.params;

    const {
      label,
      contact_name,
      contact_phone,
      city,
      area,
      address_line1,
      address_line2,
      location_note,
      lat,
      lng,
    } = req.body;

    const existing = await db("user_addresses")
      .where({ id, user_id: userId })
      .first("id");

    if (!existing) {
      return res.status(404).json({ error: "Address not found" });
    }

    if (!String(area || "").trim()) {
      return res.status(400).json({ error: "Area is required" });
    }

    if (!String(address_line1 || "").trim()) {
      return res.status(400).json({ error: "Address line 1 is required" });
    }

    const [row] = await db("user_addresses")
      .where({ id, user_id: userId })
      .update({
        label: toNull(label),
        contact_name: toNull(contact_name),
        contact_phone: toNull(contact_phone),
        city: toNull(city),
        area: String(area).trim(),
        address_line1: String(address_line1).trim(),
        address_line2: toNull(address_line2),
        location_note: toNull(location_note),
        lat: lat != null ? Number(lat) : null,
        lng: lng != null ? Number(lng) : null,
        updated_at: db.fn.now(),
      })
      .returning([
        "id",
        "label",
        "contact_name",
        "contact_phone",
        "city",
        "area",
        "address_line1",
        "address_line2",
        "location_note",
        "lat",
        "lng",
        "created_at",
        "updated_at",
      ]);

    return res.json({ ok: true, data: row });
  } catch (err) {
    next(err);
  }
};

// DELETE /me/addresses/:id
exports.deleteMyAddress = async (req, res, next) => {
  try {
    const userId = req.user.sub || req.user.id;
    const { id } = req.params;

    const exists = await db("user_addresses")
      .where({ id, user_id: userId })
      .first("id");

    if (!exists) {
      return res.status(404).json({ error: "Address not found" });
    }

    await db("user_addresses")
      .where({ id, user_id: userId })
      .del();

    return res.json({ ok: true });
  } catch (err) {
    next(err);
  }
};