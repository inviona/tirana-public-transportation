const express = require('express');
const { getGtfs, getSimplifiedRoutes, getSimplifiedStops } = require('../services/gtfsService');
const transformStops = require('../utils/transformStops');

const router = express.Router();

router.post('/plan', (req, res) => {
  const { fromStopId, toStopId } = req.body || {};
  const gtfs = getGtfs();
  const simplifiedStops = getSimplifiedStops();

  if (!gtfs) {
    return res.status(503).json({ error: 'GTFS data not loaded' });
  }

  const fromStop = simplifiedStops.find((s) => s.id === fromStopId);
  const toStop = simplifiedStops.find((s) => s.id === toStopId);

  if (!fromStop || !toStop) return res.status(400).json({ error: 'Invalid fromStopId or toStopId' });

  if (fromStopId === toStopId) {
    return res.json({
      fromStop: { id: fromStop.id, name: fromStop.name, lat: fromStop.lat, lng: fromStop.lng },
      toStop: { id: toStop.id, name: toStop.name, lat: toStop.lat, lng: toStop.lng },
      direct: [], transfers: [], message: 'Origin and destination are the same stop.',
    });
  }

  const result = gtfs.planJourney(fromStop.stop_id, toStop.stop_id);

  res.json({
    fromStop: result.from,
    toStop: result.to,
    direct: result.direct?.map(d => ({
      routeId: `route_${d.route.id}`,
      ref: d.route.ref,
      name: d.route.name,
      colour: d.route.colour,
      allStops: d.stops?.map(s => ({
        id: `stop_${s.stop?.stop_id}`,
        name: s.stop?.stop_name || '',
        lat: parseFloat(s.stop?.stop_lat) || 0,
        lng: parseFloat(s.stop?.stop_lon) || 0,
      })).filter(s => s.lat && s.lng) || [],
    })) || [],
    transfers: result.transfers?.map(t => ({
      viaStopId: `stop_${t.transfer.stopId}`,
      viaStopName: t.transfer.stopName,
      leg1: { routeId: `route_${t.leg1.route.id}`, ref: t.leg1.route.ref, name: t.leg1.route.name, colour: t.leg1.route.colour },
      leg2: { routeId: `route_${t.leg2.route.id}`, ref: t.leg2.route.ref, name: t.leg2.route.name, colour: t.leg2.route.colour },
    })) || [],
    message: result.message,
  });
});

module.exports = router;
