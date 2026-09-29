// src/routes/gloweePartner.js
const router = require("express").Router();
const { Resend } = require("resend");
const db = require("../db/knex");

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

async function sendNotificationEmail(r) {
  const row = (label, value) =>
    `<p style="margin:0 0 8px"><b>${label}:</b> ${escapeHtml(value) || "-"}</p>`;

  await resend.emails.send({
    from: process.env.EMAIL_FROM,
    to: process.env.GLOWEE_SUPPORT_TO || "glowee@novitech.ae",
    replyTo: r.email || undefined,
    subject: `Glowee partner request: ${r.salonName}`,
    html: `
      <div style="font-family:Arial,sans-serif;background:#f6f8fb;padding:24px">
        <div style="max-width:640px;margin:auto;background:#fff;border-radius:14px;padding:22px;border:1px solid #eee">
          <h2 style="margin:0 0 16px;color:#111">New partner request</h2>
          ${row("Salon", r.salonName)}
          ${row("Contact", r.contactName)}
          ${row("Phone", r.phone)}
          ${row("Email", r.email)}
          ${row("City", r.city)}
          ${row("Instagram/Website", r.instagramOrWebsite)}
          <hr style="margin:16px 0;border:0;border-top:1px solid #eee"/>
          <p style="margin:0 0 6px"><b>Message:</b></p>
          <p style="margin:0;white-space:pre-wrap">${escapeHtml(r.message) || "-"}</p>
          <div style="margin-top:18px;font-size:12px;color:#777">
            Sent from ${SOURCES[r.source]}
          </div>
        </div>
      </div>
    `,
  });
}

router.post("/partner", async (req, res) => {
  try {
    const r = {
      salonName: clean(req.body.salonName, 120),
      contactName: clean(req.body.contactName, 120),
      phone: clean(req.body.phone, 30),
      email: clean(req.body.email, 160),
      city: clean(req.body.city, 80),
      instagramOrWebsite: clean(req.body.instagramOrWebsite, 200),
      message: clean(req.body.message, 3000),
      source: req.body.source === "dashboard" ? "dashboard" : "app",
    };

    if (!r.salonName || !r.contactName || !r.phone) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    // 1) Save first, so no request is lost even if the email fails.
    await db("partner_requests").insert({
      salon_name: r.salonName,
      contact_name: r.contactName,
      phone: r.phone,
      email: r.email || null,
      city: r.city || null,
      instagram_or_website: r.instagramOrWebsite || null,
      message: r.message || null,
      source: r.source,
    });

    // 2) Then notify by email. A failed email shouldn't fail the request.
    try {
      await sendNotificationEmail(r);
    } catch (emailError) {
      console.error("Partner request saved, but email failed:", emailError);
    }

    return res.json({ ok: true });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Failed to send" });
  }
});

module.exports = router;