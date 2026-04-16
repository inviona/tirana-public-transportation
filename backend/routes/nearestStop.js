const express = require('express');
const haversineM = require('../utils/haversine');
const { getSimplifiedStops } = require('../services/gtfsService');

const router = express.Router();

router.post('/', (req, res) => {
  const { lat, lng } = req.body;
  if (lat == null || lng == null) return res.status(400).json({ error: 'lat and lng are required' });

  const simplifiedStops = getSimplifiedStops();
  let bestStop = null;
  let bestDist = Infinity;
  for (const stop of simplifiedStops) {
    const d = haversineM(lat, lng, stop.lat, stop.lng);
    if (d < bestDist) {
      bestDist = d;
      bestStop = stop;
    }
  }

  res.json({
    stop: bestDist <= 500 ? bestStop : null,
    distanceM: Math.round(bestDist),
    withinRadius: bestDist <= 500,
    message: !bestStop ? 'No stops found within 500 m' : null,
  });
});

module.exports = router;
