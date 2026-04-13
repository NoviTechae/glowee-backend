// src/app.js
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const path = require("path");

const app = express();

// ===== SECURITY CONFIGURATION =====

// 1. Trust proxy (for HTTPS detection behind load balancers)
app.set("trust proxy", 1);

// 2. Force HTTPS in production
if (process.env.NODE_ENV === "production") {
  app.use((req, res, next) => {
    // Check if request is already HTTPS
    if (req.header("x-forwarded-proto") !== "https") {
      return res.redirect(301, `https://${req.header("host")}${req.url}`);
    }
    next();
  });
}

// 3. Enhanced security headers with helmet
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        scriptSrc: ["'self'"],
        imgSrc: ["'self'", "data:", "https:", "http:"],
        connectSrc: ["'self'"],
        fontSrc: ["'self'"],
        objectSrc: ["'none'"],
        mediaSrc: ["'self'"],
        frameSrc: ["'none'"],
      },
    },
    crossOriginResourcePolicy: { policy: "cross-origin" },
    hsts: {
      maxAge: 31536000,
      includeSubDomains: true,
      preload: true,
    },
  })
);

// 4. CORS - SECURE: Only allow specific origins
const allowedOrigins = process.env.ALLOWED_ORIGINS 
  ? process.env.ALLOWED_ORIGINS.split(',').map(origin => origin.trim())
  : [
   "http://localhost:3000",        // Dashboard (Next.js)
      "http://127.0.0.1:3000",        // Dashboard
      "http://172.20.10.7:3000",      // ✅ Dashboard on LAN (THIS IS THE FIX)

      "http://localhost:8081",        // Expo dev (sometimes)
      "http://127.0.0.1:8081",
      "http://localhost:19006",       // Expo web (if used)
      "http://127.0.0.1:19006",

     "http://3.122.60.25:4000",
      "capacitor://localhost",        // iOS app (if used)
      "http://localhost",             // Android app
      // Add your production domains when ready:
      // 'https://glowee.app',
      // 'https://admin.glowee.app',
    ];

app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (mobile apps, Postman, curl, etc.)
    if (!origin) return callback(null, true);
    
    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      console.warn(`🚫 CORS blocked request from: ${origin}`);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  exposedHeaders: ['X-Total-Count', 'X-Page-Count']
}));


// 5. Body parsing with size limits
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// 6. Static files
app.use("/uploads", express.static(path.join(process.cwd(), "public", "uploads")));

// 7. Global rate limiting
app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 1000, // Limit each IP to 1000 requests per windowMs
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => {
      // Skip rate limiting for health check
      return req.path === '/health';
    },
    handler: (req, res) => {
      console.warn(`⚠️ Rate limit exceeded for IP: ${req.ip}`);
      res.status(429).json({
        error: 'Too many requests, please try again later.'
      });
    }
  })
);

// ===== ROUTES =====

// Health check
app.use("/health", require("./routes/health"));

// Mobile OTP auth
app.use("/auth", require("./routes/auth"));
app.use(require("./routes/meAccount"));

app.use("/users", require("./routes/users"));
app.use("/notifications", require("./routes/notifications"));

// Public browse
app.use("/salons", require("./routes/salons"));
app.use("/browse", require("./routes/publicBrowse"));

// Branch services
app.use("/salons", require("./routes/publicBranchServices"));
app.use("/salons", require("./routes/publicAvailabilitySlots"));
app.use("/salons", require("./routes/publicSlots"));
app.use("/salons", require("./routes/publicBranchCartSlots"));
app.use("/salons", require("./routes/publicAvailabilityStaff"));
app.use("/salons", require("./routes/publicBranchHours"));

// Bookings
app.use("/", require("./routes/publicBookingsCreate"));
app.use("/bookings", require("./routes/bookings"));
app.use(require("./routes/meBookings"));

// Gifts & receivers
app.use("/gifts", require("./routes/gifts"));
app.use("/user/receivers", require("./routes/receivers"));
app.use(require("./routes/giftThemesPublic"));

// Wallet & rewards
app.use("/wallet", require("./routes/wallet"));
app.use("/wallet", require("./routes/walletTopup"));
app.use("/rewards", require("./routes/rewards"));

// Payment routes (Tap Payments)
app.use('/payments', require("./routes/payments"));

// Glowee partners
app.use("/glowee", require("./routes/gloweePartner"));

app.use("/mobile", require("./routes/publicMobile"));

app.use(require("./src/routes/meProfile"));

const addressesRoutes = require("./routes/addresses");
app.use("/me/addresses", addressesRoutes);

// Dashboard
app.use("/dashboard/auth", require("./routes/dashboardAuth"));
app.use("/dashboard", require("./routes/dashboard"));

// ===== ERROR HANDLERS =====

// 404 handler - Route not found
app.use((req, res, next) => {
  res.status(404).json({
    error: 'Route not found',
    path: req.path
  });
});

// Global error handler - SECURE VERSION
app.use((err, req, res, next) => {
  // Log full error details server-side (for debugging)
  console.error("🔥 API Error:", {
    message: err.message,
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
    path: req.path,
    method: req.method,
    ip: req.ip,
    userId: req.user?.sub || 'anonymous'
  });

  // Determine if we're in production
  const isProd = process.env.NODE_ENV === 'production';
  
  // Send appropriate error response to client
  const statusCode = err.status || err.statusCode || 500;
  
  res.status(statusCode).json({
    error: isProd 
      ? (statusCode === 500 ? 'Internal server error' : err.message)
      : err.message,
    // Only include these in development
    ...(isProd ? {} : {
      code: err.code,
      path: req.path,
      timestamp: new Date().toISOString()
    })
  });
});



module.exports = app;