const express = require('express');
const fetch = require('node-fetch');

const router = express.Router();

router.get('/', async (req, res) => {
  const { q } = req.query;
  if (!q || q.trim().length < 2) return res.status(400).json({ error: 'Query too short' });

  try {
    const params = new URLSearchParams({
      q: q.trim(), format: 'json', addressdetails: '1', limit: '5',
      viewbox: '19.70,41.38,19.92,41.28', bounded: '1',
    });
    const response = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, {
      headers: { 'User-Agent': 'TiranaTransitApp/1.0 (student-project)' },
    });
    const data = await response.json();
    res.json(data.map(item => ({
      lat: parseFloat(item.lat), lng: parseFloat(item.lon), display_name: item.display_name, type: item.type,
    })));
  } catch (err) {
    res.status(502).json({ error: 'Geocoding service unavailable' });
  }
});

module.exports = router;
