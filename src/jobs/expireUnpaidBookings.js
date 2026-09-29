// src/jobs/expireUnpaidBookings.js
// Every few minutes: cancels bookings that were never paid, frees their slot,
// and gives back any wallet money taken for a split payment that was never finished.

const db = require("../db/knex");
const ziina = require("../services/ziina");
const { addWalletBalance } = require("../controllers/walletController");

// Longer than the 15-minute slot hold, so someone still on the Ziina page
// isn't cancelled while paying.
const EXPIRE_AFTER_MINUTES = 30;
const RUN_EVERY_MINUTES = 5;

async function expireOne(bookingId) {
  // 1) If a card payment actually went through, confirm instead of cancelling.
  const pendingCard = await db("payment_transactions")
    .where({
      booking_id: bookingId,
      type: "booking_payment",
      provider: "ziina",
      status: "pending",
    })
    .whereNotNull("provider_payment_id")
    .select(["provider_payment_id"]);

  for (const p of pendingCard) {
    const status = await ziina.getPaymentIntentStatus(p.provider_payment_id);
    if (!status.ok) return "skipped_ziina_unreachable";

    if (String(status.status || "").toLowerCase() === "completed") {
      await ziina.handlePaymentIntentSuccess(p.provider_payment_id, status.raw);
      return "paid";
    }
  }

  // 2) Otherwise cancel it and return any wallet portion.
  return db.transaction(async (trx) => {
    await trx.raw("SELECT pg_advisory_xact_lock(hashtext(?))", [
      `booking-payment:${bookingId}`,
    ]);

    const booking = await trx("bookings").where({ id: bookingId }).forUpdate().first();
    if (!booking || booking.status !== "pending") return "skipped";

    const paidRows = await trx("payment_transactions")
      .where({ booking_id: bookingId, type: "booking_payment", status: "succeeded" })
      .forUpdate()
      .select(["id", "provider", "amount_aed"]);

    // A succeeded card payment on a pending booking shouldn't happen. Leave it for a person.
    if (paidRows.some((p) => p.provider !== "wallet")) {
      console.warn("expireUnpaidBookings: pending booking has a card payment", bookingId);
      return "needs_review";
    }

    const walletRows = paidRows.filter((p) => Number(p.amount_aed) > 0);
    const walletAmount = Number(
      walletRows.reduce((s, p) => s + Number(p.amount_aed), 0).toFixed(2)
    );

    if (walletAmount > 0) {
      await addWalletBalance(
        booking.user_id,
        walletAmount,
        `Refund - unpaid booking expired #${bookingId}`,
        bookingId,
        "refund",
        trx
      );

      await trx("payment_transactions")
        .whereIn(
          "id",
          walletRows.map((p) => p.id)
        )
        .update({
          status: "refunded",
          refunded_at: trx.fn.now(),
          updated_at: trx.fn.now(),
          metadata: trx.raw(`COALESCE(metadata, '{}'::jsonb) || ?::jsonb`, [
            JSON.stringify({ wallet_refunded: true, refund_reason: "booking_expired" }),
          ]),
        });
    }

    await trx("payment_transactions")
      .where({ booking_id: bookingId, type: "booking_payment", status: "pending" })
      .update({ status: "cancelled", updated_at: trx.fn.now() });

    await trx("bookings")
      .where({ id: bookingId })
      .update({ status: "cancelled", updated_at: trx.fn.now() });

    return walletAmount > 0 ? "expired_wallet_refunded" : "expired";
  });
}

async function runOnce() {
  const rows = await db("bookings")
    .where({ status: "pending" })
    .whereRaw(`created_at < now() - interval '${EXPIRE_AFTER_MINUTES} minutes'`)
    .orderBy("created_at", "asc")
    .limit(50)
    .select(["id"]);

  for (const { id } of rows) {
    try {
      const result = await expireOne(id);
      console.log("expireUnpaidBookings:", id, result);
    } catch (e) {
      console.error("expireUnpaidBookings failed for", id, e?.message || e);
    }
  }
}

let running = false;

function startExpireUnpaidBookingsJob() {
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await runOnce();
    } catch (e) {
      console.error("expireUnpaidBookings run failed:", e?.message || e);
    } finally {
      running = false;
    }
  };

  setTimeout(tick, 30 * 1000);
  setInterval(tick, RUN_EVERY_MINUTES * 60 * 1000);
}

module.exports = { startExpireUnpaidBookingsJob, runOnce };