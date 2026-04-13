// src/controllers/giftController.js
const knex = require("../db/knex");
const { v4: uuidv4 } = require("uuid");
const { spendWalletBalance } = require("./walletController");
const { addPoints } = require("./rewardController");
const { sendGiftNotification } = require("../services/whatsapp");
const { notifyGiftReceived } = require("../utils/notifications");

// helper: map DB status -> app status tabs
function mapGiftStatus(dbStatus) {
  if (dbStatus === "redeemed") return "redeemed";
  return "received";
}

// ✅ GET /gifts/received-cards
exports.getReceivedCards = async (req, res, next) => {
  try {
    const userPhone = req.user.phone;

    const rows = await knex("gifts as g")
      .leftJoin("salons as s", "s.id", "g.salon_id")
      .leftJoin("gift_themes as gt", knex.raw('gt.id::text'), 'g.theme_id')
      .where("g.recipient_phone", userPhone)
        .andWhere("g.status", "confirmed")
      .select([
        "g.id",
        "g.theme_id",
        "g.sender_name",
        "g.message",
        "g.status",
        "g.created_at",
        "g.expires_at",
        "g.redeemed_at",
        "g.salon_id",
        "g.amount_aed",
        "gt.title as theme_title",
        "gt.front_image_url as image_url",
        "gt.front_image_url",
        "gt.back_image_url",
        knex.raw("COALESCE(s.name, 'Glowee') as merchant_name"),
        knex.raw("CASE WHEN g.salon_id IS NULL THEN 'gift_card' ELSE 'service' END as type"),
      ])
      .orderBy("g.created_at", "desc");

    const giftIds = rows.map((r) => r.id);
    let itemsCounts = {};

    if (giftIds.length > 0) {
      const counts = await knex("gift_items")
        .whereIn("gift_id", giftIds)
        .groupBy("gift_id")
        .select("gift_id")
        .count("* as count");

      counts.forEach((c) => {
        itemsCounts[c.gift_id] = Number(c.count);
      });
    }

    const data = rows.map((r) => ({
      id: r.id,
      theme_id: r.theme_id,
      theme_title: r.theme_title,
      image_url: r.image_url || r.front_image_url,
      front_image_url: r.front_image_url,
      back_image_url: r.back_image_url,
      merchant_name: r.merchant_name,
      type: r.type,
      items_count: itemsCounts[r.id] || 0,
      from_name: r.sender_name,
      message: r.message,
      status: mapGiftStatus(r.status),
      created_at: r.created_at,
      expires_at: r.expires_at,
      redeemed_at: r.redeemed_at,
      amount_aed: Number(r.amount_aed),
    }));

    res.json({ ok: true, data });
  } catch (err) {
    next(err);
  }
};

// ✅ GET /gifts/available
exports.getAvailableGifts = async (req, res, next) => {
  try {
    const userPhone = req.user.phone;

    const rows = await knex("gifts as g")
      .leftJoin("salons as s", "s.id", "g.salon_id")
      .where("g.recipient_phone", userPhone)
      .andWhere("g.status", "active")
      .andWhere("g.expires_at", ">", knex.fn.now())
      .select([
        "g.id",
        "g.theme_id",
        "g.sender_name",
        "g.message",
        "g.status",
        "g.created_at",
        "g.expires_at",
        "g.salon_id",
        "g.amount_aed",
        knex.raw("COALESCE(s.name, 'Glowee') as merchant_name"),
        knex.raw("CASE WHEN g.salon_id IS NULL THEN 'gift_card' ELSE 'service' END as type"),
      ])
      .orderBy("g.created_at", "desc");

    const giftIds = rows.map((r) => r.id);

    let itemsByGiftId = {};

    if (giftIds.length > 0) {
      const items = await knex("gift_items")
        .whereIn("gift_id", giftIds)
        .select([
          "gift_id",
          "service_name",
          "qty",
          "unit_price_aed",
          //"service_image_url", // إذا ضفتيه لاحقاً
        ]);

      items.forEach((item) => {
        if (!itemsByGiftId[item.gift_id]) itemsByGiftId[item.gift_id] = [];
        itemsByGiftId[item.gift_id].push(item);
      });
    }

    const data = rows.map((r) => {
      const items = itemsByGiftId[r.id] || [];
      const firstItem = items[0] || null;

      return {
        id: r.id,
        theme_id: r.theme_id,
        merchant_name: r.merchant_name,
        type: r.type,
        items_count: items.length,
        from_name: r.sender_name,
        message: r.message,
        status: "received",
        created_at: r.created_at,
        expires_at: r.expires_at,
        amount_aed: Number(r.amount_aed),

        preview_title:
          r.type === "gift_card"
            ? `${Number(r.amount_aed).toFixed(2)} AED`
            : firstItem?.service_name || "Service Gift",

        preview_subtitle:
          r.type === "gift_card"
            ? "Wallet Gift"
            : r.merchant_name,

        preview_image_url:
          null, // أو firstItem?.service_image_url || null إذا أضفتيه

        preview_type:
          r.type === "gift_card" ? "wallet" : "service",
      };
    });

    res.json({ ok: true, data });
  } catch (err) {
    next(err);
  }
};

// ✅ GET /gifts/sent?tab=received|redeemed
exports.getSentGifts = async (req, res, next) => {
  try {
    const userId = req.user.sub || req.user.id;
    const tab = String(req.query.tab || "received");
    const statusFilter = tab === "redeemed" ? "redeemed" : "active";

    const rows = await knex("gifts as g")
      .leftJoin("salons as s", "s.id", "g.salon_id")
      .leftJoin("gift_themes as gt", knex.raw('gt.id::text'), 'g.theme_id')
      .where("g.sender_user_id", userId)
      .andWhere("g.status", statusFilter)
      .select([
        "g.id",
        "g.theme_id",
        "g.sender_name",
        "g.message",
        "g.status",
        "g.created_at",
        "g.expires_at",
        "g.redeemed_at",
        "g.salon_id",
        "g.amount_aed",
        "gt.title as theme_title",
        "gt.front_image_url as image_url",
        "gt.front_image_url",
        "gt.back_image_url",
        knex.raw("COALESCE(s.name, 'Glowee') as merchant_name"),
        knex.raw("CASE WHEN g.salon_id IS NULL THEN 'gift_card' ELSE 'service' END as type"),
      ])
      .orderBy("g.created_at", "desc");

    const giftIds = rows.map((r) => r.id);
    let itemsCounts = {};

    if (giftIds.length > 0) {
      const counts = await knex("gift_items")
        .whereIn("gift_id", giftIds)
        .groupBy("gift_id")
        .select("gift_id")
        .count("* as count");

      counts.forEach((c) => {
        itemsCounts[c.gift_id] = Number(c.count);
      });
    }

    const data = rows.map((r) => ({
      id: r.id,
      theme_id: r.theme_id,
      theme_title: r.theme_title,
      image_url: r.image_url || r.front_image_url,
      front_image_url: r.front_image_url,
      back_image_url: r.back_image_url,
      merchant_name: r.merchant_name,
      type: r.type,
      items_count: itemsCounts[r.id] || 0,
      from_name: r.sender_name || "You",
      message: r.message,
      status: mapGiftStatus(r.status),
      created_at: r.created_at,
      expires_at: r.expires_at,
      redeemed_at: r.redeemed_at,
      amount_aed: Number(r.amount_aed),
    }));

    res.json({ ok: true, data });
  } catch (err) {
    next(err);
  }
};

// ✅ GET /gifts/:id
exports.getGiftById = async (req, res, next) => {
  try {
    const userId = req.user.sub || req.user.id;
    const { id } = req.params;

    const row = await knex("gifts as g")
      .leftJoin("salons as s", "s.id", "g.salon_id")
      .leftJoin("gift_themes as gt", knex.raw('gt.id::text'), 'g.theme_id')
      .where("g.id", id)
      .first([
        "g.id",
        "g.theme_id",
        "g.sender_user_id",
        "g.recipient_phone",
        "g.sender_name",
        "g.message",
        "g.status",
        "g.created_at",
        "g.expires_at",
        "g.redeemed_at",
        "g.salon_id",
        "g.amount_aed",
        "g.code",
        "gt.title as theme_title",
        "gt.front_image_url as image_url",
        "gt.front_image_url",
        "gt.back_image_url",
        knex.raw("COALESCE(s.name, 'Glowee') as merchant_name"),
        knex.raw("CASE WHEN g.salon_id IS NULL THEN 'gift_card' ELSE 'service' END as type"),
      ]);

    if (!row) return res.status(404).json({ error: "Gift not found" });

    const isSender = String(row.sender_user_id) === String(userId);
    const isRecipient = String(row.recipient_phone) === String(req.user.phone);

    if (!isSender && !isRecipient) {
      return res.status(403).json({ error: "Not allowed" });
    }

    const items = await knex("gift_items as gi")
      .leftJoin("service_availability as sa", "sa.id", "gi.service_availability_id")
      .where("gi.gift_id", id)
      .select([
        "gi.id",
        "gi.service_availability_id",
        "gi.service_name",
        "gi.qty",
        "gi.unit_price_aed",
        "gi.line_total_aed",
        "gi.duration_mins",
        "sa.mode as booking_mode",
        "sa.branch_id",
      ]);

    res.json({
      ok: true,
      data: {
        id: row.id,
        theme_id: row.theme_id,
        theme_title: row.theme_title,
        image_url: row.image_url || row.front_image_url,
        front_image_url: row.front_image_url,
        back_image_url: row.back_image_url,
        merchant_name: row.merchant_name,
        salon_id: row.salon_id,
        type: row.type,
        booking_mode: items[0]?.booking_mode || null,
        items_count: items.length,
        items: items.map((it) => ({
          id: it.id,
          service_availability_id: it.service_availability_id,
          service_name: it.service_name,
          qty: Number(it.qty),
          unit_price_aed: Number(it.unit_price_aed),
          line_total_aed: Number(it.line_total_aed),
          duration_mins: Number(it.duration_mins),
          booking_mode: it.booking_mode || null,
          branch_id: it.branch_id || null,
        })),
        from_name: row.sender_name,
        message: row.message,
        status: mapGiftStatus(row.status),
        created_at: row.created_at,
        expires_at: row.expires_at,
        redeemed_at: row.redeemed_at,
        amount_aed: Number(row.amount_aed),
        code: row.code,
      },
    });
  } catch (err) {
    next(err);
  }
};

// ✅ POST /gifts/send
exports.sendGift = async (req, res, next) => {
  const trx = await knex.transaction();

  try {
    const userId = req.user.sub || req.user.id;

    const {
      recipient_phone,
      receivers,
      salon_id,
      salonId,
      amount_aed,
      amount,
      service_items,
      serviceItems,
      message,
      theme_id,
      themeId,
      sender_name,
      fromName,
    } = req.body;

    // ✅ support both old and new frontend payloads
    const finalAmount = Number(amount_aed ?? amount ?? 0);
    const finalSalonId = salon_id ?? salonId ?? null;
    const finalThemeId = theme_id ?? themeId ?? null;
    const finalSenderName = sender_name ?? fromName ?? null;
    const finalServiceItems = Array.isArray(service_items)
      ? service_items
      : Array.isArray(serviceItems)
        ? serviceItems
        : [];

    // support single phone or receivers array
    let finalReceivers = [];

    if (Array.isArray(receivers) && receivers.length > 0) {
      finalReceivers = receivers
        .map((r) => ({
          name: r?.name || null,
          phone: r?.phone || null,
        }))
        .filter((r) => !!r.phone);
    } else if (recipient_phone) {
      finalReceivers = [{ name: null, phone: recipient_phone }];
    }

    if (!finalAmount || finalAmount <= 0) {
      await trx.rollback();
      return res.status(400).json({ error: "Invalid amount" });
    }

    if (!finalReceivers.length) {
      await trx.rollback();
      return res.status(400).json({ error: "Recipient phone is required" });
    }

    // ✅ check wallet once
    const wallet = await trx("wallets").where({ user_id: userId }).first();
    if (!wallet || Number(wallet.balance_aed) < finalAmount) {
      await trx.rollback();
      return res.status(400).json({ error: "رصيدك غير كافي لإرسال هذه الهدية" });
    }

    const createdGifts = [];

    for (const receiver of finalReceivers) {
      const code = uuidv4().replace(/-/g, "").slice(0, 12).toUpperCase();
      const expires_at = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);

      const [gift] = await trx("gifts")
        .insert({
          sender_user_id: userId,
          recipient_phone: receiver.phone,
          salon_id: finalSalonId,
          amount_aed: finalAmount,
          code,
          expires_at,
          message: message || null,
          theme_id: finalThemeId,
          sender_name: finalSenderName,
          status: "active",
          created_at: trx.fn.now(),
        })
        .returning("*");

      if (Array.isArray(finalServiceItems) && finalServiceItems.length > 0) {
        for (const item of finalServiceItems) {
          const qty = Number(item.qty || 1);
          const unitPrice = Number(item.unit_price_aed || item.price_aed || 0);

          await trx("gift_items").insert({
            gift_id: gift.id,
            service_availability_id: item.availability_id,
            service_name: item.service_name || "Service",
            qty,
            unit_price_aed: unitPrice,
            line_total_aed: unitPrice * qty,
            duration_mins: Number(item.duration_mins || 0),
            created_at: trx.fn.now(),
          });
        }
      }

      createdGifts.push({
        ...gift,
        code,
        recipient_phone: receiver.phone,
        expires_at,
      });
    }

    // ✅ deduct wallet once from sender
    await spendWalletBalance(
      userId,
      finalAmount,
      `هدية إلى ${finalReceivers.map((r) => r.phone).join(", ")}`,
      createdGifts[0].id,
      "gift_sent",
      trx
    );

    // 🎁 Reward
    await addPoints(userId, 10, "gift_sent", createdGifts[0].id, trx);

    await trx.commit();

    // notifications async
    for (const gift of createdGifts) {
      setImmediate(async () => {
        try {
          const receiver = await knex("users")
            .where({ phone: gift.recipient_phone })
            .first("id");

          if (receiver) {
            await notifyGiftReceived(
              receiver.id,
              gift.id,
              finalSenderName || "Someone special",
              Number(finalAmount)
            );
            console.log(`✅ Push notification sent to ${gift.recipient_phone}`);
          } else {
            console.log(`⚠️ No user found with phone ${gift.recipient_phone}`);
          }
        } catch (e) {
          console.error("Push notification failed (non-blocking):", e.message);
        }
      });

      setImmediate(async () => {
        try {
          await sendGiftNotification(gift.recipient_phone, {
            code: gift.code,
            senderName: finalSenderName || "Someone special",
            giftType: finalSalonId ? "service" : "wallet",
            merchantName: salonName || null,

            themeEmoji:
              finalThemeId === "birthday"
                ? "🎂"
                : finalThemeId === "wedding"
                  ? "💍"
                  : finalThemeId === "anniversary"
                    ? "💐"
                    : "🎁",
          });
        } catch (e) {
          console.error("WhatsApp send failed (non-blocking):", e.message);
        }
      });
    }

    res.json({
      ok: true,
      gifts: createdGifts.map((gift) => ({
        id: gift.id,
        code: gift.code,
        amount_aed: Number(finalAmount),
        recipient_phone: gift.recipient_phone,
        expires_at: gift.expires_at,
        items_count: finalServiceItems?.length || 0,
      })),
      gift: {
        id: createdGifts[0].id,
        code: createdGifts[0].code,
        amount_aed: Number(finalAmount),
        recipient_phone: createdGifts[0].recipient_phone,
        expires_at: createdGifts[0].expires_at,
        items_count: finalServiceItems?.length || 0,
      },
    });
  } catch (err) {
    await trx.rollback();
    next(err);
  }
};

// ✅ POST /gifts/:id/redeem
exports.redeemGift = async (req, res, next) => {
  try {
    const { id } = req.params;

    const gift = await knex("gifts").where({ id }).first();
    if (!gift) {
      return res.status(404).json({ error: "Gift not found" });
    }

    if (String(gift.recipient_phone) !== String(req.user.phone)) {
      return res.status(403).json({ error: "Not allowed" });
    }

    if (gift.status !== "active") {
      return res.status(400).json({ error: "Gift not usable" });
    }

    if (new Date(gift.expires_at) <= new Date()) {
      return res.status(400).json({ error: "Gift expired" });
    }

    await knex("gifts").where({ id }).update({
      status: "redeemed",
      redeemed_at: knex.fn.now(),
    });

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
};

// ✅ POST /gifts/:id/convert-to-wallet
exports.convertGiftToWallet = async (req, res, next) => {
  const trx = await knex.transaction();

  try {
    const { id } = req.params;
    const userId = req.user.sub || req.user.id;
    const userPhone = req.user.phone;

    const gift = await trx("gifts").where({ id }).first();

    if (!gift) {
      await trx.rollback();
      return res.status(404).json({ error: "Gift not found" });
    }

    if (String(gift.recipient_phone) !== String(userPhone)) {
      await trx.rollback();
      return res.status(403).json({ error: "Not allowed" });
    }

    if (gift.status !== "active") {
      await trx.rollback();
      return res.status(400).json({ error: "Gift not usable" });
    }

    if (gift.expires_at && new Date(gift.expires_at) <= new Date()) {
      await trx.rollback();
      return res.status(400).json({ error: "Gift expired" });
    }

    const amountToConvert = Number(gift.amount_aed || 0);

    if (!Number.isFinite(amountToConvert) || amountToConvert <= 0) {
      await trx.rollback();
      return res.status(400).json({ error: "Invalid gift amount" });
    }

    const { addWalletBalance, ensureWalletRow } = require("./walletController");

    await ensureWalletRow(userId, trx);

    await addWalletBalance(
      userId,
      amountToConvert,
      "Gift converted to wallet",
      gift.id,
      "gift_received",
      trx
    );

    const updatedWallet = await trx("wallets")
      .where({ user_id: userId })
      .first();

    await trx("gifts")
      .where({ id })
      .update({
        status: "redeemed",
        redeemed_at: trx.fn.now(),
      });

    await trx.commit();

    return res.json({
      ok: true,
      message: "Gift converted to wallet successfully",
      amount_added: amountToConvert,
      new_balance: Number(updatedWallet?.balance_aed || 0),
    });
  } catch (err) {
    await trx.rollback();
    next(err);
  }
};

// ✅ POST /gifts/:id/seen
exports.markGiftSeen = async (req, res, next) => {
  const trx = await knex.transaction();
  try {
    const { id } = req.params;

    const gift = await trx("gifts").where({ id }).first();
    if (!gift) {
      await trx.rollback();
      return res.status(404).json({ error: "Gift not found" });
    }

    if (String(gift.recipient_phone) !== String(req.user.phone)) {
      await trx.rollback();
      return res.status(403).json({ error: "Not allowed" });
    }

    if (gift.seen_at && gift.sender_seen_rewarded) {
      await trx.commit();
      return res.json({ ok: true, already: true });
    }

    await trx("gifts").where({ id }).update({
      seen_at: trx.fn.now(),
    });

    const SEEN_POINTS = 10;

    if (!gift.sender_seen_rewarded && gift.sender_user_id) {
      await addPoints(gift.sender_user_id, SEEN_POINTS, "gift_opened", gift.id, trx);

      await trx("gifts").where({ id }).update({
        sender_seen_rewarded: true,
      });
    }

    await trx.commit();
    return res.json({ ok: true });
  } catch (err) {
    await trx.rollback();
    next(err);
  }
};