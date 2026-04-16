require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const express = require('express');
const cors = require('cors');

const connectDB = require('./db');
const { PORT } = require('./config/constants');
const { initGTFS, refreshGTFS, getSimplifiedRoutes, getSimplifiedStops } = require('./services/gtfsService');
const { initializeVehicles, startVehicleUpdates } = require('./services/vehicleService');

const routes = require('./routes');

const app = express();
app.use(cors());
app.use(express.json());

app.use('/api/auth', routes.auth);
app.use('/api/routes', routes.routes);
app.use('/api/transit', routes.transit);
app.use('/api/vehicles', routes.vehicles);
app.use('/api/tickets', routes.tickets);
app.use('/api/wallet', routes.wallet);
app.use('/api/payments', routes.payments);
app.use('/api/alerts', routes.alerts);
app.use('/api/reports', routes.reports);
app.use('/api/admin', routes.admin);
app.use('/api/geocode', routes.geocode);
app.use('/api/nearest-stop', routes.nearestStop);
app.use('/api/walking-route', routes.walkingRoute);
app.use('/api/institutions', routes.institutions);
app.use('/api/chat', routes.chat);
app.use('/api/journey', routes.journey);

app.get('/api/stops', (req, res) => {
  const simplifiedStops = getSimplifiedStops();
  const { q, route } = req.query;
  let results = simplifiedStops;
  if (q) results = results.filter(s => s.name.toLowerCase().includes(q.toLowerCase()));
  if (route) results = results.filter(s => s.routes.some(r => r.ref === route));
  res.json(results);
});

async function startServer() {
  await connectDB();
  await initGTFS();
  const simplifiedRoutes = getSimplifiedRoutes();
  const simplifiedStops = getSimplifiedStops();
  initializeVehicles(simplifiedRoutes, simplifiedStops);
  startVehicleUpdates(simplifiedRoutes, simplifiedStops);

  const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;
  setInterval(async () => {
    console.log('[Server] Weekly GTFS refresh triggered...');
    try {
      await refreshGTFS();
      console.log('[Server] Weekly refresh complete.');
    } catch (err) {
      console.error(`[Server] Weekly refresh failed: ${err.message}`);
    }
  }, ONE_WEEK_MS);

  app.listen(PORT, () => {
    console.log(`\nTirana Transit API running on http://localhost:${PORT}`);
    console.log(`  Stops:  ${simplifiedStops.length}`);
    if (simplifiedRoutes.length > 0) {
      console.log(`  Routes: ${simplifiedRoutes.length}`);
    }
  });
}

startServer().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
