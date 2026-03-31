// src/routes/health.js
const router = require('express').Router();
const db = require('../db/knex');

router.get('/', async (req, res) => {
  try {
    await db.raw('select 1');
    res.json({ ok: true, service: 'glowee-api', db: 'up' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, service: 'glowee-api', db: 'down' });
  }
});

module.exports = router;