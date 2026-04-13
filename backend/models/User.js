const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  name:     { type: String, required: true, trim: true },
  email:    { type: String, required: true, unique: true, lowercase: true, trim: true },
  password: { type: String, required: true },
  role:     { type: String, enum: ['passenger', 'admin'], default: 'passenger' },
  balance:  { type: Number, default: 0 },
  joinedAt: { type: Date, default: Date.now },
});

// Hash password before saving (only if modified)
userSchema.pre('save', async function () {
  if (!this.isModified('password')) return;
  this.password = await bcrypt.hash(this.password, 10);
});

// Compare candidate password with stored hash
userSchema.methods.comparePassword = async function (candidate) {
  return bcrypt.compare(candidate, this.password);
};

// Strip password when converting to JSON
userSchema.methods.toSafeObject = function () {
  const { _id, name, email, role, balance, joinedAt } = this;
  return { id: _id, name, email, role, balance, joinedAt };
};

module.exports = mongoose.model('User', userSchema);
