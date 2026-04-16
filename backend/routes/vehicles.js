const express = require('express');
const auth = require('../middleware/auth');
const { getVehicles, findNearestStopsForVehicle } = require('../services/vehicleService');
const { getSimplifiedRoutes, getSimplifiedStops } = require('../services/gtfsService');

const router = express.Router();

router.get('/', auth, (req, res) => {
  const { routeId } = req.query;
  let matches = getVehicles();
  if (routeId) matches = matches.filter(v => v.routeId === routeId);
  res.json(matches);
});

router.get('/tracking', (req, res) => {
  const vehicles = getVehicles();
  const simplifiedRoutes = getSimplifiedRoutes();
  res.json(vehicles.map(v => ({
    ...v,
    route: simplifiedRoutes.find(r => r.id === v.routeId),
  })));
});

module.exports = router;
