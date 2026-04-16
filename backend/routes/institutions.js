const express = require('express');
const fs = require('fs');
const path = require('path');

const router = express.Router();

const institutionsPath = path.join(__dirname, '..', 'institutions.json');
const institutions = JSON.parse(fs.readFileSync(institutionsPath, 'utf-8'));

router.get('/', (req, res) => {
  const { type } = req.query;
  if (type) return res.json(institutions.filter(i => i.type === type));
  res.json(institutions);
});

module.exports = router;
