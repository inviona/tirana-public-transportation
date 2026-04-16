const express = require('express');
const auth = require('../middleware/auth');
const User = require('../models/User');
const { TOPUP_AMOUNTS } = require('../config/constants');

const router = express.Router();

router.post('/topup', auth, async (req, res) => {
  try {
    const { amount } = req.body;
    if (!TOPUP_AMOUNTS.includes(amount)) {
      return res.status(400).json({ error: 'Invalid topup amount' });
    }
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    user.balance += amount;
    await user.save();
    res.json({ balance: user.balance });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
