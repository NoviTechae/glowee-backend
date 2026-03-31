const twilio = require("twilio");

const client = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

async function sendOtp(to) {
  return client.verify.v2
    .services(process.env.TWILIO_VERIFY_SERVICE_SID)
    .verifications.create({
      to,
      channel: "sms",
    });
}

async function checkOtp(to, code) {
  return client.verify.v2
    .services(process.env.TWILIO_VERIFY_SERVICE_SID)
    .verificationChecks.create({
      to,
      code,
    });
}

module.exports = { sendOtp, checkOtp };
