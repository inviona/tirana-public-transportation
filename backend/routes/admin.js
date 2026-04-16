const express = require('express');
const auth = require('../middleware/auth');
const adminOnly = require('../middleware/adminOnly');
const User = require('../models/User');
const Ticket = require('../models/Ticket');
const Alert = require('../models/Alert');
const Report = require('../models/Report');
const { getSimplifiedRoutes, getSimplifiedStops } = require('../services/gtfsService');
const { getVehicles } = require('../services/vehicleService');

const router = express.Router();

router.get('/analytics', auth, adminOnly, async (req, res) => {
  try {
    const totalUsers = await User.countDocuments();
    const totalTicketsSold = await Ticket.countDocuments();
    const tickets = await Ticket.find();
    const revenue = tickets.reduce((sum, t) => sum + t.price, 0);
    const activeAlerts = await Alert.countDocuments();
    const pendingReports = await Report.countDocuments({ status: 'pending' });

    const simplifiedRoutes = getSimplifiedRoutes();
    const simplifiedStops = getSimplifiedStops();
    const vehicles = getVehicles();

    res.json({
      totalUsers,
      totalRoutes: simplifiedRoutes.length,
      activeRoutes: simplifiedRoutes.filter(r => r.active).length,
      totalStops: simplifiedStops.length,
      totalVehicles: vehicles.length,
      movingVehicles: vehicles.filter(v => v.status === 'moving').length,
      totalTicketsSold,
      revenue,
      activeAlerts,
      pendingReports,
      dailyRidership: [
        { day: 'Mon', riders: 12400 },
        { day: 'Tue', riders: 13200 },
        { day: 'Wed', riders: 14100 },
        { day: 'Thu', riders: 13800 },
        { day: 'Fri', riders: 15600 },
        { day: 'Sat', riders: 9800 },
        { day: 'Sun', riders: 7200 },
      ],
      routePerformance: simplifiedRoutes.slice(0, 10).map(r => ({
        number: r.ref,
        name: r.from || r.name.split(':')[0],
        onTime: Math.floor(75 + Math.random() * 20),
        ridership: Math.floor(1000 + Math.random() * 5000),
        revenue: Math.floor(40000 + Math.random() * 200000),
      })),
    });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/users', auth, adminOnly, async (req, res) => {
  try {
    const users = await User.find({}, '-password');
    res.json(users.map(u => u.toSafeObject()));
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/vehicles', auth, adminOnly, (req, res) => {
  const vehicles = getVehicles();
  const simplifiedRoutes = getSimplifiedRoutes();
  res.json(vehicles.map(v => ({ ...v, route: simplifiedRoutes.find(r => r.id === v.routeId) })));
});

router.patch('/routes/:id', auth, adminOnly, (req, res) => {
  const simplifiedRoutes = getSimplifiedRoutes();
  const route = simplifiedRoutes.find(r => r.id === req.params.id);
  if (!route) return res.status(404).json({ error: 'Route not found' });
  Object.assign(route, req.body);
  res.json(route);
});

module.exports = router;
