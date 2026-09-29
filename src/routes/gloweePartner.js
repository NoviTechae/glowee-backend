// routes/gloweePartner.js
const router = require("express").Router();
const { Resend } = require("resend");

const resend = new Resend(process.env.RESEND_API_KEY_GLOWEE);

const SOURCES = {
  app: "Glowee mobile app",
  dashboard: "Business dashboard",
};

// Anything a visitor types is escaped before it goes into the email,
// so nobody can inject links or HTML into your inbox.
function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function clean(value, max = 500) {
  return String(value ?? "").trim().slice(0, max);
}

router.post("/partner", async (req, res) => {
  try {
    const salonName = clean(req.body.salonName, 120);
    const contactName = clean(req.body.contactName, 120);
    const phone = clean(req.body.phone, 30);
    const email = clean(req.body.email, 160);
    const city = clean(req.body.city, 80);
    const instagramOrWebsite = clean(req.body.instagramOrWebsite, 200);
    const message = clean(req.body.message, 3000);
    const source = SOURCES[req.body.source] || SOURCES.app;

    if (!salonName || !contactName || !phone) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const row = (label, value) =>
      `<p style="margin:0 0 8px"><b>${label}:</b> ${escapeHtml(value) || "-"}</p>`;

    await resend.emails.send({
      from: process.env.EMAIL_FROM,
      to: process.env.GLOWEE_SUPPORT_TO || "glowee@novitech.ae",
      replyTo: email || undefined,
      subject: `Glowee partner request: ${salonName}`,
      html: `
        <div style="font-family:Arial,sans-serif;background:#f6f8fb;padding:24px">
          <div style="max-width:640px;margin:auto;background:#fff;border-radius:14px;padding:22px;border:1px solid #eee">
            <h2 style="margin:0 0 16px;color:#111">New partner request</h2>
            ${row("Salon", salonName)}
            ${row("Contact", contactName)}
            ${row("Phone", phone)}
            ${row("Email", email)}
            ${row("City", city)}
            ${row("Instagram/Website", instagramOrWebsite)}
            <hr style="margin:16px 0;border:0;border-top:1px solid #eee"/>
            <p style="margin:0 0 6px"><b>Message:</b></p>
            <p style="margin:0;white-space:pre-wrap">${escapeHtml(message) || "-"}</p>
            <div style="margin-top:18px;font-size:12px;color:#777">
              Sent from ${source}
            </div>
          </div>
        </div>
      `,
    });

    return res.json({ ok: true });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Failed to send" });
  }
});

module.exports = router;