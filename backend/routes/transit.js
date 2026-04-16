const express = require('express');
const { getGtfs, getSimplifiedRoutes, getSimplifiedStops } = require('../services/gtfsService');
const { findNearestStopsForVehicle } = require('../services/vehicleService');
const haversineM = require('../utils/haversine');
const transformStops = require('../utils/transformStops');

const router = express.Router();

router.get('/routes', (req, res) => {
  const simplifiedRoutes = getSimplifiedRoutes();
  res.json(simplifiedRoutes.map(r => ({
    id: r.id, ref: r.ref, name: r.name,
    colour: r.colour, active: r.active, stopsCount: r.stops?.length || 0,
  })));
});

router.get('/routes/:id', (req, res) => {
  const simplifiedRoutes = getSimplifiedRoutes();
  const gtfs = getGtfs();
  const route = simplifiedRoutes.find(r => r.id === req.params.id);
  if (!route) return res.status(404).json({ error: 'Route not found' });
  if (!gtfs) return res.status(503).json({ error: 'GTFS not loaded' });

  const stopsInOrder = gtfs.getRouteStopsInOrder(route.route_id);
  const schedule = gtfs.getRouteSchedule(route.route_id);

  res.json({
    id: route.id, ref: route.ref, name: route.name, colour: route.colour,
    stops: stopsInOrder || [],
    schedule: schedule?.schedule?.slice(0, 20) || [],
  });
});

router.get('/stops', (req, res) => {
  const { q, route } = req.query;
  const simplifiedStops = getSimplifiedStops();
  let results = simplifiedStops;
  if (q) results = results.filter(s => s.name.toLowerCase().includes(q.toLowerCase()));
  if (route) results = results.filter(s => s.routes.some(r => r.ref === route));
  res.json(results.slice(0, 100));
});

router.get('/stops/:id', (req, res) => {
  const simplifiedStops = getSimplifiedStops();
  const gtfs = getGtfs();
  const stop = simplifiedStops.find(s => s.id === req.params.id);
  if (!stop) return res.status(404).json({ error: 'Stop not found' });
  if (!gtfs) return res.status(503).json({ error: 'GTFS not loaded' });

  res.json({
    id: stop.id, name: stop.name, lat: stop.lat, lng: stop.lng,
    routes: stop.routes,
    arrivals: gtfs.getStopArrivals(stop.stop_id, 20),
  });
});

router.get('/stops/:id/arrivals', (req, res) => {
  const simplifiedStops = getSimplifiedStops();
  const gtfs = getGtfs();
  const stop = simplifiedStops.find(s => s.id === req.params.id);
  if (!stop) return res.status(404).json({ error: 'Stop not found' });
  if (!gtfs) return res.status(503).json({ error: 'GTFS not loaded' });

  const limit = parseInt(req.query.limit) || 15;
  res.json({ stopId: stop.id, stopName: stop.name, arrivals: gtfs.getStopArrivals(stop.stop_id, limit) });
});

router.post('/journey', async (req, res) => {
  const { fromStopId, toStopId, from: fromCoord, to: toCoord } = req.body || {};
  const gtfs = getGtfs();
  const simplifiedStops = getSimplifiedStops();

  if (!gtfs) return res.status(503).json({ error: 'GTFS not loaded. Please restart the server.' });

  let fromStop = null, toStop = null;

  if (fromCoord && fromCoord.lat != null && fromCoord.lng != null) {
    const result = findNearestStops(fromCoord.lat, fromCoord.lng, 1000, simplifiedStops);
    if (!result.stop) {
      return res.json({
        from: { lat: fromCoord.lat, lng: fromCoord.lng, name: fromCoord.name || 'Your location' },
        to: toCoord ? { lat: toCoord.lat, lng: toCoord.lng, name: toCoord.name || 'Destination' } : null,
        walkingLegs: [], direct: [], transfers: [],
        message: 'No nearby transit available near your starting location.',
      });
    }
    fromStop = result.stop;
  } else if (fromStopId) {
    fromStop = simplifiedStops.find(s => s.id === fromStopId);
  }

  if (toCoord && toCoord.lat != null && toCoord.lng != null) {
    const result = findNearestStops(toCoord.lat, toCoord.lng, 1000, simplifiedStops);
    if (!result.stop) {
      return res.json({
        from: fromStop ? { id: fromStop.id, name: fromStop.name, lat: fromStop.lat, lng: fromStop.lng }
                       : { lat: fromCoord?.lat, lng: fromCoord?.lng, name: fromCoord?.name },
        to: { lat: toCoord.lat, lng: toCoord.lng, name: toCoord.name || 'Destination' },
        walkingLegs: [], direct: [], transfers: [],
        message: 'No nearby transit available near your destination.',
      });
    }
    toStop = result.stop;
  } else if (toStopId) {
    toStop = simplifiedStops.find(s => s.id === toStopId);
  }

  if (!fromStop || !toStop) {
    return res.status(400).json({ error: 'Could not resolve stops. Please try selecting stops from the list.' });
  }
  if (fromStop.id === toStop.id) {
    return res.json({
      from: { id: fromStop.id, name: fromStop.name, lat: fromStop.lat, lng: fromStop.lng },
      to:   { id: toStop.id,   name: toStop.name,   lat: toStop.lat,   lng: toStop.lng },
      walkingLegs: [], direct: [], transfers: [],
      message: 'Same origin and destination.',
    });
  }

  const gtfsResult = gtfs.planJourney(fromStop.stop_id, toStop.stop_id);

  res.json({
    from: { id: fromStop.id, name: fromStop.name, lat: fromStop.lat, lng: fromStop.lng },
    to:   { id: toStop.id,   name: toStop.name,   lat: toStop.lat,   lng: toStop.lng },
    walkingLegs: [],
    direct: (gtfsResult.direct || []).map(d => ({
      type: 'direct',
      route: { ...d.route, id: `route_${d.route.id}` },
      departure: d.departure,
      arrival: d.arrival,
      duration: d.duration,
      intermediateStops: d.intermediateStops,
      stops: transformStops(d.stops),
    })),
    transfers: (gtfsResult.transfers || []).map(t => ({
      type: 'transfer',
      leg1: { ...t.leg1, route: { ...t.leg1.route, id: `route_${t.leg1.route.id}` } },
      leg2: { ...t.leg2, route: { ...t.leg2.route, id: `route_${t.leg2.route.id}` } },
      transfer: t.transfer,
      totalDuration: t.totalDuration,
    })),
    message: gtfsResult.error || gtfsResult.message,
  });
});

router.get('/map/routes', (req, res) => {
  const simplifiedRoutes = getSimplifiedRoutes();
  const geoRoutes = simplifiedRoutes.map(r => ({
    id: r.id, ref: r.ref, name: r.name, colour: r.colour, active: r.active, geometry: r.geometry,
  }));
  res.json(geoRoutes);
});

function findNearestStops(lat, lng, maxMeters = 1000, simplifiedStops) {
  let bestStop = null;
  let bestDist = Infinity;
  for (const stop of simplifiedStops) {
    const d = haversineM(lat, lng, stop.lat, stop.lng);
    if (d < bestDist) {
      bestDist = d;
      bestStop = stop;
    }
  }
  return { stop: bestDist <= maxMeters ? bestStop : null, distanceM: Math.round(bestDist) };
}

module.exports = router;
