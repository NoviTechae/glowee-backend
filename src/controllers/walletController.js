// src/controllers/walletController.js
const knex = require("../db/knex");
const { listUsableRewardsForUser, listUsableRewards } = require("../services/stampService");

const round2 = (n) => Math.round(Number(n) * 100) / 100;

// Make sure the user has a wallet row.
// (wallets.user_id has no unique constraint, so ON CONFLICT can't be used here.)
async function ensureWalletRow(userId, trx = knex) {
  const existing = await trx("wallets").where({ user_id: userId }).first();
  if (existing) return existing;
  const [created] = await trx("wallets")
    .insert({ user_id: userId, balance_aed: 0, updated_at: trx.fn.now() })
    .returning("*");
  return created;
}

function writeTx(trx, { userId, type, amt, balanceAfter, note, refId }) {
  return trx("wallet_transactions").insert({
    user_id: userId,
    type,
    amount_aed: amt,
    balance_after_aed: balanceAfter,
    note: note || null,
    description: note || null,
    ref_id: refId || null,
    reference_id: refId || null,
    created_at: trx.fn.now(),
  });
}

// CREDIT: topup | gift_received | refund
// The balance changes in one database statement, so two credits at the same
// moment can't overwrite each other.
async function addWalletBalance(userId, amount, note, refId = null, type = "topup", trx = knex) {
  const amt = round2(amount);
  if (!Number.isFinite(amt) || amt <= 0) throw new Error("Invalid amount");

  await ensureWalletRow(userId, trx);

  const [row] = await trx("wallets")
    .where({ user_id: userId })
    .update({ balance_aed: trx.raw("balance_aed + ?", [amt]), updated_at: trx.fn.now() })
    .returning("balance_aed");

  const balanceAfter = Number(row?.balance_aed ?? row);
  await writeTx(trx, { userId, type, amt, balanceAfter, note, refId });
  return { ok: true, balance_after_aed: balanceAfter };
}

// DEBIT: spent | gift_sent
// Only succeeds if the balance is enough at that exact moment, so the same
// money can't be spent twice by two requests at once.
async function spendWalletBalance(userId, amount, note, refId = null, type = "spent", trx = knex) {
  const amt = round2(amount);
  if (!Number.isFinite(amt) || amt <= 0) throw new Error("Invalid amount");

  await ensureWalletRow(userId, trx);

  const [row] = await trx("wallets")
    .where({ user_id: userId })
    .where("balance_aed", ">=", amt)
    .update({ balance_aed: trx.raw("balance_aed - ?", [amt]), updated_at: trx.fn.now() })
    .returning("balance_aed");

  if (!row) {
    const err = new Error("Insufficient balance");
    err.status = 400;
    err.code = "INSUFFICIENT_BALANCE";
    throw err;
  }

  const balanceAfter = Number(row?.balance_aed ?? row);
  await writeTx(trx, { userId, type, amt, balanceAfter, note, refId });
  return { ok: true, balance_after_aed: balanceAfter };
}

function mapTx(t) {
  return {
    id: t.id,
    type: t.type,
    amount: Number(t.amount_aed ?? 0),
    balance_after_aed: t.balance_after_aed != null ? Number(t.balance_after_aed) : null,
    created_at: t.created_at,
    note: t.note ?? t.description ?? null,
    refId: t.ref_id ?? t.reference_id ?? null,
  };
}

const TX_COLUMNS = ["id", "type", "amount_aed", "balance_after_aed", "note", "description", "ref_id", "reference_id", "created_at"];

// GET /wallet/summary
async function getWalletSummary(req, res) {
  try {
    const userId = req.user?.sub;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const wallet = await ensureWalletRow(userId);

    const [txRows, stampRows, rewardRows] = await Promise.all([
      knex("wallet_transactions").where({ user_id: userId }).orderBy("created_at", "desc").limit(50).select(TX_COLUMNS),
      knex("user_salon_stamp_cards as c")
        .join("salons as s", "s.id", "c.salon_id")
        .leftJoin("salon_stamp_settings as st", function () {
          this.on("st.salon_id", "c.salon_id").andOn("st.is_active", knex.raw("true"));
        })
        .where("c.user_id", userId)
        .select([
          "c.salon_id",
          "c.current_stamps",
          "c.available_rewards",
          "s.name as salon_name",
          "s.logo_url",
          "st.stamps_required",
          "st.reward_text",
          "st.stamp_images",
        ]),
      listUsableRewardsForUser(userId),
    ]);

    const rewardsBySalon = new Map();
    for (const r of rewardRows) {
      const list = rewardsBySalon.get(r.salon_id) || [];
      list.push({ id: r.id, label: r.label, expires_at: r.expires_at, kind: r.kind, service_id: r.service_id, percent: r.percent });
      rewardsBySalon.set(r.salon_id, list);
    }

    return res.json({
      ok: true,
      balance: Number(wallet?.balance_aed ?? 0),
      stamps: stampRows.map((r) => ({
        id: r.salon_id,
        salonName: r.salon_name,
        area: "",
        city: "",
        logo: r.logo_url,
        collected: Number(r.current_stamps || 0),
        total: Number(r.stamps_required || 6),
        rewardText: r.reward_text || "Reward",
        // Rewards shown at the top of the card, each as it was when earned.
        rewards: rewardsBySalon.get(r.salon_id) || [],
        availableRewards: (rewardsBySalon.get(r.salon_id) || []).length,
        stampImages: Array.isArray(r.stamp_images) ? r.stamp_images : [],
      })),
      tx: txRows.map(mapTx),
    });
  } catch (e) {
    console.error("getWalletSummary error:", e.message);
    return res.status(500).json({ error: "Internal server error" });
  }
}

// GET /wallet/history?page=1&limit=20
async function getWalletHistory(req, res) {
  try {
    const userId = req.user?.sub;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const page = Math.max(1, parseInt(String(req.query.page || "1"), 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit || "20"), 10) || 20));

    const [rows, totalRow] = await Promise.all([
      knex("wallet_transactions")
        .where({ user_id: userId })
        .orderBy("created_at", "desc")
        .limit(limit)
        .offset((page - 1) * limit)
        .select(TX_COLUMNS),
      knex("wallet_transactions").where({ user_id: userId }).count("* as c").first(),
    ]);

    return res.json({ ok: true, page, limit, total: Number(totalRow?.c ?? 0), data: rows.map(mapTx) });
  } catch (e) {
    console.error("getWalletHistory error:", e.message);
    return res.status(500).json({ error: "Internal server error" });
  }
}

// GET /wallet/stamp-rewards?salon_id=...
// Before booking: lets the app suggest adding a free service the customer has earned.
async function getSalonStampRewards(req, res) {
  try {
    const salonId = String(req.query.salon_id || "");
    if (!/^[0-9a-f-]{36}$/i.test(salonId)) return res.status(400).json({ error: "salon_id is required" });

    const rows = await listUsableRewards(req.user.sub, salonId);
    const settings = await knex("salon_stamp_settings")
      .where({ salon_id: salonId })
      .first("reward_kind", "reward_service_id", "reward_percent");

    return res.json({
      ok: true,
      data: rows.map((r) => {
        // Rewards from before reward types follow what the salon offers today.
        const kind = r.kind || settings?.reward_kind || null;
        return {
          id: r.id,
          label: r.label,
          expires_at: r.expires_at,
          kind,
          service_id: kind === "free_service" ? r.service_id || (!r.kind ? settings?.reward_service_id : null) : null,
          service_name: r.service_name || null,
          percent: kind === "percent_off" ? r.percent ?? (!r.kind ? settings?.reward_percent : null) : null,
        };
      }),
    });
  } catch (e) {
    console.error("getSalonStampRewards error:", e.message);
    return res.status(500).json({ error: "Internal server error" });
  }
}

module.exports = { getSalonStampRewards, ensureWalletRow, addWalletBalance, spendWalletBalance, getWalletSummary, getWalletHistory };