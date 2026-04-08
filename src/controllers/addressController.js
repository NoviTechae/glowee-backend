// src/controllers/addressController.js

const db = require("../db/knex");

function toNum(v) {
  const n = typeof v === "string" ? Number(v) : v;
  return Number.isFinite(n) ? n : null;
}

async function listMyAddresses(req, res, next) {
  try {
    const userId = req.user.sub;

    const rows = await db("user_addresses")
      .where({ user_id: userId })
      .orderBy("is_default", "desc")
      .orderBy("created_at", "desc")
      .select([
        "id",
        "label",
        "city",
        "area",
        "address_line",
        "lat",
        "lng",
        "is_default",
        "created_at",
      ]);

    return res.json({
      ok: true,
      data: rows.map((r) => ({
        id: r.id,
        label: r.label,
        city: r.city,
        area: r.area,
        address_line: r.address_line,
        lat: toNum(r.lat),
        lng: toNum(r.lng),
        is_default: !!r.is_default,
        created_at: r.created_at,
      })),
    });
  } catch (error) {
    next(error);
  }
}

async function createMyAddress(req, res, next) {
  const trx = await db.transaction();

  try {
    const userId = req.user.sub;
    const {
      label,
      city,
      area,
      address_line,
      lat,
      lng,
      is_default,
    } = req.body || {};

    const latNum = toNum(lat);
    const lngNum = toNum(lng);

    if (!city || !String(city).trim()) {
      await trx.rollback();
      return res.status(400).json({ error: "city is required" });
    }

    if (!area || !String(area).trim()) {
      await trx.rollback();
      return res.status(400).json({ error: "area is required" });
    }

    if (!address_line || !String(address_line).trim()) {
      await trx.rollback();
      return res.status(400).json({ error: "address_line is required" });
    }

    if (latNum == null || lngNum == null) {
      await trx.rollback();
      return res.status(400).json({ error: "lat and lng are required" });
    }

    const makeDefault = !!is_default;

    if (makeDefault) {
      await trx("user_addresses")
        .where({ user_id: userId })
        .update({ is_default: false });
    }

    const [row] = await trx("user_addresses")
      .insert({
        user_id: userId,
        label: label ? String(label).trim() : null,
        city: String(city).trim(),
        area: String(area).trim(),
        address_line: String(address_line).trim(),
        lat: latNum,
        lng: lngNum,
        geo: trx.raw(
          "ST_SetSRID(ST_MakePoint(?, ?), 4326)::geography",
          [lngNum, latNum]
        ),
        is_default: makeDefault,
        created_at: trx.fn.now(),
      })
      .returning([
        "id",
        "label",
        "city",
        "area",
        "address_line",
        "lat",
        "lng",
        "is_default",
        "created_at",
      ]);

    await trx.commit();

    return res.json({
      ok: true,
      data: {
        id: row.id,
        label: row.label,
        city: row.city,
        area: row.area,
        address_line: row.address_line,
        lat: toNum(row.lat),
        lng: toNum(row.lng),
        is_default: !!row.is_default,
        created_at: row.created_at,
      },
    });
  } catch (error) {
    await trx.rollback();
    next(error);
  }
}

async function updateMyAddress(req, res, next) {
  const trx = await db.transaction();

  try {
    const userId = req.user.sub;
    const { id } = req.params;
    const {
      label,
      city,
      area,
      address_line,
      lat,
      lng,
      is_default,
    } = req.body || {};

    const existing = await trx("user_addresses")
      .where({ id, user_id: userId })
      .first();

    if (!existing) {
      await trx.rollback();
      return res.status(404).json({ error: "Address not found" });
    }

    const nextCity = city != null ? String(city).trim() : existing.city;
    const nextArea = area != null ? String(area).trim() : existing.area;
    const nextAddressLine =
      address_line != null ? String(address_line).trim() : existing.address_line;

    const nextLat = lat != null ? toNum(lat) : toNum(existing.lat);
    const nextLng = lng != null ? toNum(lng) : toNum(existing.lng);

    if (!nextCity) {
      await trx.rollback();
      return res.status(400).json({ error: "city is required" });
    }

    if (!nextArea) {
      await trx.rollback();
      return res.status(400).json({ error: "area is required" });
    }

    if (!nextAddressLine) {
      await trx.rollback();
      return res.status(400).json({ error: "address_line is required" });
    }

    if (nextLat == null || nextLng == null) {
      await trx.rollback();
      return res.status(400).json({ error: "lat and lng are required" });
    }

    const makeDefault =
      typeof is_default === "boolean" ? is_default : !!existing.is_default;

    if (makeDefault) {
      await trx("user_addresses")
        .where({ user_id: userId })
        .whereNot({ id })
        .update({ is_default: false });
    }

    const [row] = await trx("user_addresses")
      .where({ id, user_id: userId })
      .update({
        label: label != null ? (label ? String(label).trim() : null) : existing.label,
        city: nextCity,
        area: nextArea,
        address_line: nextAddressLine,
        lat: nextLat,
        lng: nextLng,
        geo: trx.raw(
          "ST_SetSRID(ST_MakePoint(?, ?), 4326)::geography",
          [nextLng, nextLat]
        ),
        is_default: makeDefault,
      })
      .returning([
        "id",
        "label",
        "city",
        "area",
        "address_line",
        "lat",
        "lng",
        "is_default",
        "created_at",
      ]);

    await trx.commit();

    return res.json({
      ok: true,
      data: {
        id: row.id,
        label: row.label,
        city: row.city,
        area: row.area,
        address_line: row.address_line,
        lat: toNum(row.lat),
        lng: toNum(row.lng),
        is_default: !!row.is_default,
        created_at: row.created_at,
      },
    });
  } catch (error) {
    await trx.rollback();
    next(error);
  }
}

async function deleteMyAddress(req, res, next) {
  try {
    const userId = req.user.sub;
    const { id } = req.params;

    const existing = await db("user_addresses")
      .where({ id, user_id: userId })
      .first();

    if (!existing) {
      return res.status(404).json({ error: "Address not found" });
    }

    await db("user_addresses")
      .where({ id, user_id: userId })
      .del();

    return res.json({
      ok: true,
      deleted_id: id,
    });
  } catch (error) {
    next(error);
  }
}

async function setDefaultAddress(req, res, next) {
  const trx = await db.transaction();

  try {
    const userId = req.user.sub;
    const { id } = req.params;

    const existing = await trx("user_addresses")
      .where({ id, user_id: userId })
      .first();

    if (!existing) {
      await trx.rollback();
      return res.status(404).json({ error: "Address not found" });
    }

    await trx("user_addresses")
      .where({ user_id: userId })
      .update({ is_default: false });

    await trx("user_addresses")
      .where({ id, user_id: userId })
      .update({ is_default: true });

    await trx.commit();

    return res.json({
      ok: true,
      default_address_id: id,
    });
  } catch (error) {
    await trx.rollback();
    next(error);
  }
}

module.exports = {
  listMyAddresses,
  createMyAddress,
  updateMyAddress,
  deleteMyAddress,
  setDefaultAddress,
};