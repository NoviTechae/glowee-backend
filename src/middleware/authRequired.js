const jwt = require("jsonwebtoken");

const JWT_SECRET = process.env.JWT_SECRET;

function authRequired(req, res, next) {
  const h = req.headers.authorization || "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: "Missing token" });
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload;
    return next();
  } catch (err) {
    console.error("JWT AUTH ERROR:", {
      message: err.message,
      name: err.name,
      path: req.path,
      authHeader: req.headers.authorization ? "exists" : "missing",
    });

    if (err.name === "TokenExpiredError") {
      try {
        const payload = jwt.verify(token, JWT_SECRET, {
          ignoreExpiration: true,
        });

        req.user = payload;
        return next();
      } catch {
        return res.status(401).json({ error: "Invalid token" });
      }
    }

    return res.status(401).json({ error: "Invalid token" });
  }
}

module.exports = authRequired;