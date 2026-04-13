const mongoose = require('mongoose');

const ticketSchema = new mongoose.Schema({
  userId:      { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  type:        { type: String, enum: ['single', 'daily', 'weekly', 'monthly'], required: true },
  routeId:     { type: String, default: null },
  price:       { type: Number, required: true },
  status:      { type: String, enum: ['active', 'used', 'expired'], default: 'active' },
  qrCode:      { type: String },
  purchasedAt: { type: Date, default: Date.now },
  expiresAt:   { type: Date },
});

module.exports = mongoose.model('Ticket', ticketSchema);
