// backend/src/controllers/giftController.js
const knex = require("../db/knex");
const { v4: uuidv4 } = require("uuid");
const { spendWalletBalance } = require("./walletController");
const { addPoints } = require("./rewardController");
const { sendGiftNotification } = require("../services/whatsapp");
const { notifyGiftReceived } = require("../utils/notifications"); // ✅ NEW

// helper: map DB status -> app status tabs
function mapGiftStatus(dbStatus) {
  // gifts.status: active | redeemed | expired | cancelled
  if (dbStatus === "redeemed") return "redeemed";
  return "received"; // active/expired/cancelled تعتبر ضمن received في UI
}

// ✅ GET /gifts/received-cards
// كل الكروت اللي وصلتني سواء active/redeemed/expired/cancelled
exports.getReceivedCards = async (req, res, next) => {
  try {
    const userPhone = req.user.phone;

    const rows = await knex("gifts as g")
      .leftJoin("salons as s", "s.id", "g.salon_id")
      .where("g.recipient_phone", userPhone)
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
        knex.raw("COALESCE(s.name, 'Glowee') as merchant_name"),
        knex.raw("CASE WHEN g.salon_id IS NULL THEN 'gift_card' ELSE 'service' END as type"),
      ])
      .orderBy("g.created_at", "desc");

    // Get items count for each gift
    const giftIds = rows.map(r => r.id);
    let itemsCounts = {};
    
    if (giftIds.length > 0) {
      const counts = await knex("gift_items")
        .whereIn("gift_id", giftIds)
        .groupBy("gift_id")
        .select("gift_id")
        .count("* as count");
      
      counts.forEach(c => {
        itemsCounts[c.gift_id] = Number(c.count);
      });
    }

    const data = rows.map((r) => ({
      id: r.id,
      theme_id: r.theme_id,
      merchant_name: r.merchant_name,
      type: r.type, // service | gift_card
      items_count: itemsCounts[r.id] || 0,
      from_name: r.sender_name,
      message: r.message,
      status: mapGiftStatus(r.status), // received | redeemed
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
// الهدايا اللي اقدر استخدمها الحين (active + not expired)
// "تنتهي وتختفي من available بعد 3 شهور"
exports.getAvailableGifts = async (req, res, next) => {
  try {
    const userPhone = req.user.phone;

    const rows = await knex("gifts as g")
      .leftJoin("salons as s", "s.id", "g.salon_id")
      .where("g.recipient_phone", userPhone)
      .andWhere("g.status", "active")
      .andWhere("g.expires_at", ">", knex.fn.now()) // ✅ تختفي بعد الانتهاء
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

    // Get items count
    const giftIds = rows.map(r => r.id);
    let itemsCounts = {};
    
    if (giftIds.length > 0) {
      const counts = await knex("gift_items")
        .whereIn("gift_id", giftIds)
        .groupBy("gift_id")
        .select("gift_id")
        .count("* as count");
      
      counts.forEach(c => {
        itemsCounts[c.gift_id] = Number(c.count);
      });
    }

    const data = rows.map((r) => ({
      id: r.id,
      theme_id: r.theme_id,
      merchant_name: r.merchant_name,
      type: r.type,
      items_count: itemsCounts[r.id] || 0,
      from_name: r.sender_name,
      message: r.message,
      status: "received", // available معناها usable
      created_at: r.created_at,
      expires_at: r.expires_at,
      amount_aed: Number(r.amount_aed),
    }));

    res.json({ ok: true, data });
  } catch (err) {
    next(err);
  }
};

// ✅ GET /gifts/sent?tab=received|redeemed
// history للهدايا اللي انا ارسلتها
exports.getSentGifts = async (req, res, next) => {
  try {
    const tab = String(req.query.tab || "received"); // received | redeemed
    const statusFilter = tab === "redeemed" ? "redeemed" : "active";

    const rows = await knex("gifts as g")
      .leftJoin("salons as s", "s.id", "g.salon_id")
      .where("g.sender_user_id", req.user.sub)
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
        knex.raw("COALESCE(s.name, 'Glowee') as merchant_name"),
        knex.raw("CASE WHEN g.salon_id IS NULL THEN 'gift_card' ELSE 'service' END as type"),
      ])
      .orderBy("g.created_at", "desc");

    // Get items count
    const giftIds = rows.map(r => r.id);
    let itemsCounts = {};
    
    if (giftIds.length > 0) {
      const counts = await knex("gift_items")
        .whereIn("gift_id", giftIds)
        .groupBy("gift_id")
        .select("gift_id")
        .count("* as count");
      
      counts.forEach(c => {
        itemsCounts[c.gift_id] = Number(c.count);
      });
    }

    const data = rows.map((r) => ({
      id: r.id,
      theme_id: r.theme_id,
      merchant_name: r.merchant_name,
      type: r.type,
      items_count: itemsCounts[r.id] || 0,
      from_name: r.sender_name || "You",
      message: r.message,
      status: mapGiftStatus(r.status), // received | redeemed
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

// ✅ GET /gifts/:id  (تفاصيل هدية)
exports.getGiftById = async (req, res, next) => {
  try {
    const { id } = req.params;

    const row = await knex("gifts as g")
      .leftJoin("salons as s", "s.id", "g.salon_id")
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
        knex.raw("COALESCE(s.name, 'Glowee') as merchant_name"),
        knex.raw("CASE WHEN g.salon_id IS NULL THEN 'gift_card' ELSE 'service' END as type"),
      ]);

    if (!row) return res.status(404).json({ error: "Gift not found" });

    const isSender = String(row.sender_user_id) === String(req.user.sub);
    const isRecipient = String(row.recipient_phone) === String(req.user.phone);
    if (!isSender && !isRecipient) {
      return res.status(403).json({ error: "Not allowed" });
    }

    // Get gift items if any
    const items = await knex("gift_items")
      .where({ gift_id: id })
      .select([
        "id",
        "service_availability_id",
        "service_name",
        "qty",
        "unit_price_aed",
        "line_total_aed",
        "duration_mins",
      ]);

    res.json({
      ok: true,
      data: {
        id: row.id,
        theme_id: row.theme_id,
        merchant_name: row.merchant_name,
        type: row.type,
        items_count: items.length,
        items: items.map(it => ({
          id: it.id,
          service_availability_id: it.service_availability_id,
          service_name: it.service_name,
          qty: Number(it.qty),
          unit_price_aed: Number(it.unit_price_aed),
          line_total_aed: Number(it.line_total_aed),
          duration_mins: Number(it.duration_mins),
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
    const {
      recipient_phone,
      salon_id,
      amount_aed,
      service_items, // Array of { availability_id, qty, service_name, unit_price_aed, duration_mins }
      message,
      theme_id,
      sender_name,
    } = req.body;

    // ✅ check wallet
    const wallet = await trx("wallets").where({ user_id: req.user.sub }).first();
    if (!wallet || Number(wallet.balance_aed) < Number(amount_aed)) {
      await trx.rollback();
      return res.status(400).json({ error: "رصيدك غير كافي لإرسال هذه الهدية" });
    }

    const code = uuidv4().replace(/-/g, "").slice(0, 12).toUpperCase();

    // ✅ 3 months expiry
    const expires_at = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);

    const [gift] = await trx("gifts")
      .insert({
        sender_user_id: req.user.sub,
        recipient_phone,
        salon_id: salon_id || null,
        amount_aed,
        code,
        expires_at,
        message: message || null,
        theme_id: theme_id || null,
        sender_name: sender_name || null,
        status: "active",
        created_at: trx.fn.now(),
      })
      .returning("*");

    // ✅ deduct wallet
    await spendWalletBalance(
      req.user.sub,
      amount_aed,
      `هدية للرقم ${recipient_phone}`,
      gift.id,
      "gift_sent",
      trx
    );

    // 🎁 Reward: Send Gift (10 points)
    await addPoints(req.user.sub, 10, "gift_sent", gift.id, trx);

    // ✅ Store service items in proper table
    if (Array.isArray(service_items) && service_items.length > 0) {
      for (const item of service_items) {
        await trx("gift_items").insert({
          gift_id: gift.id,
          service_availability_id: item.availability_id,
          service_name: item.service_name || "Service",
          qty: item.qty || 1,
          unit_price_aed: item.unit_price_aed || 0,
          line_total_aed: (item.unit_price_aed || 0) * (item.qty || 1),
          duration_mins: item.duration_mins || 0,
          created_at: trx.fn.now(),
        });
      }
    }

    await trx.commit();

    // ✅ 🔔 NEW: Send Push Notification to receiver
setImmediate(async () => {
  try {
    // Get receiver's user ID from phone number
    const receiver = await knex("users")
      .where({ phone: recipient_phone })
      .first("id");

    if (receiver) {
      await notifyGiftReceived(
        receiver.id,
        gift.id,
        sender_name || "Someone special",
        Number(amount_aed)
      );
      console.log(`✅ Push notification sent to ${recipient_phone}`);
    } else {
      console.log(`⚠️ No user found with phone ${recipient_phone}`);
    }
  } catch (e) {
    console.error("Push notification failed (non-blocking):", e.message);
  }
});

    // ✅ Send WhatsApp notification asynchronously (don't wait for it)
    setImmediate(async () => {
      try {
        await sendGiftNotification(recipient_phone, {
          code: code,
          senderName: sender_name || "Someone special",
          amount: Number(amount_aed).toFixed(2),
          message: message,
          themeEmoji: theme_id === 'birthday' ? '🎂' : 
                      theme_id === 'wedding' ? '💍' : 
                      theme_id === 'anniversary' ? '💐' : '🎁',
        });
      } catch (e) {
        console.error("WhatsApp send failed (non-blocking):", e.message);
      }
    });

    res.json({ 
      ok: true, 
      gift: {
        id: gift.id,
        code: code,
        amount_aed: Number(amount_aed),
        recipient_phone,
        expires_at,
        items_count: service_items?.length || 0,
      }
    });
  } catch (err) {
    await trx.rollback();
    next(err);
  }
};

// ✅ POST /gifts/:id/redeem (manual redemption - not needed if auto-claim works)
exports.redeemGift = async (req, res, next) => {
  try {
    const { id } = req.params;

    const gift = await knex("gifts").where({ id }).first();
    if (!gift) {
      return res.status(404).json({ error: "Gift not found" });
    }

    // فقط المستلم يقدر يستخدمها
    if (String(gift.recipient_phone) !== String(req.user.phone)) {
      return res.status(403).json({ error: "Not allowed" });
    }

    if (gift.status !== "active") {
      return res.status(400).json({ error: "Gift not usable" });
    }

    // انتهت صلاحيتها؟
    if (new Date(gift.expires_at) <= new Date()) {
      return res.status(400).json({ error: "Gift expired" });
    }

    // تحديث الحالة
    await knex("gifts")
      .where({ id })
      .update({
        status: "redeemed",
        redeemed_at: knex.fn.now(),
      });

    res.json({ ok: true });
  } catch (err) {
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

    // فقط المستلم
    if (String(gift.recipient_phone) !== String(req.user.phone)) {
      await trx.rollback();
      return res.status(403).json({ error: "Not allowed" });
    }

    // إذا انحسبت قبل لا تعيدين
    if (gift.seen_at && gift.sender_seen_rewarded) {
      await trx.commit();
      return res.json({ ok: true, already: true });
    }

    // ✅ علمنا انها seen
    await trx("gifts").where({ id }).update({
      seen_at: trx.fn.now(),
    });

    // ✅ نقاط للمرسل (مرة وحدة) - 10 points when gift is opened
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