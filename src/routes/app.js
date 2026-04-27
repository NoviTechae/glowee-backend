const router = require("express").Router();
const appVersion = require("../config/appVersion");

function compareVersions(current, required) {
  const c = String(current || "0.0.0").split(".").map(Number);
  const r = String(required || "0.0.0").split(".").map(Number);

  for (let i = 0; i < Math.max(c.length, r.length); i++) {
    const a = c[i] || 0;
    const b = r[i] || 0;

    if (a < b) return -1;
    if (a > b) return 1;
  }

  return 0;
}

router.get("/version", (req, res) => {
  const platform = String(req.query.platform || "ios").toLowerCase();
  const currentVersion = String(req.query.version || "0.0.0");

  const config = appVersion[platform] || appVersion.ios;

  const updateRequired =
    compareVersions(currentVersion, config.minRequiredVersion) < 0;

  const updateAvailable =
    compareVersions(currentVersion, config.latestVersion) < 0;

  return res.json({
    platform,
    current_version: currentVersion,
    latest_version: config.latestVersion,
    min_required_version: config.minRequiredVersion,
    update_available: updateAvailable,
    update_required: updateRequired,
    force: updateRequired,
    store_url: config.storeUrl,
    message: updateRequired
      ? "A new version of Glowee is required to continue."
      : updateAvailable
      ? "A new version of Glowee is available."
      : null,
  });
});

module.exports = router;