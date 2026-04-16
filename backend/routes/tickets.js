const express = require('express');
const auth = require('../middleware/auth');
const User = require('../models/User');
const Ticket = require('../models/Ticket');
const { TICKET_PRICES } = require('../config/constants');

const router = express.Router();

router.get('/', auth, async (req, res) => {
  try {
    const userTickets = await Ticket.find({ userId: req.user.id });
    const { getSimplifiedRoutes } = require('../services/gtfsService');
    const simplifiedRoutes = getSimplifiedRoutes();
    const response = userTickets.map(t => {
      const ticketObj = t.toObject();
      return {
        ...ticketObj,
        id: ticketObj._id,
        route: ticketObj.routeId ? simplifiedRoutes.find(r => r.id === ticketObj.routeId) : null
      };
    });
    res.json(response);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/purchase', auth, async (req, res) => {
  try {
    const { type, routeId } = req.body;
    const price = TICKET_PRICES[type] || 40;

    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.balance < price) return res.status(400).json({ error: 'Insufficient balance' });

    user.balance -= price;
    await user.save();

    const expiresAt = type === 'single' ? new Date(Date.now() + 4 * 3600000)
      : type === 'daily' ? new Date(Date.now() + 24 * 3600000)
        : type === 'weekly' ? new Date(Date.now() + 7 * 24 * 3600000)
          : new Date(Date.now() + 30 * 24 * 3600000);

    const ticket = new Ticket({
      userId: req.user.id,
      type,
      routeId: routeId || null,
      price,
      status: 'active',
      qrCode: `TT-${Date.now()}-${Math.random().toString(36).substr(2, 6).toUpperCase()}`,
      expiresAt
    });
    await ticket.save();

    res.json({ ticket: { ...ticket.toObject(), id: ticket._id }, newBalance: user.balance });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
