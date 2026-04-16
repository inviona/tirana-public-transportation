const express = require('express');
const auth = require('../middleware/auth');
const User = require('../models/User');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { TOPUP_AMOUNTS } = require('../config/constants');

const router = express.Router();

router.post('/create-intent', auth, async (req, res) => {
  try {
    const { amount } = req.body;
    if (!TOPUP_AMOUNTS.includes(amount)) {
      return res.status(400).json({ error: 'Invalid topup amount. Choose: ' + TOPUP_AMOUNTS.join(', ') });
    }

    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const paymentIntent = await stripe.paymentIntents.create({
      amount: amount * 100,
      currency: 'eur',
      automatic_payment_methods: { enabled: true },
      metadata: {
        userId: req.user.id.toString(),
        userEmail: user.email,
        topupAmount: amount.toString(),
      },
    });

    res.json({ clientSecret: paymentIntent.client_secret, amount });
  } catch (err) {
    console.error('Stripe create-intent error:', err.message);
    res.status(500).json({ error: 'Payment initialization failed: ' + err.message });
  }
});

router.post('/confirm', auth, async (req, res) => {
  try {
    const { paymentIntentId } = req.body;

    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);

    if (paymentIntent.status !== 'succeeded') {
      return res.status(400).json({ error: 'Payment not completed', status: paymentIntent.status });
    }

    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const topupAmount = parseInt(paymentIntent.metadata.topupAmount) || 0;
    user.balance += topupAmount;
    await user.save();

    res.json({ success: true, balance: user.balance, topupAmount });
  } catch (err) {
    console.error('Stripe confirm error:', err.message);
    res.status(500).json({ error: 'Payment confirmation failed: ' + err.message });
  }
});

router.get('/config', (req, res) => {
  res.json({
    publishableKey: process.env.STRIPE_PUBLISHABLE_KEY || '',
    topupAmounts: TOPUP_AMOUNTS,
  });
});

module.exports = router;
