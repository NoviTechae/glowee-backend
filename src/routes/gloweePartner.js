// routes/gloweePartner.js
const router = require("express").Router();
const { Resend } = require("resend");

router.post("/partner", async (req, res) => {
  try {
    const {
      salonName,
      contactName,
      phone,
      email,
      city,
      instagramOrWebsite,
      message,
    } = req.body;

    if (!salonName || !contactName || !phone) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const resend = new Resend(process.env.RESEND_API_KEY_GLOWEE);

    await resend.emails.send({
      from: process.env.EMAIL_FROM, // مثال: no-reply@novitech.ae
      to: process.env.GLOWEE_SUPPORT_TO || "glowee@novitech.ae",
      replyTo: email || undefined,
      subject: `Glowee Partner Form — ${salonName}`,
      html: `
        <div style="font-family:Arial;background:#f6f8fb;padding:24px">
          <div style="max-width:640px;margin:auto;background:#fff;border-radius:14px;padding:22px;border:1px solid #eee">
            <h2 style="margin:0 0 14px;color:#2F80ED">New Glowee Partner Application</h2>
            <p><b>Salon:</b> ${salonName}</p>
            <p><b>Contact:</b> ${contactName}</p>
            <p><b>Phone:</b> ${phone}</p>
            <p><b>Email:</b> ${email || "-"}</p>
            <p><b>City:</b> ${city || "-"}</p>
            <p><b>Instagram/Website:</b> ${instagramOrWebsite || "-"}</p>
            <hr style="margin:16px 0"/>
            <p><b>Message:</b></p>
            <p>${message || "-"}</p>
            <div style="margin-top:18px;font-size:12px;color:#777">
              Sent from Glowee Mobile App
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