const mongoose = require('mongoose');
const User = require('./models/User');

/**
 * Connect to MongoDB and seed the admin account if it doesn't exist.
 * Call this before app.listen() so the server only starts after DB is ready.
 */
async function connectDB() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGODB_URI is not set in .env — cannot start server.');
    process.exit(1);
  }

  try {
    await mongoose.connect(uri);
    console.log('✓ Connected to MongoDB Atlas');

    // ─── Seed admin account if none exists ─────────────────────────────────
    const adminExists = await User.findOne({ role: 'admin' });
    if (!adminExists) {
      const admin = new User({
        name: 'Admin Tirana',
        email: 'admin@transit.al',
        password: 'admin123',       // hashed automatically by the pre-save hook
        role: 'admin',
        balance: 0,
      });
      await admin.save();
      console.log('✓ Admin account seeded: admin@transit.al / admin123');
    } else {
      console.log(`✓ Admin account already exists: ${adminExists.email}`);
    }
  } catch (err) {
    console.error('MongoDB connection error:', err.message);
    process.exit(1);
  }
}

module.exports = connectDB;
