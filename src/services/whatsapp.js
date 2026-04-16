// src/services/whatsapp.js

const fetch = require("node-fetch");

const WHATSAPP_ENABLED = process.env.WHATSAPP_ENABLED === "true";
const WHATSAPP_ACCESS_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN;
const WHATSAPP_PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;
const WHATSAPP_API_VERSION = process.env.WHATSAPP_API_VERSION || "v23.0";

function normalizeWhatsappNumber(phone) {
  if (!phone) return null;

  let value = String(phone).trim();

  if (!value) return null;

  // remove spaces/dashes
  value = value.replace(/[\s-]/g, "");

  // remove leading +
  if (value.startsWith("+")) {
    value = value.slice(1);
  }

  // UAE local -> international
  if (value.startsWith("05") && value.length === 10) {
    value = `971${value.slice(1)}`;
  }

  if (!/^\d+$/.test(value)) return null;

  return value;
}

function buildGiftTemplateParams(giftData = {}) {
  const {
    receiverName,
    senderName,
    giftLink,
    expiryText,
  } = giftData;

  return [
    receiverName || "Glowee User",
    senderName || "Someone special",
    giftLink || "https://glowee.app",
    expiryText || "Soon",
  ];
}

function buildBookingTemplateParams(bookingData = {}) {
  const {
    customerName,
    salonName,
    scheduledAtText,
    bookingLink,
  } = bookingData;

  return [
    customerName || "Glowee User",
    salonName || "Glowee",
    scheduledAtText || "Your selected time",
    bookingLink || "https://glowee.app",
  ];
}

async function sendTemplateMessage({
  recipientPhone,
  templateName,
  languageCode = "en",
  bodyParams = [],
}) {
  const to = normalizeWhatsappNumber(recipientPhone);

  if (!to) {
    return {
      ok: false,
      error: "Invalid recipient phone",
    };
  }

  if (!WHATSAPP_ENABLED) {
    console.log("📱 [WhatsApp DEV] Disabled mode");
    console.log({
      to,
      templateName,
      languageCode,
      bodyParams,
    });

    return {
      ok: false,
      mode: "dev",
      error: "WhatsApp is disabled",
      to,
      templateName,
    };
  }

  if (!WHATSAPP_ACCESS_TOKEN || !WHATSAPP_PHONE_NUMBER_ID) {
    return {
      ok: false,
      error: "WhatsApp Meta credentials are missing",
    };
  }

  try {
    const url = `https://graph.facebook.com/${WHATSAPP_API_VERSION}/${WHATSAPP_PHONE_NUMBER_ID}/messages`;

    const payload = {
      messaging_product: "whatsapp",
      to,
      type: "template",
      template: {
        name: templateName,
        language: { code: languageCode },
        components: [
          {
            type: "body",
            parameters: bodyParams.map((text) => ({
              type: "text",
              text: String(text ?? ""),
            })),
          },
        ],
      },
    };

    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${WHATSAPP_ACCESS_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const json = await response.json().catch(() => ({}));

    if (!response.ok) {
      console.error("❌ WhatsApp Meta send failed:", json);

      return {
        ok: false,
        error: json?.error?.message || "WhatsApp send failed",
        details: json,
      };
    }

    console.log(`✅ WhatsApp template sent to ${to}`, json);

    return {
      ok: true,
      mode: "production",
      to,
      data: json,
    };
  } catch (error) {
    console.error("❌ WhatsApp Meta request failed:", error.message);

    return {
      ok: false,
      error: error.message,
    };
  }
}

/**
 * Send gift notification via approved template:
 * gift_notification
 *
 * Body variables order:
 * {{1}} receiver name
 * {{2}} sender name
 * {{3}} gift link
 * {{4}} expiry date
 */
async function sendGiftNotification(recipientPhone, giftData = {}) {
  const bodyParams = buildGiftTemplateParams(giftData);

  return sendTemplateMessage({
    recipientPhone,
    templateName: "gift_notification",
    languageCode: "en",
    bodyParams,
  });
}

/**
 * Optional booking confirmation template
 * Create this template first in Meta before using:
 * booking_confirmation
 *
 * Suggested body variables:
 * {{1}} customer name
 * {{2}} salon name
 * {{3}} schedule text
 * {{4}} booking link
 */
async function sendBookingConfirmation(recipientPhone, bookingData = {}) {
  const bodyParams = buildBookingTemplateParams(bookingData);

  return sendTemplateMessage({
    recipientPhone,
    templateName: "booking_confirmation",
    languageCode: "en",
    bodyParams,
  });
}

/**
 * OTP over WhatsApp should ideally use a dedicated approved auth template.
 * Until you create one in Meta, keep this disabled or dev-only.
 */
async function sendOtpViaWhatsApp(recipientPhone, otpCode) {
  return {
    ok: false,
    error: "OTP WhatsApp template not configured yet",
    otpCode,
  };
}

module.exports = {
  sendGiftNotification,
  sendBookingConfirmation,
  sendOtpViaWhatsApp,
  normalizeWhatsappNumber,
};