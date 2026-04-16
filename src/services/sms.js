const twilio = require("twilio");

const SMS_ENABLED = process.env.SMS_ENABLED === "true";
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_SMS_FROM = process.env.TWILIO_SMS_FROM;

console.log("SMS_ENABLED =", SMS_ENABLED);
console.log("TWILIO_ACCOUNT_SID exists =", !!TWILIO_ACCOUNT_SID);
console.log("TWILIO_AUTH_TOKEN exists =", !!TWILIO_AUTH_TOKEN);
console.log("TWILIO_SMS_FROM =", TWILIO_SMS_FROM);

let client = null;

if (SMS_ENABLED && TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN) {
    client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
}

function normalizePhone(phone) {
    if (!phone) return null;

    let value = String(phone).trim().replace(/[\s-]/g, "");

    if (value.startsWith("+")) value = value.slice(1);
    if (value.startsWith("05") && value.length === 10) {
        value = `971${value.slice(1)}`;
    }

    if (!/^\d+$/.test(value)) return null;

    return `+${value}`;
}

async function sendGiftSms(recipientPhone, giftData = {}) {
    const to = normalizePhone(recipientPhone);

    if (!to) {
        return { ok: false, error: "Invalid recipient phone" };
    }

    const receiverName = giftData.receiverName || "there";
    const senderName = giftData.senderName || "Someone special";
    const giftLink = giftData.giftLink || "https://glowee.app";
    const expiryText = giftData.expiryText || "Soon";

    const body = `Hey ${receiverName}, someone made your day!

Your friend ${senderName} just sent you a gift on GLOWEE.

Open your gift here:
${giftLink}

Don’t forget it expires on ${expiryText}.`;

    if (!SMS_ENABLED || !client || !TWILIO_SMS_FROM) {
        console.log("📩 [SMS DEV]", { to, body });
        return {
            ok: false,
            mode: "dev",
            error: "SMS is not enabled/configured",
            to,
        };
    }

    try {
        const res = await client.messages.create({
            from: TWILIO_SMS_FROM,
            to,
            body,
        });

        return {
            ok: true,
            mode: "production",
            sid: res.sid,
            status: res.status,
            to,
        };
    } catch (error) {
        console.error("❌ SMS send failed:", error.message);
        return {
            ok: false,
            error: error.message,
        };
    }
}

module.exports = {
    sendGiftSms,
};