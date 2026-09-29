// src/utils/salonType.js
// The salon's type always follows its branches. Call after any branch change.

async function syncSalonType(salonId, trx) {
  const row = await trx("branches")
    .where({ salon_id: salonId })
    .select(
      trx.raw("bool_or(offers_in_salon) AS has_in"),
      trx.raw("bool_or(supports_home_services) AS has_home")
    )
    .first();

  // No branches yet: leave the type the admin picked when creating the salon.
  if (!row || (row.has_in === null && row.has_home === null)) return null;

  const type =
    row.has_in && row.has_home ? "both" : row.has_home ? "home" : "in_salon";

  await trx("salons")
    .where({ id: salonId })
    .update({ salon_type: type, updated_at: trx.fn.now() });

  return type;
}

module.exports = { syncSalonType };