// src/utils/bookingHold.js
// Which bookings take up a time slot.
//
// A confirmed booking always holds its slot.
// A pending (unpaid) booking holds it only for a short time while the
// customer is on the payment step. After that the slot is free again.

const PAYMENT_HOLD_MINUTES = 15;

// Use inside a knex query where the bookings table is aliased as "b".
function whereBookingHoldsSlot(qb, db) {
  qb.where(function () {
    this.where("b.status", "confirmed").orWhere(function () {
      this.where("b.status", "pending").andWhere(
        "b.created_at",
        ">",
        db.raw(`now() - interval '${PAYMENT_HOLD_MINUTES} minutes'`)
      );
    });
  });
}

// True if another booking now holds any staff time this booking needs.
// Used before taking or confirming a payment for an older unpaid booking.
async function hasSlotConflict(bookingId, trx) {
  const result = await trx.raw(
    `
    SELECT 1
    FROM booking_item_assignments mine
    JOIN booking_item_assignments other
      ON other.staff_id = mine.staff_id
     AND other.booking_id <> mine.booking_id
     AND other.starts_at < mine.ends_at
     AND other.ends_at > mine.starts_at
    JOIN bookings b ON b.id = other.booking_id
    WHERE mine.booking_id = ?
      AND (
        b.status = 'confirmed'
        OR (b.status = 'pending'
            AND b.created_at > now() - interval '${PAYMENT_HOLD_MINUTES} minutes')
      )
    LIMIT 1
    `,
    [bookingId]
  );
  return (result.rows || []).length > 0;
}

module.exports = { PAYMENT_HOLD_MINUTES, whereBookingHoldsSlot, hasSlotConflict };