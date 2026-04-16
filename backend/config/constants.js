module.exports = {
  JWT_SECRET: process.env.JWT_SECRET || 'tirana-transit-secret-2024',
  ORS_API_KEY: process.env.ORS_API_KEY || '',
  GTFS_CACHE: require('path').join(__dirname, '..', 'gtfs_cache.json'),
  TOPUP_AMOUNTS: [200, 500, 1000, 2000, 5000],
  TICKET_PRICES: { single: 40, daily: 150, weekly: 600, monthly: 2500 },
  JWT_EXPIRY: '7d',
  PORT: 3001,
};
