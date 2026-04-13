const mongoose = require('mongoose');

const alertSchema = new mongoose.Schema({
  type:      { type: String, enum: ['delay', 'disruption', 'maintenance', 'info'], required: true },
  routeId:   { type: String, default: null },
  message:   { type: String, required: true },
  severity:  { type: String, enum: ['low', 'medium', 'high'], default: 'medium' },
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model('Alert', alertSchema);
