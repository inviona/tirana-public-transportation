const express = require('express');
const auth = require('../middleware/auth');
const adminOnly = require('../middleware/adminOnly');
const Report = require('../models/Report');

const router = express.Router();

router.post('/', auth, async (req, res) => {
  try {
    const report = new Report({ userId: req.user.id, ...req.body });
    await report.save();
    res.json({ ...report.toObject(), id: report._id });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/', auth, adminOnly, async (req, res) => {
  try {
    const reports = await Report.find();
    res.json(reports.map(r => ({ ...r.toObject(), id: r._id })));
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
