require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { randomUUID: uuidv4 } = require('crypto');
const jwt = require('jsonwebtoken');
const fetch = require('node-fetch');

const connectDB = require('./db');
const User = require('./models/User');
const Ticket = require('./models/Ticket');
const Alert = require('./models/Alert');
const Report = require('./models/Report');

const app = express();
app.use(cors());
app.use(express.json());

const JWT_SECRET = process.env.JWT_SECRET || 'tirana-transit-secret-2024';
const ORS_API_KEY = process.env.ORS_API_KEY || '';

// ─── LOAD INSTITUTIONS DATA ──────────────────────────────────────────────────
const institutionsPath = path.join(__dirname, 'institutions.json');
const institutions = JSON.parse(fs.readFileSync(institutionsPath, 'utf-8'));
console.log(`Loaded ${institutions.length} institutions`);

// ─── LOAD AND PARSE THE GEOJSON FILE ─────────────────────────────────────────
const geojsonPath = path.join(__dirname, 'export.geojson');
const geojson = JSON.parse(fs.readFileSync(geojsonPath, 'utf-8'));
const allFeatures = geojson.features;

console.log(`Loaded GeoJSON: ${allFeatures.length} features`);

// ─── PARSE ROUTES ────────────────────────────────────────────────────────────
const realRoutes = allFeatures
  .filter(f => f.properties.type === 'route')
  .map(f => {
    const p = f.properties;
    const ref = p.ref || p.name?.match(/Bus ([^:]+):/)?.[1] || 'UNK';
    return {
      id: p['@id'],
      ref,
      name: p.name || '',
      from: p.from || '',
      to: p.to || '',
      via: p.via || '',
      colour: p.colour || '#888888',
      interval: p.interval || '',
      active: true,
      geometry: f.geometry,
    };
  });

console.log(`Parsed ${realRoutes.length} routes`);

// ─── PARSE STOPS ─────────────────────────────────────────────────────────────
const realStops = allFeatures
  .filter(f => f.geometry?.type === 'Point' && f.properties.name)
  .map(f => {
    const p = f.properties;
    const [lng, lat] = f.geometry.coordinates;

    const routesAtStop = (p['@relations'] || [])
      .map(rel => ({
        ref: rel.reltags?.ref || null,
        colour: rel.reltags?.colour || '#888888',
        name: rel.reltags?.name || '',
      }))
      .filter(r => r.ref);

    return {
      id: p['@id'],
      name: p.name,
      lat,
      lng,
      shelter: p.shelter === 'yes',
      wheelchair: p.wheelchair === 'yes',
      bench: p.bench === 'yes',
      lit: p.lit === 'yes',
      routes: routesAtStop,
    };
  });

console.log(`Parsed ${realStops.length} stops`);

function stopRouteRefs(stop) {
  return new Set((stop.routes || []).map((r) => r.ref).filter(Boolean));
}

function routeByRef(ref) {
  return realRoutes.find((r) => r.ref === ref);
}

// ─── VEHICLES IN MEMORY ──────────────────────────────────────────────────────
const vehicles = (() => {
  const activeRoutes = realRoutes.filter(r => r.active).slice(0, 6);
  const statuses = ['moving', 'moving', 'stopped', 'moving', 'maintenance', 'moving'];
  const crowds = ['medium', 'high', 'low', 'medium', 'empty', 'low'];
  return activeRoutes.map((route, i) => ({
    id: `v${i + 1}`,
    plate: `TR-00${i + 1}-${String.fromCharCode(65 + i * 2)}${String.fromCharCode(66 + i * 2)}`,
    routeId: route.id,
    lat: 41.3275 + (Math.random() - 0.5) * 0.05,
    lng: 19.8187 + (Math.random() - 0.5) * 0.05,
    speed: statuses[i] === 'moving' ? Math.floor(25 + Math.random() * 30) : 0,
    status: statuses[i],
    crowdLevel: crowds[i],
    nextStop: null,
    eta: statuses[i] === 'moving' ? Math.floor(2 + Math.random() * 8) : null,
  }));
})();

// Simulate vehicle movement
setInterval(() => {
  vehicles.forEach(v => {
    if (v.status === 'moving') {
      v.lat += (Math.random() - 0.5) * 0.001;
      v.lng += (Math.random() - 0.5) * 0.001;
      v.speed = Math.floor(20 + Math.random() * 50);
      v.eta = Math.max(0, (v.eta || 5) - 1 + Math.floor(Math.random() * 2));
    }
  });
}, 5000);

// ─── HELPERS ─────────────────────────────────────────────────────────────────
const auth = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch { res.status(401).json({ error: 'Invalid token' }); }
};

const adminOnly = (req, res, next) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  next();
};

// ─── AUTH ROUTES (MongoDB) ───────────────────────────────────────────────────
app.post('/api/auth/register', async (req, res) => {
  try {
    const { name, email, password } = req.body;
    let user = await User.findOne({ email: email.toLowerCase() });
    if (user) return res.status(400).json({ error: 'Email already exists' });

    user = new User({ name, email, password });
    await user.save();

    const token = jwt.sign({ id: user._id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user: user.toSafeObject() });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email: email.toLowerCase() });

    if (!user || !(await user.comparePassword(password))) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign({ id: user._id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user: user.toSafeObject() });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/auth/me', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(user.toSafeObject());
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── ROUTES API ──────────────────────────────────────────────────────────────
app.get('/api/routes', (req, res) => {
  const lightweight = realRoutes.map(r => ({
    id: r.id,
    ref: r.ref,
    name: r.name,
    from: r.from,
    to: r.to,
    via: r.via,
    colour: r.colour,
    interval: r.interval,
    active: r.active,
  }));
  res.json(lightweight);
});

app.get('/api/routes/:id', (req, res) => {
  const route = realRoutes.find(r => r.id === req.params.id);
  if (!route) return res.status(404).json({ error: 'Route not found' });
  res.json(route);
});

// ─── STOPS API ───────────────────────────────────────────────────────────────
app.get('/api/stops', (req, res) => {
  const { q, route } = req.query;
  let results = realStops;

  if (q) {
    const query = q.toLowerCase();
    results = results.filter(s => s.name.toLowerCase().includes(query));
  }
  if (route) {
    results = results.filter(s => s.routes.some(r => r.ref === route));
  }
  res.json(results);
});

// ─── JOURNEY PLANNER ─────────────────────────────────────────────────────────
app.post('/api/journey/plan', (req, res) => {
  const { fromStopId, toStopId } = req.body || {};
  const fromStop = realStops.find((s) => s.id === fromStopId);
  const toStop = realStops.find((s) => s.id === toStopId);

  if (!fromStop || !toStop) return res.status(400).json({ error: 'Invalid fromStopId or toStopId' });

  if (fromStopId === toStopId) {
    return res.json({
      fromStop: { id: fromStop.id, name: fromStop.name, lat: fromStop.lat, lng: fromStop.lng },
      toStop: { id: toStop.id, name: toStop.name, lat: toStop.lat, lng: toStop.lng },
      direct: [], transfers: [], message: 'Origin and destination are the same stop.',
    });
  }

  const fromRefs = stopRouteRefs(fromStop);
  const toRefs = stopRouteRefs(toStop);
  const directRefs = [...fromRefs].filter((ref) => toRefs.has(ref));

  const direct = directRefs.map((ref) => {
    const route = routeByRef(ref);
    return { routeId: route?.id, ref, name: route?.name || ref, colour: route?.colour || '#888888' };
  });

  const transfers = [];
  const seen = new Set();

  for (const mid of realStops) {
    if (mid.id === fromStop.id || mid.id === toStop.id) continue;
    const midRefs = stopRouteRefs(mid);
    if (midRefs.size === 0) continue;

    for (const r1 of fromStop.routes || []) {
      if (!r1.ref || !midRefs.has(r1.ref)) continue;
      for (const r2 of toStop.routes || []) {
        if (!r2.ref || !midRefs.has(r2.ref)) continue;
        if (r1.ref === r2.ref) continue;

        const key = `${mid.id}|${r1.ref}|${r2.ref}`;
        if (seen.has(key)) continue;
        seen.add(key);

        const routeA = routeByRef(r1.ref);
        const routeB = routeByRef(r2.ref);
        transfers.push({
          viaStopId: mid.id,
          viaStopName: mid.name,
          viaLat: mid.lat,
          viaLng: mid.lng,
          leg1: { routeId: routeA?.id, ref: r1.ref, name: routeA?.name || r1.ref, colour: routeA?.colour || r1.colour || '#888888' },
          leg2: { routeId: routeB?.id, ref: r2.ref, name: routeB?.name || r2.ref, colour: routeB?.colour || r2.colour || '#888888' },
        });
      }
    }
  }

  const transfersLimited = transfers.slice(0, 60);
  res.json({
    fromStop: { id: fromStop.id, name: fromStop.name, lat: fromStop.lat, lng: fromStop.lng },
    toStop: { id: toStop.id, name: toStop.name, lat: toStop.lat, lng: toStop.lng },
    direct,
    transfers: transfersLimited,
    message: direct.length === 0 && transfersLimited.length === 0 ? 'No direct route or single-transfer path found.' : null,
  });
});

// ─── MAP GEOMETRY API ────────────────────────────────────────────────────────
app.get('/api/map/routes', (req, res) => {
  const geoRoutes = realRoutes.map(r => ({
    id: r.id, ref: r.ref, name: r.name, colour: r.colour, active: r.active, geometry: r.geometry,
  }));
  res.json(geoRoutes);
});

// ─── SIMULATED ROUTE PLANNER ─────────────────────────────────────────────────
app.post('/api/routes/plan', (req, res) => {
  const { from, to, fromStopId, toStopId } = req.body;

  if (fromStopId && toStopId) {
    const fromStop = realStops.find(s => s.id === fromStopId);
    const toStop = realStops.find(s => s.id === toStopId);
    if (fromStop && toStop) {
      const fromRefs = new Set(fromStop.routes.map(r => r.ref));
      const directRefs = toStop.routes.filter(r => fromRefs.has(r.ref)).map(r => r.ref);
      const directOptions = directRefs.map(ref => {
        const route = realRoutes.find(r => r.ref === ref);
        return { routeId: route?.id, routeRef: ref, routeName: route?.name || ref, colour: route?.colour || '#888', type: 'direct', transfers: 0 };
      });
      return res.json({ from: fromStop.name, to: toStop.name, options: directOptions, message: directOptions.length === 0 ? 'No direct route found.' : null });
    }
  }

  const options = realRoutes.filter(r => r.active).slice(0, 3).map((r, i) => ({
    routeId: r.id,
    routeNumber: r.ref,
    routeName: r.name,
    color: r.colour,
    departureTime: new Date(Date.now() + (i * 5 + 3) * 60000).toTimeString().slice(0, 5),
    arrivalTime: new Date(Date.now() + (i * 5 + 3 + 28) * 60000).toTimeString().slice(0, 5),
    duration: 28 + i * 3,
    transfers: i,
    price: 40 + i * 20,
    crowdLevel: ['low', 'medium', 'high'][Math.floor(Math.random() * 3)],
    walkingMinutes: i * 4 + 2,
  }));
  res.json({ from, to, options });
});

// ─── VEHICLES / TRACKING ─────────────────────────────────────────────────────
app.get('/api/vehicles', auth, (req, res) => {
  const { routeId } = req.query;
  let matches = vehicles;
  if (routeId) matches = matches.filter(v => v.routeId === routeId);
  res.json(matches);
});

app.get('/api/tracking', (req, res) => {
  res.json(vehicles.map(v => ({
    ...v,
    route: realRoutes.find(r => r.id === v.routeId),
  })));
});

// ─── TICKETS (MongoDB) ───────────────────────────────────────────────────────
app.get('/api/tickets', auth, async (req, res) => {
  try {
    const userTickets = await Ticket.find({ userId: req.user.id });
    const response = userTickets.map(t => {
      const ticketObj = t.toObject();
      return {
        ...ticketObj,
        id: ticketObj._id, // frontend uses 'id'
        route: ticketObj.routeId ? realRoutes.find(r => r.id === ticketObj.routeId) : null
      };
    });
    res.json(response);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/tickets/purchase', auth, async (req, res) => {
  try {
    const { type, routeId } = req.body;
    const prices = { single: 40, daily: 150, weekly: 600, monthly: 2500 };
    const price = prices[type] || 40;

    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.balance < price) return res.status(400).json({ error: 'Insufficient balance' });

    // Deduct balance
    user.balance -= price;
    await user.save();

    const expiresAt = type === 'single' ? new Date(Date.now() + 4 * 3600000)
      : type === 'daily' ? new Date(Date.now() + 24 * 3600000)
        : type === 'weekly' ? new Date(Date.now() + 7 * 24 * 3600000)
          : new Date(Date.now() + 30 * 24 * 3600000);

    const ticket = new Ticket({
      userId: req.user.id,
      type,
      routeId: routeId || null,
      price,
      status: 'active',
      qrCode: `TT-${Date.now()}-${Math.random().toString(36).substr(2, 6).toUpperCase()}`,
      expiresAt
    });
    await ticket.save();

    res.json({ ticket: { ...ticket.toObject(), id: ticket._id }, newBalance: user.balance });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/wallet/topup', auth, async (req, res) => {
  try {
    const { amount } = req.body;
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    user.balance += amount;
    await user.save();
    res.json({ balance: user.balance });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── ALERTS (MongoDB) ────────────────────────────────────────────────────────
app.get('/api/alerts', async (req, res) => {
  try {
    const alerts = await Alert.find().sort({ createdAt: -1 });
    res.json(alerts.map(a => ({ ...a.toObject(), id: a._id })));
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/alerts', auth, adminOnly, async (req, res) => {
  try {
    const alert = new Alert({ ...req.body });
    await alert.save();
    res.json({ ...alert.toObject(), id: alert._id });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── REPORTS (MongoDB) ───────────────────────────────────────────────────────
app.post('/api/reports', auth, async (req, res) => {
  try {
    const report = new Report({ userId: req.user.id, ...req.body });
    await report.save();
    res.json({ ...report.toObject(), id: report._id });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/reports', auth, adminOnly, async (req, res) => {
  try {
    const reports = await Report.find();
    res.json(reports.map(r => ({ ...r.toObject(), id: r._id })));
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── ADMIN ANALYTICS (MongoDB) ───────────────────────────────────────────────
app.get('/api/admin/analytics', auth, adminOnly, async (req, res) => {
  try {
    const totalUsers = await User.countDocuments();
    const totalTicketsSold = await Ticket.countDocuments();
    const tickets = await Ticket.find();
    const revenue = tickets.reduce((sum, t) => sum + t.price, 0);
    const activeAlerts = await Alert.countDocuments();
    const pendingReports = await Report.countDocuments({ status: 'pending' });

    res.json({
      totalUsers,
      totalRoutes: realRoutes.length,
      activeRoutes: realRoutes.filter(r => r.active).length,
      totalStops: realStops.length,
      totalVehicles: vehicles.length,
      movingVehicles: vehicles.filter(v => v.status === 'moving').length,
      totalTicketsSold,
      revenue,
      activeAlerts,
      pendingReports,
      dailyRidership: [
        { day: 'Mon', riders: 12400 },
        { day: 'Tue', riders: 13200 },
        { day: 'Wed', riders: 14100 },
        { day: 'Thu', riders: 13800 },
        { day: 'Fri', riders: 15600 },
        { day: 'Sat', riders: 9800 },
        { day: 'Sun', riders: 7200 },
      ],
      routePerformance: realRoutes.slice(0, 10).map(r => ({
        number: r.ref,
        name: r.from || r.name.split(':')[0],
        onTime: Math.floor(75 + Math.random() * 20),
        ridership: Math.floor(1000 + Math.random() * 5000),
        revenue: Math.floor(40000 + Math.random() * 200000),
      })),
    });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/admin/users', auth, adminOnly, async (req, res) => {
  try {
    const users = await User.find({}, '-password');
    res.json(users.map(u => u.toSafeObject()));
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/admin/vehicles', auth, adminOnly, (req, res) => {
  res.json(vehicles.map(v => ({ ...v, route: realRoutes.find(r => r.id === v.routeId) })));
});

app.patch('/api/admin/routes/:id', auth, adminOnly, (req, res) => {
  const route = realRoutes.find(r => r.id === req.params.id);
  if (!route) return res.status(404).json({ error: 'Route not found' });
  Object.assign(route, req.body);
  res.json(route);
});

// ─── GEOCODING PROXY ─────────────────────────────────────────────────────────
app.get('/api/geocode', async (req, res) => {
  const { q } = req.query;
  if (!q || q.trim().length < 2) return res.status(400).json({ error: 'Query too short' });

  try {
    const params = new URLSearchParams({
      q: q.trim(), format: 'json', addressdetails: '1', limit: '5',
      viewbox: '19.70,41.38,19.92,41.28', bounded: '1',
    });
    const response = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, {
      headers: { 'User-Agent': 'TiranaTransitApp/1.0 (student-project)' },
    });
    const data = await response.json();
    res.json(data.map(item => ({
      lat: parseFloat(item.lat), lng: parseFloat(item.lon), display_name: item.display_name, type: item.type,
    })));
  } catch (err) {
    res.status(502).json({ error: 'Geocoding service unavailable' });
  }
});

// ─── NEAREST STOP ────────────────────────────────────────────────────────────
function haversineM(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = d => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

app.post('/api/nearest-stop', (req, res) => {
  const { lat, lng } = req.body;
  if (lat == null || lng == null) return res.status(400).json({ error: 'lat and lng are required' });

  let bestStop = null;
  let bestDist = Infinity;
  for (const stop of realStops) {
    const d = haversineM(lat, lng, stop.lat, stop.lng);
    if (d < bestDist) {
      bestDist = d;
      bestStop = stop;
    }
  }

  res.json({
    stop: bestStop,
    distanceM: Math.round(bestDist),
    withinRadius: bestDist <= 500,
    message: !bestStop || bestDist > 500 ? 'No stops found within 500 m' : null,
  });
});

// ─── WALKING ROUTE (OpenRouteService) ────────────────────────────────────────
app.post('/api/walking-route', async (req, res) => {
  const { from, to } = req.body;
  if (!from || !to || from.length < 2 || to.length < 2) return res.status(400).json({ error: 'invalid from/to' });
  if (!ORS_API_KEY) return res.status(500).json({ error: 'ORS_API_KEY not configured' });

  try {
    const url = 'https://api.openrouteservice.org/v2/directions/foot-walking/geojson';
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': ORS_API_KEY },
      body: JSON.stringify({ coordinates: [from, to] }),
    });

    if (!response.ok) return res.status(502).json({ error: 'Walking route service error' });

    const data = await response.json();
    const feature = data.features?.[0];
    if (!feature) return res.status(404).json({ error: 'No walking route found' });

    res.json({
      geometry: feature.geometry,
      distance_m: Math.round(feature.properties?.summary?.distance || 0),
      duration_s: Math.round(feature.properties?.summary?.duration || 0),
    });
  } catch (err) {
    res.status(502).json({ error: 'Walking route service unavailable' });
  }
});

// ─── INSTITUTIONS ────────────────────────────────────────────────────────────
app.get('/api/institutions', (req, res) => {
  const { type } = req.query;
  if (type) return res.json(institutions.filter(i => i.type === type));
  res.json(institutions);
});

// ─── START SERVER ────────────────────────────────────────────────────────────
const PORT = 3001;

// Connect to MongoDB, then start Express
connectDB().then(() => {
  app.listen(PORT, () => {
    console.log(`Tirana Transit API running on http://localhost:${PORT}`);
    console.log(`  Routes: ${realRoutes.length}`);
    console.log(`  Stops:  ${realStops.length}`);
    console.log(`  Institutions: ${institutions.length}`);
  });
});