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
 * 
 * For Production:
 * - Request WhatsApp Business API access
 * - Get approved template messages
 * - Use your own WhatsApp Business number
 */

const WHATSAPP_ENABLED = process.env.WHATSAPP_ENABLED === 'true';

let twilioClient = null;

if (WHATSAPP_ENABLED) {
  try {
    const twilio = require('twilio');
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    
    if (!accountSid || !authToken) {
      console.warn('⚠️  WhatsApp: Twilio credentials not configured');
    } else {
      twilioClient = twilio(accountSid, authToken);
      console.log('✅ WhatsApp: Twilio client initialized');
    }
  } catch (e) {
    console.error('❌ WhatsApp: Failed to initialize Twilio', e.message);
  }
}

/**
 * Send gift notification via WhatsApp
 */
async function sendGiftNotification(recipientPhone, giftData) {
  const {
    code,
    senderName,
    amount,
    message,
    themeEmoji = '🎁'
  } = giftData;

  // Development mode: just log
  if (!WHATSAPP_ENABLED || !twilioClient) {
    console.log(`
📱 [WhatsApp DEV] Message to ${recipientPhone}:

${themeEmoji} You received a gift from ${senderName}!

Amount: AED ${amount}
${message ? `Message: "${message}"` : ''}

Gift Code: ${code}

Download Glowee app to claim your gift:
https://glowee.app/download

✨ Valid for 3 months
    `);
    return { ok: true, mode: 'dev' };
  }

  // Production mode: send via Twilio
  try {
    const twilioFrom = process.env.TWILIO_WHATSAPP_FROM || 'whatsapp:+14155238886';
    
    // Normalize phone number to international format
    let toNumber = recipientPhone;
    if (!toNumber.startsWith('whatsapp:')) {
      toNumber = `whatsapp:${toNumber}`;
    }

    const messageBody = `${themeEmoji} You received a gift from ${senderName}!

Amount: AED ${amount}
${message ? `\nMessage: "${message}"\n` : ''}
Gift Code: ${code}

Download Glowee app to claim:
https://glowee.app/download

✨ Valid for 3 months`;

    const result = await twilioClient.messages.create({
      from: twilioFrom,
      to: toNumber,
      body: messageBody,
    });

    console.log(`✅ WhatsApp sent to ${recipientPhone}: ${result.sid}`);

    return {
      ok: true,
      mode: 'production',
      sid: result.sid,
      status: result.status,
    };
  } catch (error) {
    console.error(`❌ WhatsApp failed to ${recipientPhone}:`, error.message);
    
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
  const {
    bookingId,
    salonName,
    branchName,
    scheduledAt,
    totalAed,
  } = bookingData;

  if (!WHATSAPP_ENABLED || !twilioClient) {
    console.log(`
📱 [WhatsApp DEV] Booking confirmation to ${recipientPhone}:
✅ Booking confirmed at ${salonName}
📅 ${scheduledAt}
💰 AED ${totalAed}
🔢 Booking #${bookingId}
    `);
    return { ok: true, mode: 'dev' };
  }

  try {
    const twilioFrom = process.env.TWILIO_WHATSAPP_FROM || 'whatsapp:+14155238886';
    let toNumber = recipientPhone.startsWith('whatsapp:') 
      ? recipientPhone 
      : `whatsapp:${recipientPhone}`;

    const messageBody = `✅ Your booking is confirmed!

📍 ${salonName}${branchName ? ` - ${branchName}` : ''}
📅 ${scheduledAt}
💰 Total: AED ${totalAed}

Booking ID: ${bookingId}

See you there! ✨`;

    const result = await twilioClient.messages.create({
      from: twilioFrom,
      to: toNumber,
      body: messageBody,
    });

    console.log(`✅ Booking WhatsApp sent: ${result.sid}`);

    return {
      ok: true,
      mode: 'production',
      sid: result.sid,
    };
  } catch (error) {
    console.error(`❌ Booking WhatsApp failed:`, error.message);
    return {
      ok: false,
      error: error.message,
    };
  }
}

/**
 * Send OTP via WhatsApp (alternative to SMS)
 */
async function sendOtpViaWhatsApp(recipientPhone, otpCode) {
  if (!WHATSAPP_ENABLED || !twilioClient) {
    console.log(`📱 [WhatsApp DEV] OTP to ${recipientPhone}: ${otpCode}`);
    return { ok: true, mode: 'dev' };
  }

  try {
    const twilioFrom = process.env.TWILIO_WHATSAPP_FROM || 'whatsapp:+14155238886';
    let toNumber = recipientPhone.startsWith('whatsapp:') 
      ? recipientPhone 
      : `whatsapp:${recipientPhone}`;

    const messageBody = `🔐 Your Glowee verification code is:

${otpCode}

This code will expire in 5 minutes.
Do not share this code with anyone.`;

    const result = await twilioClient.messages.create({
      from: twilioFrom,
      to: toNumber,
      body: messageBody,
    });

    console.log(`✅ OTP WhatsApp sent: ${result.sid}`);

    return {
      ok: true,
      mode: 'production',
      sid: result.sid,
    };
  } catch (error) {
    console.error(`❌ OTP WhatsApp failed:`, error.message);
    return {
      ok: false,
      error: error.message,
    };
  }
}

module.exports = {
  sendGiftNotification,
  sendBookingConfirmation,
  sendOtpViaWhatsApp,
};