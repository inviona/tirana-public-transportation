const express = require('express');
const { getSimplifiedRoutes } = require('../services/gtfsService');

const router = express.Router();

router.get('/', (req, res) => {
  const simplifiedRoutes = getSimplifiedRoutes();
  const lightweight = simplifiedRoutes.map(r => ({
    id: r.id,
    ref: r.ref,
    name: r.name,
    from: r.from,
    to: r.to,
    via: r.via,
    colour: r.colour,
    interval: r.interval,
    active: r.active,
  }));
  res.json(lightweight);
});

router.get('/:id', (req, res) => {
  const simplifiedRoutes = getSimplifiedRoutes();
  const route = simplifiedRoutes.find(r => r.id === req.params.id);
  if (!route) return res.status(404).json({ error: 'Route not found' });
  res.json(route);
});

router.post('/plan', (req, res) => {
  const { from, to, fromStopId, toStopId } = req.body;
  const simplifiedRoutes = getSimplifiedRoutes();

  if (fromStopId && toStopId) {
    const { getSimplifiedStops } = require('../services/gtfsService');
    const simplifiedStops = getSimplifiedStops();
    const fromStop = simplifiedStops.find(s => s.id === fromStopId);
    const toStop = simplifiedStops.find(s => s.id === toStopId);
    if (fromStop && toStop) {
      const fromRefs = new Set(fromStop.routes.map(r => r.ref));
      const directRefs = toStop.routes.filter(r => fromRefs.has(r.ref)).map(r => r.ref);
      const directOptions = directRefs.map(ref => {
        const route = simplifiedRoutes.find(r => r.ref === ref);
        return { routeId: route?.id, routeRef: ref, routeName: route?.name || ref, colour: route?.colour || '#888', type: 'direct', transfers: 0 };
      });
      return res.json({ from: fromStop.name, to: toStop.name, options: directOptions, message: directOptions.length === 0 ? 'No direct route found.' : null });
    }
  }

  const options = simplifiedRoutes.filter(r => r.active).slice(0, 3).map((r, i) => ({
    routeId: r.id,
    routeNumber: r.ref,
    routeName: r.name,
    color: r.colour,
    departureTime: new Date(Date.now() + (i * 5 + 3) * 60000).toTimeString().slice(0, 5),
    arrivalTime: new Date(Date.now() + (i * 5 + 3 + 28) * 60000).toTimeString().slice(0, 5),
    duration: 28 + i * 3,
    transfers: i,
    price: 40 + i * 20,
    crowdLevel: ['low', 'medium', 'high'][Math.floor(Math.random() * 3)],
    walkingMinutes: i * 4 + 2,
  }));
  res.json({ from, to, options });
});

module.exports = router;
