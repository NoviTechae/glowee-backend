// src/routes/auth.js
const authRequired = require('../middleware/authRequired');
const router = require('express').Router();
const rateLimit = require('express-rate-limit');
const { sendOtp, checkOtp } = require('../services/twilioVerify');
const jwt = require('jsonwebtoken');
const { z } = require('zod');
const db = require('../db/knex');

const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET || JWT_SECRET === 'change_me') {
  throw new Error('JWT_SECRET is required and must not be "change_me"');
}

if (
  phone === APPLE_REVIEW_DEMO_PHONE &&
  otp === APPLE_REVIEW_DEMO_CODE
) {
  // bypass twilio completely

  let user = await db('users').where({ phone }).first();

  if (!user) {
    user = await db('users')
      .insert({ phone })
      .returning('*')
      .then(r => r[0]);
  }

  const token = jwt.sign({ id: user.id }, JWT_SECRET, {
    expiresIn: '30d',
  });

  return res.json({ token, user });
}

// ---------- Helpers ----------
function normalizeUAEPhone(input) {
  let p = String(input || '').trim().replace(/\s+/g, '');

  // remove leading 00
  if (p.startsWith('00')) p = '+' + p.slice(2);

  // if starts with 05xxxxxxxx -> +9715xxxxxxxx
  if (/^05\d{8}$/.test(p)) return '+971' + p.slice(1);

  // if starts with 5xxxxxxxx -> +9715xxxxxxxx
  if (/^5\d{8}$/.test(p)) return '+971' + p;

  // if starts with +971 and then 0? remove 0
  if (/^\+9710\d{8}$/.test(p)) return '+971' + p.slice(5);

  // already +9715xxxxxxxx
  if (/^\+9715\d{8}$/.test(p)) return p;

  // fallback keep as is (لكن نرفضه بالـ validate تحت)
  return p;
}

function isValidUAEPhone(p) {
  return /^\+9715\d{8}$/.test(p);
}

function issueJwt(user) {
  return jwt.sign(
    { sub: String(user.id), phone: user.phone },
    JWT_SECRET,
    { expiresIn: '30d' }
  );
}

// ✅ NEW: Auto-claim pending gifts when user logs in
async function autoClaimPendingGifts(userId, userPhone, trx = db) {
  try {
    // Find all active gifts sent to this phone number that haven't expired
    const pendingGifts = await trx("gifts")
      .where({ recipient_phone: userPhone, status: "active" })
      .whereRaw("expires_at > NOW()")
      .select("*");

    if (pendingGifts.length === 0) {
      return { claimed: 0, total_amount: 0 };
    }

    let totalAmount = 0;

    for (const gift of pendingGifts) {
      totalAmount += Number(gift.amount_aed);

      // Ensure wallet exists
      let wallet = await trx("wallets").where({ user_id: userId }).first();
      if (!wallet) {
        await trx("wallets").insert({
          user_id: userId,
          balance_aed: 0,
          updated_at: trx.fn.now(),
        });
      }

      // Credit wallet
      await trx("wallets")
        .where({ user_id: userId })
        .update({
          balance_aed: trx.raw("balance_aed + ?", [gift.amount_aed]),
          updated_at: trx.fn.now(),
        });

      // Record wallet transaction
      await trx("wallet_transactions").insert({
        user_id: userId,
        type: "gift_received",
        amount_aed: gift.amount_aed,
        ref_id: gift.id,
        note: `Gift from ${gift.sender_name || "someone"}${gift.message ? `: "${gift.message}"` : ""}`,
        created_at: trx.fn.now(),
      });

      // Mark gift as redeemed
      await trx("gifts").where({ id: gift.id }).update({
        status: "redeemed",
        redeemed_at: trx.fn.now(),
      });

      // ✅ Reward sender for gift being opened
      if (gift.sender_user_id && !gift.sender_seen_rewarded) {
        // Add points to sender (10 points for gift being claimed)
        const { addPoints } = require('../controllers/rewardController');
        await addPoints(gift.sender_user_id, 10, "gift_opened", gift.id, trx);

        // Mark as rewarded
        await trx("gifts").where({ id: gift.id }).update({
          sender_seen_rewarded: true,
        });
      }
    }

    return {
      claimed: pendingGifts.length,
      total_amount: totalAmount,
      gifts: pendingGifts.map(g => ({
        id: g.id,
        from: g.sender_name,
        amount: Number(g.amount_aed),
        message: g.message,
      }))
    };
  } catch (e) {
    console.error("Error auto-claiming gifts:", e);
    // Don't fail login if gift claiming fails
    return { claimed: 0, total_amount: 0, error: true };
  }
}

// ✅ NEW: Generate unique referral code for user
function generateReferralCode(userId) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // No confusing chars
  let code = "GLOW";
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

// ---------- Schemas ----------
const RequestOtpSchema = z.object({
  phone: z.string().min(8).max(20),
});

const VerifyOtpSchema = z.object({
  phone: z.string().min(8).max(20),
  code: z.string().regex(/^\d{6}$/),
});

// ---------- Rate limiters ----------
const OTP_REQUEST_LIMITER_IP = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10, // per IP
  standardHeaders: true,
  legacyHeaders: false,
});

const OTP_REQUEST_LIMITER_PHONE = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5, // per phone (keyed by normalized phone)
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const phoneRaw = req.body?.phone;
    return normalizeUAEPhone(phoneRaw);
  },
});

// ---------- Routes ----------

// POST /auth/request-otp
router.post(
  '/request-otp',
  OTP_REQUEST_LIMITER_IP,
  OTP_REQUEST_LIMITER_PHONE,
  async (req, res, next) => {
    try {
      const { phone } = RequestOtpSchema.parse(req.body);
      const normPhone = normalizeUAEPhone(phone);

      if (!isValidUAEPhone(normPhone)) {
        return res.status(400).json({ error: 'Invalid UAE phone format. Use 05XXXXXXXX or +9715XXXXXXXX' });
      }

      // Apple Review demo phone: skip Twilio and return normal success
      if (isAppleReviewDemoPhone(normPhone)) {
        await db('otp_codes').insert({
          phone: normPhone,
          code_hash: 'apple_review_demo',
          expires_at: new Date(Date.now() + 30 * 60 * 1000),
          attempts: 0,
        });

        return res.json({
          ok: true,
          expires_in_sec: 1800,
          demo: true,
        });
      }

      // anti-spam: max 3 OTP requests in last 5 mins per phone
      const recent = await db('otp_codes')
        .where({ phone: normPhone })
        .whereRaw(`created_at > now() - interval '5 minutes'`)
        .count('* as c')
        .first();

      if (Number(recent?.c || 0) >= 3) {
        return res.status(429).json({ error: 'Too many OTP requests. Try later.' });
      }

      // سجل محاولة الطلب فقط، بدون تخزين الكود
      await db('otp_codes').insert({
        phone: normPhone,
        code_hash: 'twilio_verify',
        expires_at: new Date(Date.now() + 5 * 60 * 1000),
        attempts: 0,
      });

      await sendOtp(normPhone);

      return res.json({
        ok: true,
        expires_in_sec: 300,
      });
    } catch (err) {
      console.error('request-otp error:', err);
      next(err);
    }
  }
);

// POST /auth/verify-otp
router.post('/verify-otp', async (req, res, next) => {
  const trx = await db.transaction();

  try {
    const { phone, code } = VerifyOtpSchema.parse(req.body);
    const normPhone = normalizeUAEPhone(phone);

    if (!isValidUAEPhone(normPhone)) {
      await trx.rollback();
      return res.status(400).json({ error: 'Invalid UAE phone format. Use 05XXXXXXXX or +9715XXXXXXXX' });
    }

    // Apple Review demo login
    if (isAppleReviewDemoPhone(normPhone)) {
      if (code !== APPLE_REVIEW_DEMO_CODE) {
        await trx.rollback();
        return res.status(400).json({ error: 'Invalid or expired code' });
      }
    } else {
      const result = await checkOtp(normPhone, code);

      if (result.status !== 'approved') {
        await trx.rollback();
        return res.status(400).json({ error: 'Invalid or expired code' });
      }
    }
      // find or create user
      let user = await trx('users').where({ phone: normPhone }).first();
      let isNewUser = false;

      if (!user) {
        isNewUser = true;

        // Generate unique referral code
        let referralCode = generateReferralCode(0);
        let attempts = 0;
        while (attempts < 10) {
          const existing = await trx('users').where({ referral_code: referralCode }).first();
          if (!existing) break;
          referralCode = generateReferralCode(attempts);
          attempts++;
        }

        const inserted = await trx('users')
          .insert({
            phone: normPhone,
            created_at: trx.fn.now(),
            last_login: trx.fn.now(),
            phone_verified_at: trx.fn.now(),
            is_active: true,
            is_blocked: false,
            referral_code: referralCode,
          })
          .returning(['id', 'phone', 'name', 'referral_code']);

        user = inserted?.[0];

        await trx('wallets').insert({
          user_id: user.id,
          balance_aed: 0,
          updated_at: trx.fn.now(),
        });

        await trx('user_rewards').insert({
          user_id: user.id,
          points_balance: 0,
          total_earned: 0,
          total_spent: 0,
          level_name: 'Bronze',
          created_at: trx.fn.now(),
        });
      } else {
        await trx('users').where({ id: user.id }).update({ last_login: trx.fn.now() });
      }

      // auto-claim pending gifts
      const giftsClaimed = await autoClaimPendingGifts(user.id, normPhone, trx);

      await trx.commit();

      const token = issueJwt(user);

      const response = {
        token,
        user: {
          id: user.id,
          phone: user.phone,
          name: user.name || null,
          referral_code: user.referral_code || null,
        },
        is_new_user: isNewUser,
      };

      if (giftsClaimed.claimed > 0) {
        response.gifts_claimed = giftsClaimed;
      }

      return res.json(response);
    } catch (err) {
      try {
        await trx.rollback();
      } catch { }
      console.error('verify-otp error:', err);
      next(err);
    }
  });

// GET /auth/me
router.get('/me', authRequired, async (req, res, next) => {
  try {
    const userId = req.user?.sub;
    const user = await db('users').where({ id: userId }).first();
    if (!user) return res.status(404).json({ error: 'User not found' });

    return res.json({
      user: {
        id: user.id,
        phone: user.phone,
        name: user.name || null,
        email: user.email || null,
        profile_image_url: user.profile_image_url || null,
        referral_code: user.referral_code || null,
      },
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
