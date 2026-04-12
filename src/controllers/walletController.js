// src/controllers/walletController.js
const knex = require("../db/knex");

// ✅ utility: ensure wallet row exists (supports trx)
async function ensureWalletRow(userId, trx = knex) {
  const wallet = await trx("wallets").where({ user_id: userId }).first();

  if (!wallet) {
    await trx("wallets").insert({
      user_id: userId,
      balance_aed: 0,
      updated_at: trx.fn.now(),
    });

    return {
      user_id: userId,
      balance_aed: 0,
    };
  }

  return wallet;
}

// ✅ CREDIT (increase balance) — topup | gift_received | refund
async function addWalletBalance(
  userId,
  amount,
  note,
  refId = null,
  type = "topup",
  trx = knex
) {
  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt <= 0) {
    throw new Error("Invalid amount");
  }

  const wallet = await ensureWalletRow(userId, trx);
  const currentBalance = Number(wallet?.balance_aed ?? 0);
  const nextBalance = currentBalance + amt;

  await trx("wallets")
    .where({ user_id: userId })
    .update({
      balance_aed: nextBalance,
      updated_at: trx.fn.now(),
    });

  await trx("wallet_transactions").insert({
    user_id: userId,
    type,
    amount_aed: amt,
    balance_after_aed: nextBalance,

    // keep compatibility with both old and new columns
    note: note || null,
    description: note || null,
    ref_id: refId || null,
    reference_id: refId || null,

    created_at: trx.fn.now(),
  });

  return {
    ok: true,
    balance_after_aed: nextBalance,
  };
}

// ✅ DEBIT (decrease balance) — spent | gift_sent
async function spendWalletBalance(
  userId,
  amount,
  note,
  refId = null,
  type = "spent",
  trx = knex
) {
  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt <= 0) {
    throw new Error("Invalid amount");
  }

  const wallet = await ensureWalletRow(userId, trx);
  const currentBalance = Number(wallet?.balance_aed ?? 0);

  if (currentBalance < amt) {
    throw new Error("Insufficient balance");
  }

  const nextBalance = currentBalance - amt;

  await trx("wallets")
    .where({ user_id: userId })
    .update({
      balance_aed: nextBalance,
      updated_at: trx.fn.now(),
    });

  await trx("wallet_transactions").insert({
    user_id: userId,
    type,
    amount_aed: amt,
    balance_after_aed: nextBalance,

    // keep compatibility with both old and new columns
    note: note || null,
    description: note || null,
    ref_id: refId || null,
    reference_id: refId || null,

    created_at: trx.fn.now(),
  });

  return {
    ok: true,
    balance_after_aed: nextBalance,
  };
}

// ✅ GET /wallet/summary
async function getWalletSummary(req, res) {
  try {
    const userId = req.user?.sub;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const wallet = await ensureWalletRow(userId);

    const txRows = await knex("wallet_transactions")
      .where({ user_id: userId })
      .orderBy("created_at", "desc")
      .limit(50)
      .select([
        "id",
        "type",
        "amount_aed",
        "balance_after_aed",
        "note",
        "description",
        "ref_id",
        "reference_id",
        "created_at",
      ]);

    const tx = txRows.map((t) => ({
      id: t.id,
      type: t.type,
      amount: Number(t.amount_aed ?? 0),
      balance_after_aed:
        t.balance_after_aed != null ? Number(t.balance_after_aed) : null,
      created_at: t.created_at,
      note: t.note ?? t.description ?? null,
      refId: t.ref_id ?? t.reference_id ?? null,
    }));

    return res.json({
      ok: true,
      balance: Number(wallet.balance_aed ?? 0),
      stamps: [],
      tx,
    });
  } catch (e) {
    console.log("getWalletSummary error:", e);
    return res.status(500).json({ error: "Internal server error" });
  }
}

// ✅ GET /wallet/history?page=1&limit=20
async function getWalletHistory(req, res) {
  try {
    const userId = req.user?.sub;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    await ensureWalletRow(userId);

    const page = Math.max(
      1,
      parseInt(String(req.query.page || "1"), 10) || 1
    );
    const limit = Math.min(
      100,
      Math.max(1, parseInt(String(req.query.limit || "20"), 10) || 20)
    );
    const offset = (page - 1) * limit;

    const rows = await knex("wallet_transactions")
      .where({ user_id: userId })
      .orderBy("created_at", "desc")
      .limit(limit)
      .offset(offset)
      .select([
        "id",
        "type",
        "amount_aed",
        "balance_after_aed",
        "note",
        "description",
        "ref_id",
        "reference_id",
        "created_at",
      ]);

    const totalRow = await knex("wallet_transactions")
      .where({ user_id: userId })
      .count("* as c")
      .first();

    const total = Number(totalRow?.c ?? 0);

    const data = rows.map((t) => ({
      id: t.id,
      type: t.type,
      amount: Number(t.amount_aed ?? 0),
      balance_after_aed:
        t.balance_after_aed != null ? Number(t.balance_after_aed) : null,
      created_at: t.created_at,
      note: t.note ?? t.description ?? null,
      refId: t.ref_id ?? t.reference_id ?? null,
    }));

    return res.json({
      ok: true,
      page,
      limit,
      total,
      data,
    });
  } catch (e) {
    console.log("getWalletHistory error:", e);
    return res.status(500).json({ error: "Internal server error" });
  }
}

module.exports = {
  ensureWalletRow,
  addWalletBalance,
  spendWalletBalance,
  getWalletSummary,
  getWalletHistory,
};