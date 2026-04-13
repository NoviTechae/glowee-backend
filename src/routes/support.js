// src/routes/support.js
const router = require("express").Router();
const authRequired = require("../middleware/authRequired");
const db = require("../db/knex");
const { Resend } = require("resend");

const resend = new Resend(process.env.RESEND_API_KEY);

function topicLabel(topic) {
  const map = {
    bookings: "Bookings",
    wallet: "Wallet & Payments",
    rewards: "Rewards & Glows",
    gifts: "Gifts",
    salon: "Salon issue",
    technical: "Technical issue",
    others: "Others",
  };

  return map[topic] || "Other";
}

router.post("/tickets/email", authRequired, async (req, res, next) => {
  try {
    const userId = req.user.sub || req.user.id;
    const { topic, message, image_url } = req.body;

    if (!topic || !String(topic).trim()) {
      return res.status(400).json({ ok: false, error: "Topic is required" });
    }

    if (!message || !String(message).trim()) {
      return res.status(400).json({ ok: false, error: "Message is required" });
    }

    const user = await db("users")
      .where({ id: userId })
      .first(["id", "name", "phone", "email"]);

    if (!user) {
      return res.status(404).json({ ok: false, error: "User not found" });
    }

    const label = topicLabel(topic);

    const emailHtml = `
      <div style="font-family: Arial, sans-serif; line-height: 1.6;">
        <h2>New Glowee support ticket</h2>

        <p><strong>Topic:</strong> ${label}</p>
        <p><strong>User ID:</strong> ${user.id}</p>
        <p><strong>Name:</strong> ${user.name || "-"}</p>
        <p><strong>Phone:</strong> ${user.phone || "-"}</p>
        <p><strong>Email:</strong> ${user.email || "-"}</p>

        <hr />

        <p><strong>Message:</strong></p>
        <div style="white-space: pre-wrap;">${String(message)
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")}</div>

        ${
          image_url
            ? `<hr /><p><strong>Attachment:</strong></p><p>${image_url}</p>`
            : ""
        }
      </div>
    `;

    await resend.emails.send({
      from: process.env.RESEND_FROM_EMAIL || "Glowee <noreply@novitech.ae>",
      to: ["glowee@novitech.ae"],
      subject: `Glowee Support • ${label} • ${user.name || user.phone || user.id}`,
      html: emailHtml,
      reply_to: user.email || undefined,
    });

    return res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

module.exports = router;