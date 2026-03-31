const { addWalletBalance } = require("./walletController");
const { addPoints } = require("./rewardController");

async function topupWallet(req, res) {
  try {
    const userId = req.user.sub;
    const amount = Number(req.body?.amount_aed);

    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ error: "Invalid amount" });
    }

    await knex.transaction(async (trx) => {
      await addWalletBalance(userId, amount, "Wallet topup", null, "topup", trx);

      // ✅ Reward: topup 100+
      if (amount >= 100) {
        await addPoints(userId, 20, "wallet_topup", null, trx);
      }
    });

    return res.json({ ok: true });
  } catch (e) {
    console.log(e);
    return res.status(500).json({ error: "Internal server error" });
  }
}

module.exports = { topupWallet };