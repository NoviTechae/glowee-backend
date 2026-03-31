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
    return { user_id: userId, balance_aed: 0 };
  }
  return wallet;
}

// ✅ CREDIT (زيادة رصيد) — topup | gift_received | refund
async function addWalletBalance(userId, amount, note, refId = null, type = "topup", trx = knex) {
  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt <= 0) throw new Error("Invalid amount");

  await ensureWalletRow(userId, trx);

  await trx("wallets")
    .where({ user_id: userId })
    .update({
      balance_aed: trx.raw("balance_aed + ?", [amt]),
      updated_at: trx.fn.now(),
    });

  await trx("wallet_transactions").insert({
    user_id: userId,
    type, // must be in enum: topup | gift_received | refund | ...
    amount_aed: amt, // ✅ keep positive
    note,
    ref_id: refId,
    created_at: trx.fn.now(),
  });
}

// ✅ DEBIT (خصم) — spent | gift_sent
async function spendWalletBalance(userId, amount, note, refId = null, type = "spent", trx = knex) {
  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt <= 0) throw new Error("Invalid amount");

  const w = await ensureWalletRow(userId, trx);
  const cur = Number(w?.balance_aed ?? 0);
  if (cur < amt) throw new Error("Insufficient balance");

  await trx("wallets")
    .where({ user_id: userId })
    .update({
      balance_aed: trx.raw("balance_aed - ?", [amt]),
      updated_at: trx.fn.now(),
    });

  await trx("wallet_transactions").insert({
    user_id: userId,
    type, // spent | gift_sent
    amount_aed: amt, // ✅ keep positive
    note,
    ref_id: refId,
    created_at: trx.fn.now(),
  });
}

// ✅ GET /wallet/summary
async function getWalletSummary(req, res) {
  try {
    const userId = req.user?.sub; // ✅ FIX
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const wallet = await ensureWalletRow(userId);

    const txRows = await knex("wallet_transactions")
      .where({ user_id: userId })
      .orderBy("created_at", "desc")
      .limit(50)
      .select("id", "type", "amount_aed", "note", "ref_id", "created_at");

    const tx = txRows.map((t) => ({
      id: t.id,
      type: t.type,
      amount: Number(t.amount_aed ?? 0),
      created_at: t.created_at, // ✅ خلّيه ISO (أفضل للفرونت)
      note: t.note ?? null,
      refId: t.ref_id ?? null,
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
    const userId = req.user?.sub; // ✅ FIX
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    await ensureWalletRow(userId);

    const page = Math.max(1, parseInt(String(req.query.page || "1"), 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit || "20"), 10) || 20));
    const offset = (page - 1) * limit;

    const rows = await knex("wallet_transactions")
      .where({ user_id: userId })
      .orderBy("created_at", "desc")
      .limit(limit)
      .offset(offset)
      .select("id", "type", "amount_aed", "note", "ref_id", "created_at");

    const totalRow = await knex("wallet_transactions").where({ user_id: userId }).count("* as c").first();
    const total = Number(totalRow?.c ?? 0);

    const data = rows.map((t) => ({
      id: t.id,
      type: t.type,
      amount: Number(t.amount_aed ?? 0),
      created_at: t.created_at,
      note: t.note ?? null,
      refId: t.ref_id ?? null,
    }));

    return res.json({ ok: true, page, limit, total, data });
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