// src/services/whatsapp.js

/**
 * WhatsApp Integration Service
 *
 * Setup Instructions:
 * 1. Create Twilio account: https://www.twilio.com/
 * 2. Enable WhatsApp: https://console.twilio.com/us1/develop/sms/try-it-out/whatsapp-learn
 * 3. Add to .env:
 *    TWILIO_ACCOUNT_SID=your_account_sid
 *    TWILIO_AUTH_TOKEN=your_auth_token
 *    TWILIO_WHATSAPP_FROM=whatsapp:+14155238886
 *    WHATSAPP_ENABLED=true
 *
 * For Production:
 * - Request WhatsApp Business API access
 * - Get approved template messages
 * - Use your own WhatsApp Business number
 */

const WHATSAPP_ENABLED = process.env.WHATSAPP_ENABLED === "true";

let twilioClient = null;

if (WHATSAPP_ENABLED) {
  try {
    const twilio = require("twilio");
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;

    if (!accountSid || !authToken) {
      console.warn("⚠️ WhatsApp: Twilio credentials not configured");
    } else {
      twilioClient = twilio(accountSid, authToken);
      console.log("✅ WhatsApp: Twilio client initialized");
    }
  } catch (e) {
    console.error("❌ WhatsApp: Failed to initialize Twilio", e.message);
  }
}

function normalizeWhatsappNumber(phone) {
  if (!phone) return null;

  let value = String(phone).trim();

  if (!value) return null;

  if (!value.startsWith("+") && !value.startsWith("whatsapp:")) {
    value = `+${value}`;
  }

  if (!value.startsWith("whatsapp:")) {
    value = `whatsapp:${value}`;
  }

  return value;
}

function buildGiftMessage(giftData = {}) {
  const {
    code,
    senderName,
    themeEmoji = "🎁",
    giftType = "wallet",
    merchantName,
  } = giftData;

  const safeSender = senderName || "Someone special";
  const safeCode = code || "-";

  const intro =
    giftType === "service"
      ? `${themeEmoji} You've received a Service gift on Glowee`
      : `${themeEmoji} You've received a Gift Card on Glowee`;

  const merchantLine =
    giftType === "service" && merchantName
      ? `Salon: ${merchantName}\n`
      : "";

  return `${intro}

From: ${safeSender}
${merchantLine}
Gift code: ${safeCode}

Open Glowee to view and redeem your gift.
✨ Valid for 3 months`;
}

function buildBookingMessage(bookingData = {}) {
  const {
    bookingId,
    salonName,
    branchName,
    scheduledAt,
    totalAed,
  } = bookingData;

  return `✅ Your booking is confirmed!

📍 ${salonName || "Glowee"}${branchName ? ` - ${branchName}` : ""}
📅 ${scheduledAt || "-"}
💰 Total: AED ${Number(totalAed || 0).toFixed(2)}

Booking ID: ${bookingId || "-"}

See you there! ✨`;
}

function buildOtpMessage(otpCode) {
  return `🔐 Your Glowee verification code is:

${otpCode}

This code will expire in 5 minutes.
Do not share this code with anyone.`;
}

/**
 * Send gift notification via WhatsApp
 */
async function sendGiftNotification(recipientPhone, giftData) {
  const toNumber = normalizeWhatsappNumber(recipientPhone);
  const messageBody = buildGiftMessage(giftData);

  if (!toNumber) {
    return {
      ok: false,
      error: "Invalid recipient phone",
    };
  }

  // Development mode: just log
  if (!WHATSAPP_ENABLED || !twilioClient) {
    console.log(`
📱 [WhatsApp DEV] Message to ${toNumber}:

${messageBody}
    `);

    return {
      ok: true,
      mode: "dev",
      to: toNumber,
    };
  }

  try {
    const twilioFrom =
      process.env.TWILIO_WHATSAPP_FROM || "whatsapp:+14155238886";

    const result = await twilioClient.messages.create({
      from: twilioFrom,
      to: toNumber,
      body: messageBody,
    });

    console.log(`✅ WhatsApp gift sent to ${toNumber}: ${result.sid}`);

    return {
      ok: true,
      mode: "production",
      sid: result.sid,
      status: result.status,
      to: toNumber,
    };
  } catch (error) {
    console.error(`❌ WhatsApp gift failed to ${toNumber}:`, error.message);

    return {
      ok: false,
      error: error.message,
      code: error.code,
    };
  }
}

/**
 * Send booking confirmation via WhatsApp
 */
async function sendBookingConfirmation(recipientPhone, bookingData) {
  const toNumber = normalizeWhatsappNumber(recipientPhone);
  const messageBody = buildBookingMessage(bookingData);

  if (!toNumber) {
    return {
      ok: false,
      error: "Invalid recipient phone",
    };
  }

  if (!WHATSAPP_ENABLED || !twilioClient) {
    console.log(`
📱 [WhatsApp DEV] Booking confirmation to ${toNumber}:

${messageBody}
    `);

    return {
      ok: true,
      mode: "dev",
      to: toNumber,
    };
  }

  try {
    const twilioFrom =
      process.env.TWILIO_WHATSAPP_FROM || "whatsapp:+14155238886";

    const result = await twilioClient.messages.create({
      from: twilioFrom,
      to: toNumber,
      body: messageBody,
    });

    console.log(`✅ Booking WhatsApp sent to ${toNumber}: ${result.sid}`);

    return {
      ok: true,
      mode: "production",
      sid: result.sid,
      status: result.status,
      to: toNumber,
    };
  } catch (error) {
    console.error(`❌ Booking WhatsApp failed to ${toNumber}:`, error.message);

    return {
      ok: false,
      error: error.message,
      code: error.code,
    };
  }
}

/**
 * Send OTP via WhatsApp
 */
async function sendOtpViaWhatsApp(recipientPhone, otpCode) {
  const toNumber = normalizeWhatsappNumber(recipientPhone);
  const messageBody = buildOtpMessage(otpCode);

  if (!toNumber) {
    return {
      ok: false,
      error: "Invalid recipient phone",
    };
  }

  if (!WHATSAPP_ENABLED || !twilioClient) {
    console.log(`📱 [WhatsApp DEV] OTP to ${toNumber}:\n\n${messageBody}`);

    return {
      ok: true,
      mode: "dev",
      to: toNumber,
    };
  }

  try {
    const twilioFrom =
      process.env.TWILIO_WHATSAPP_FROM || "whatsapp:+14155238886";

    const result = await twilioClient.messages.create({
      from: twilioFrom,
      to: toNumber,
      body: messageBody,
    });

    console.log(`✅ OTP WhatsApp sent to ${toNumber}: ${result.sid}`);

    return {
      ok: true,
      mode: "production",
      sid: result.sid,
      status: result.status,
      to: toNumber,
    };
  } catch (error) {
    console.error(`❌ OTP WhatsApp failed to ${toNumber}:`, error.message);

    return {
      ok: false,
      error: error.message,
      code: error.code,
    };
  }
}

module.exports = {
  sendGiftNotification,
  sendBookingConfirmation,
  sendOtpViaWhatsApp,
};