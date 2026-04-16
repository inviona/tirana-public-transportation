const express = require('express');
const fetch = require('node-fetch');
const { ORS_API_KEY } = require('../config/constants');

const router = express.Router();

router.post('/', async (req, res) => {
  const { from, to } = req.body;
  if (!from || !to || from.length < 2 || to.length < 2) return res.status(400).json({ error: 'invalid from/to' });
  if (!ORS_API_KEY) return res.status(500).json({ error: 'ORS_API_KEY not configured' });

  try {
    const url = 'https://api.openrouteservice.org/v2/directions/foot-walking/geojson';
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': ORS_API_KEY },
      body: JSON.stringify({ coordinates: [from, to] }),
    });

    if (!response.ok) return res.status(502).json({ error: 'Walking route service error' });

    const data = await response.json();
    const feature = data.features?.[0];
    if (!feature) return res.status(404).json({ error: 'No walking route found' });

    res.json({
      geometry: feature.geometry,
      distance_m: Math.round(feature.properties?.summary?.distance || 0),
      duration_s: Math.round(feature.properties?.summary?.duration || 0),
    });
  } catch (err) {
    res.status(502).json({ error: 'Walking route service unavailable' });
  }
});

module.exports = router;
