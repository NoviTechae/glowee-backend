// src/server.js
require("dotenv").config();
const app = require("./app");
const cron = require("node-cron");
const { expireGifts } = require("./jobs/expireGifts");

const PORT = process.env.PORT || 8000;

// Start server
const server = app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Server running on http://0.0.0.0:${PORT}`);
  console.log(`📊 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🔐 JWT configured: ${process.env.JWT_SECRET ? 'Yes' : 'No'}`);
  console.log(`📱 WhatsApp enabled: ${process.env.WHATSAPP_ENABLED === 'true' ? 'Yes' : 'No (dev mode)'}`);
});

// ===== CRON JOBS =====

// Run daily at 2 AM to expire old gifts
cron.schedule('0 2 * * *', async () => {
  console.log('🕐 Running daily cron jobs...');
  await expireGifts();
});

// Optional: Run every hour to check for soon-to-expire gifts (send reminders)
// cron.schedule('0 * * * *', async () => {
//   console.log('🕐 Checking for expiring gifts...');
//   // TODO: Send reminder to recipients about gifts expiring soon
// });

// ===== GRACEFUL SHUTDOWN =====

process.on('SIGTERM', () => {
  console.log('👋 SIGTERM received, shutting down gracefully...');
  server.close(() => {
    console.log('✅ Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('👋 SIGINT received, shutting down gracefully...');
  server.close(() => {
    console.log('✅ Server closed');
    process.exit(0);
  });
});

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  console.error('💥 Uncaught Exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('💥 Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

module.exports = server;
