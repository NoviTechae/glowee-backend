// src/routes/auth.js
const authRequired = require("../middleware/authRequired");
const router = require("express").Router();
const rateLimit = require("express-rate-limit");
const { sendOtp, checkOtp } = require("../services/twilioVerify");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const { z } = require("zod");
const db = require("../db/knex");

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET || JWT_SECRET === "change_me") {
  throw new Error('JWT_SECRET is required and must not be "change_me"');
}

// App Store review account. Only works while APPLE_REVIEW_ENABLED=true in .env,
// so it can be switched off between reviews.
const APPLE_REVIEW_DEMO_PHONE = "+971500000000";
const APPLE_REVIEW_DEMO_CODE = "123456";
const appleReviewOn = () => process.env.APPLE_REVIEW_ENABLED === "true";
const isAppleReviewDemoPhone = (phone) => appleReviewOn() && phone === APPLE_REVIEW_DEMO_PHONE;

// ---------- Helpers ----------
function normalizeUAEPhone(input) {
  let p = String(input || "").trim().replace(/[\s-]+/g, "");
  if (p.startsWith("00")) p = "+" + p.slice(2);
  if (/^05\d{8}$/.test(p)) return "+971" + p.slice(1);
  if (/^5\d{8}$/.test(p)) return "+971" + p;
  if (/^9715\d{8}$/.test(p)) return "+" + p;
  if (/^\+9710\d{8}$/.test(p)) return "+971" + p.slice(5);
  return p;
}

const isValidUAEPhone = (p) => /^\+9715\d{8}$/.test(p);

function issueJwt(user) {
  return jwt.sign({ sub: String(user.id), phone: user.phone }, JWT_SECRET, { expiresIn: "365d", algorithm: "HS256" });
}

function generateReferralCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "GLOW";
  for (let i = 0; i < 6; i++) code += chars[crypto.randomInt(chars.length)];
  return code;
}

// Credits gifts sent to this phone before the person had an account.
// Runs in a savepoint: if anything fails, the gifts stay untouched and login still works.
async function autoClaimPendingGifts(userId, userPhone, trx) {
  try {
    return await trx.transaction(async (sp) => {
      // Claim atomically, so two logins at once can't credit the same gift twice.
      const gifts = await sp("gifts")
        .where({ recipient_phone: userPhone, status: "active" })
        .whereNull("salon_id") // Salon gifts are used when booking that salon, not turned into wallet money.
        .whereRaw("expires_at > now()")
        .update({ status: "redeemed", redeemed_at: sp.fn.now() })
        .returning("*");

      if (!gifts.length) return { claimed: 0, total_amount: 0 };

      const total = gifts.reduce((s, g) => s + Number(g.amount_aed), 0);

      const wallet = await sp("wallets").where({ user_id: userId }).first("user_id");
      if (!wallet) await sp("wallets").insert({ user_id: userId, balance_aed: 0, updated_at: sp.fn.now() });

      await sp("wallets")
        .where({ user_id: userId })
        .update({ balance_aed: sp.raw("balance_aed + ?", [total]), updated_at: sp.fn.now() });

      await sp("wallet_transactions").insert(
        gifts.map((g) => ({
          user_id: userId,
          type: "gift_received",
          amount_aed: g.amount_aed,
          ref_id: g.id,
          note: `Gift from ${g.sender_name || "someone"}`,
          created_at: sp.fn.now(),
        }))
      );

      const { addPoints } = require("../controllers/rewardController");
      for (const g of gifts) {
        if (g.sender_user_id && !g.sender_seen_rewarded) {
          await addPoints(g.sender_user_id, 10, "gift_opened", g.id, sp);
          await sp("gifts").where({ id: g.id }).update({ sender_seen_rewarded: true });
        }
      }

      return {
        claimed: gifts.length,
        total_amount: total,
        gifts: gifts.map((g) => ({ id: g.id, from: g.sender_name, amount: Number(g.amount_aed), message: g.message })),
      };
    });
  } catch (e) {
    console.error("Gift auto-claim failed (login continues):", e.message);
    return { claimed: 0, total_amount: 0, error: true };
  }
}

// ---------- Schemas ----------
const RequestOtpSchema = z.object({ phone: z.string().min(8).max(20) });
const VerifyOtpSchema = z.object({ phone: z.string().min(8).max(20), code: z.string().regex(/^\d{6}$/) });

// ---------- Rate limiters ----------
const phoneKey = (req) => normalizeUAEPhone(req.body?.phone);
const skipDemo = (req) => isAppleReviewDemoPhone(phoneKey(req));

const OTP_REQUEST_LIMITER_IP = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipDemo,
  message: { error: "Too many requests. Try again later." },
});

const OTP_REQUEST_LIMITER_PHONE = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `req:${phoneKey(req)}`,
  skip: skipDemo,
  message: { error: "Too many codes requested. Try again later." },
});

// Guessing codes: Twilio also locks a code after 5 wrong tries.
const OTP_VERIFY_LIMITER = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `verify:${phoneKey(req)}`,
  message: { error: "Too many attempts. Request a new code in a few minutes." },
});

// ---------- Routes ----------

// POST /auth/request-otp
router.post("/request-otp", OTP_REQUEST_LIMITER_IP, OTP_REQUEST_LIMITER_PHONE, async (req, res, next) => {
  try {
    const parsed = RequestOtpSchema.safeParse(req.body);
    const normPhone = parsed.success ? normalizeUAEPhone(parsed.data.phone) : "";
    if (!isValidUAEPhone(normPhone)) {
      return res.status(400).json({ error: "Enter a UAE mobile number, like 05X XXX XXXX" });
    }

    if (isAppleReviewDemoPhone(normPhone)) {
      return res.json({ ok: true, expires_in_sec: 1800, demo: true });
    }

    const recent = await db("otp_codes")
      .where({ phone: normPhone })
      .whereRaw(`created_at > now() - interval '5 minutes'`)
      .count("* as c")
      .first();
    if (Number(recent?.c || 0) >= 3) {
      return res.status(429).json({ error: "Too many codes requested. Try again in 5 minutes." });
    }

    await db("otp_codes").insert({
      phone: normPhone,
      code_hash: "twilio_verify",
      expires_at: new Date(Date.now() + 5 * 60 * 1000),
      attempts: 0,
    });

    await sendOtp(normPhone);
    return res.json({ ok: true, expires_in_sec: 300 });
  } catch (err) {
    console.error("request-otp error:", err.message);
    next(err);
  }
});

// POST /auth/verify-otp
router.post("/verify-otp", OTP_VERIFY_LIMITER, async (req, res, next) => {
  const parsed = VerifyOtpSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Enter the 6-digit code" });

  const normPhone = normalizeUAEPhone(parsed.data.phone);
  const { code } = parsed.data;
  if (!isValidUAEPhone(normPhone)) {
    return res.status(400).json({ error: "Enter a UAE mobile number, like 05X XXX XXXX" });
  }

  // Check the code before opening a transaction (the Twilio call can take a moment).
  try {
    if (isAppleReviewDemoPhone(normPhone)) {
      if (code !== APPLE_REVIEW_DEMO_CODE) return res.status(400).json({ error: "Invalid or expired code" });
    } else {
      const result = await checkOtp(normPhone, code);
      if (result.status !== "approved") return res.status(400).json({ error: "Invalid or expired code" });
    }
  } catch (err) {
    // Twilio returns 404 once a code has expired or been used.
    if (err?.status === 404 || err?.code === 20404) return res.status(400).json({ error: "Invalid or expired code" });
    console.error("verify-otp check error:", err.message);
    return next(err);
  }

  const trx = await db.transaction();
  try {
    let user = await trx("users").where({ phone: normPhone }).first();
    let isNewUser = false;

    if (user && user.is_blocked) {
      await trx.rollback();
      return res.status(403).json({ error: "This account is not available. Contact Glowee support.", code: "ACCOUNT_BLOCKED" });
    }

    if (!user) {
      isNewUser = true;
      let referralCode = generateReferralCode();
      for (let i = 0; i < 10; i++) {
        if (!(await trx("users").where({ referral_code: referralCode }).first("id"))) break;
        referralCode = generateReferralCode();
      }

      [user] = await trx("users")
        .insert({
          phone: normPhone,
          created_at: trx.fn.now(),
          last_login: trx.fn.now(),
          phone_verified_at: trx.fn.now(),
          is_active: true,
          is_blocked: false,
          referral_code: referralCode,
        })
        .returning(["id", "phone", "name", "referral_code"]);

      await trx("wallets").insert({ user_id: user.id, balance_aed: 0, updated_at: trx.fn.now() });
      await trx("user_rewards").insert({
        user_id: user.id,
        points_balance: 0,
        total_earned: 0,
        total_spent: 0,
        level_name: "Bronze",
        created_at: trx.fn.now(),
      });
    } else {
      await trx("users").where({ id: user.id }).update({ last_login: trx.fn.now() });
    }

    const giftsClaimed = await autoClaimPendingGifts(user.id, normPhone, trx);
    await trx.commit();

    const response = {
      token: issueJwt(user),
      user: { id: user.id, phone: user.phone, name: user.name || null, referral_code: user.referral_code || null },
      is_new_user: isNewUser,
    };
    if (giftsClaimed.claimed > 0) response.gifts_claimed = giftsClaimed;
    return res.json(response);
  } catch (err) {
    try {
      await trx.rollback();
    } catch {}
    console.error("verify-otp error:", err.message);
    next(err);
  }
});

// GET /auth/me
router.get("/me", authRequired, async (req, res, next) => {
  try {
    const user = await db("users").where({ id: req.user.sub }).first();
    if (!user) return res.status(404).json({ error: "User not found" });
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