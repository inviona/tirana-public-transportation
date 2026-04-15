require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');
const fetch = require('node-fetch');

const connectDB = require('./db');
const User = require('./models/User');
const Ticket = require('./models/Ticket');
const Alert = require('./models/Alert');
const Report = require('./models/Report');
const { GTFSData } = require('./gtfs_transit');
const { updateGTFS } = require('./gtfs_updater');

const app = express();
app.use(cors());
app.use(express.json());

const JWT_SECRET = process.env.JWT_SECRET || 'tirana-transit-secret-2024';
const ORS_API_KEY = process.env.ORS_API_KEY || '';
const GTFS_CACHE = path.join(__dirname, 'gtfs_cache.json');

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const TOPUP_AMOUNTS = [200, 500, 1000, 2000, 5000];

// ─── LOAD INSTITUTIONS DATA ──────────────────────────────────────────────────
const institutionsPath = path.join(__dirname, 'institutions.json');
const institutions = JSON.parse(fs.readFileSync(institutionsPath, 'utf-8'));
console.log(`[Server] Loaded ${institutions.length} institutions`);

// ─── GTFS STARTUP ───────────────────────────────────────────────────────────
let gtfs = null;
let simplifiedRoutes = [];
let simplifiedStops = [];

async function initGTFS() {
  try {
    await updateGTFS();

    gtfs = new GTFSData();
    gtfs.loadFromCache();

    const gtfsData = JSON.parse(fs.readFileSync(GTFS_CACHE, 'utf-8'));

    simplifiedRoutes = (gtfsData.routes || [])
      .filter(r => r.geometry)
      .map((r, i) => ({
        id: `route_${r.route_id}`,
        route_id: r.route_id,
        ref: r.route_short_name || `R${i}`,
        name: r.route_long_name || '',
        colour: r.route_color || '#4e9eff',
        active: true,
        geometry: r.geometry,
        stops: r.stops || [],
      }));

    simplifiedStops = (gtfsData.stops || []).map(s => ({
      id: `stop_${s.stop_id}`,
      stop_id: String(s.stop_id),
      name: s.stop_name || s.name || '',
      lat: parseFloat(s.stop_lat || s.lat || 0),
      lng: parseFloat(s.stop_lon || s.lng || 0),
      routes: s.routes || [],
    }));
    console.log(`[Server] simplifiedStops: ${simplifiedStops.length} stops for REST API`);
    console.log(`[Server] gtfs.stopsMap: ${gtfs.stopsMap.size} entries`);
    console.log(`[Server] gtfs.stopTimesByStop: ${gtfs.stopTimesByStop.size} entries`);
    console.log(`[Server] gtfs.activeServices: ${gtfs.activeServices.size}`);

  } catch (err) {
    console.error(`[Server] GTFS init failed: ${err.message}`);
  }
}

// ─── SCHEDULED WEEKLY REFRESH ───────────────────────────────────────────────
let weeklyTimer = null;
async function scheduleWeeklyRefresh() {
  const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;
  weeklyTimer = setInterval(async () => {
    console.log('[Server] Weekly GTFS refresh triggered...');
    try {
      await updateGTFS(true);
      if (gtfs) {
        gtfs.loadFromCache();
        const gtfsData = JSON.parse(fs.readFileSync(GTFS_CACHE, 'utf-8'));
        simplifiedRoutes = (gtfsData.routes || []).filter(r => r.geometry).map((r, i) => ({
          id: `route_${r.route_id}`, route_id: r.route_id,
          ref: r.route_short_name || `R${i}`, name: r.route_long_name || '',
          colour: r.route_color || '#4e9eff', active: true,
          geometry: r.geometry, stops: r.stops || [],
        }));
        simplifiedStops = (gtfsData.stops || []).map(s => ({
          id: `stop_${s.stop_id}`, stop_id: String(s.stop_id),
          name: s.stop_name || s.name || '',
          lat: parseFloat(s.stop_lat || s.lat || 0),
          lng: parseFloat(s.stop_lon || s.lng || 0),
          routes: s.routes || [],
        }));
        console.log('[Server] Weekly refresh complete.');
      }
    } catch (err) {
      console.error(`[Server] Weekly refresh failed: ${err.message}`);
    }
  }, ONE_WEEK_MS);
  console.log(`[Server] Weekly GTFS refresh scheduled (~7 days)`);
}

function stopRouteRefs(stop) {
  return new Set((stop.routes || []).map((r) => r.ref).filter(Boolean));
}

function routeByRef(ref) {
  return simplifiedRoutes.find((r) => r.ref === ref);
}

// ─── VEHICLES IN MEMORY ──────────────────────────────────────────────────────
let vehicles = [];

function haversineM(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = d => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

function findNearestStopsForVehicle(lat, lng, routeId) {
  const routeStops = simplifiedStops.filter(s => 
    s.routes && s.routes.some(r => r.ref === simplifiedRoutes.find(rout => rout.id === routeId)?.ref)
  );
  
  if (routeStops.length === 0) return { nextStop: null, prevStop: null, eta: null };
  
  const sortedStops = routeStops.sort((a, b) => 
    haversineM(lat, lng, a.lat, a.lng) - haversineM(lat, lng, b.lat, b.lng)
  );
  
  const nearest = sortedStops[0];
  const distance = haversineM(lat, lng, nearest.lat, nearest.lng);
  const etaMinutes = Math.max(1, Math.round(distance / 500));
  
  const nearestIndex = routeStops.findIndex(s => s.id === nearest.id);
  const prevStop = nearestIndex > 0 ? routeStops[nearestIndex - 1] : null;
  
  return {
    nextStop: nearest,
    prevStop,
    eta: etaMinutes
  };
}

function initializeVehicles() {
  const activeRoutes = simplifiedRoutes.filter(r => r.active).slice(0, 6);
  const statuses = ['moving', 'moving', 'stopped', 'moving', 'maintenance', 'moving'];
  const crowds = ['medium', 'high', 'low', 'medium', 'empty', 'low'];
  vehicles = activeRoutes.map((route, i) => {
    const lat = 41.3275 + (Math.random() - 0.5) * 0.05;
    const lng = 19.8187 + (Math.random() - 0.5) * 0.05;
    const stopInfo = findNearestStopsForVehicle(lat, lng, route.id);
    return {
      id: `v${i + 1}`,
      plate: `TR-00${i + 1}-${String.fromCharCode(65 + i * 2)}${String.fromCharCode(66 + i * 2)}`,
      routeId: route.id,
      lat,
      lng,
      speed: statuses[i] === 'moving' ? Math.floor(25 + Math.random() * 30) : 0,
      status: statuses[i],
      crowdLevel: crowds[i],
      nextStop: stopInfo.nextStop?.name || null,
      nextStopLat: stopInfo.nextStop?.lat || null,
      nextStopLng: stopInfo.nextStop?.lng || null,
      prevStop: stopInfo.prevStop?.name || null,
      eta: stopInfo.eta || null,
    };
  });
}

setInterval(() => {
  vehicles.forEach(v => {
    if (v.status === 'moving') {
      v.lat += (Math.random() - 0.5) * 0.001;
      v.lng += (Math.random() - 0.5) * 0.001;
      const stopInfo = findNearestStopsForVehicle(v.lat, v.lng, v.routeId);
      v.nextStop = stopInfo.nextStop?.name || null;
      v.nextStopLat = stopInfo.nextStop?.lat || null;
      v.nextStopLng = stopInfo.nextStop?.lng || null;
      v.prevStop = stopInfo.prevStop?.name || null;
      v.eta = stopInfo.eta || null;
      v.speed = Math.floor(20 + Math.random() * 50);
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
  const lightweight = simplifiedRoutes.map(r => ({
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
  const route = simplifiedRoutes.find(r => r.id === req.params.id);
  if (!route) return res.status(404).json({ error: 'Route not found' });
  res.json(route);
});

// ─── STOPS API ───────────────────────────────────────────────────────────────
app.get('/api/stops', (req, res) => {
  const { q, route } = req.query;
  let results = simplifiedStops;

  if (q) {
    const query = q.toLowerCase();
    results = results.filter(s => s.name.toLowerCase().includes(query));
  }
  if (route) {
    results = results.filter(s => s.routes.some(r => r.ref === route));
  }
  res.json(results);
});

// ─── JOURNEY PLANNER (legacy) ─────────────────────────────────────────────────
app.post('/api/journey/plan', (req, res) => {
  const { fromStopId, toStopId } = req.body || {};

  if (!gtfs) {
    return res.status(503).json({ error: 'GTFS data not loaded' });
  }

  const fromStop = simplifiedStops.find((s) => s.id === fromStopId);
  const toStop = simplifiedStops.find((s) => s.id === toStopId);

  if (!fromStop || !toStop) return res.status(400).json({ error: 'Invalid fromStopId or toStopId' });

  if (fromStopId === toStopId) {
    return res.json({
      fromStop: { id: fromStop.id, name: fromStop.name, lat: fromStop.lat, lng: fromStop.lng },
      toStop: { id: toStop.id, name: toStop.name, lat: toStop.lat, lng: toStop.lng },
      direct: [], transfers: [], message: 'Origin and destination are the same stop.',
    });
  }

  const result = gtfs.planJourney(fromStop.stop_id, toStop.stop_id);

  res.json({
    fromStop: result.from,
    toStop: result.to,
    direct: result.direct?.map(d => ({
      routeId: `route_${d.route.id}`,
      ref: d.route.ref,
      name: d.route.name,
      colour: d.route.colour,
      allStops: d.stops?.map(s => ({
        id: `stop_${s.stop?.stop_id}`,
        name: s.stop?.stop_name || '',
        lat: parseFloat(s.stop?.stop_lat) || 0,
        lng: parseFloat(s.stop?.stop_lon) || 0,
      })).filter(s => s.lat && s.lng) || [],
    })) || [],
    transfers: result.transfers?.map(t => ({
      viaStopId: `stop_${t.transfer.stopId}`,
      viaStopName: t.transfer.stopName,
      leg1: { routeId: `route_${t.leg1.route.id}`, ref: t.leg1.route.ref, name: t.leg1.route.name, colour: t.leg1.route.colour },
      leg2: { routeId: `route_${t.leg2.route.id}`, ref: t.leg2.route.ref, name: t.leg2.route.name, colour: t.leg2.route.colour },
    })) || [],
    message: result.message,
  });
});

// ─── MAP GEOMETRY API ────────────────────────────────────────────────────────
app.get('/api/map/routes', (req, res) => {
  const geoRoutes = simplifiedRoutes.map(r => ({
    id: r.id, ref: r.ref, name: r.name, colour: r.colour, active: r.active, geometry: r.geometry,
  }));
  res.json(geoRoutes);
});

// ─── TRANSIT GTFS API (Real Schedules & Arrivals) ─────────────────────────────
app.get('/api/transit/routes', (req, res) => {
  res.json(simplifiedRoutes.map(r => ({
    id: r.id, ref: r.ref, name: r.name,
    colour: r.colour, stopsCount: r.stops?.length || 0,
  })));
});

app.get('/api/transit/routes/:id', (req, res) => {
  const route = simplifiedRoutes.find(r => r.id === req.params.id);
  if (!route) return res.status(404).json({ error: 'Route not found' });
  if (!gtfs) return res.status(503).json({ error: 'GTFS not loaded' });

  const stopsInOrder = gtfs.getRouteStopsInOrder(route.route_id);
  const schedule = gtfs.getRouteSchedule(route.route_id);

  res.json({
    id: route.id, ref: route.ref, name: route.name, colour: route.colour,
    stops: stopsInOrder || [],
    schedule: schedule?.schedule?.slice(0, 20) || [],
  });
});

app.get('/api/transit/stops', (req, res) => {
  const { q, route } = req.query;
  let results = simplifiedStops;
  if (q) results = results.filter(s => s.name.toLowerCase().includes(q.toLowerCase()));
  if (route) results = results.filter(s => s.routes.some(r => r.ref === route));
  res.json(results.slice(0, 100));
});

app.get('/api/transit/stops/:id', (req, res) => {
  const stop = simplifiedStops.find(s => s.id === req.params.id);
  if (!stop) return res.status(404).json({ error: 'Stop not found' });
  if (!gtfs) return res.status(503).json({ error: 'GTFS not loaded' });

  res.json({
    id: stop.id, name: stop.name, lat: stop.lat, lng: stop.lng,
    routes: stop.routes,
    arrivals: gtfs.getStopArrivals(stop.stop_id, 20),
  });
});

app.get('/api/transit/stops/:id/arrivals', (req, res) => {
  const stop = simplifiedStops.find(s => s.id === req.params.id);
  if (!stop) return res.status(404).json({ error: 'Stop not found' });
  if (!gtfs) return res.status(503).json({ error: 'GTFS not loaded' });

  const limit = parseInt(req.query.limit) || 15;
  res.json({ stopId: stop.id, stopName: stop.name, arrivals: gtfs.getStopArrivals(stop.stop_id, limit) });
});

// ─── JOURNEY PLANNER (primary) ────────────────────────────────────────────────
// FIX: transform stops from GTFSData shape → frontend-expected shape
// GTFSData.getTripStops() returns: { stop: { stop_id, stop_name, stop_lat, stop_lon }, arrivalTime, departureTime, sequence }
// Frontend expects:               { id, name, lat, lng, arrivalTime, departureTime, sequence }

function transformStops(rawStops) {
  return (rawStops || [])
    .map(s => {
      const lat = parseFloat(s.stop?.stop_lat);
      const lng = parseFloat(s.stop?.stop_lon);
      return {
        id: s.stop?.stop_id ? `stop_${s.stop.stop_id}` : null,
        name: s.stop?.stop_name || null,
        lat: isFinite(lat) && lat !== 0 ? lat : null,
        lng: isFinite(lng) && lng !== 0 ? lng : null,
        arrivalTime: s.arrivalTime || null,
        departureTime: s.departureTime || null,
        sequence: s.sequence || 0,
      };
    })
    .filter(s => s.lat !== null && s.lng !== null); // drop stops with no valid coordinates
}

app.post('/api/transit/journey', async (req, res) => {
  const { fromStopId, toStopId, from: fromCoord, to: toCoord } = req.body || {};

  console.log(`[Journey] fromStopId=${fromStopId} toStopId=${toStopId}`);

  if (!gtfs) return res.status(503).json({ error: 'GTFS not loaded. Please restart the server.' });

  let fromStop = null, toStop = null;

  // ── Resolve 'from' ────────────────────────────────────────────────────────
  if (fromCoord && fromCoord.lat != null && fromCoord.lng != null) {
    const result = findNearestStops(fromCoord.lat, fromCoord.lng, 1000);
    if (!result.stop) {
      return res.json({
        from: { lat: fromCoord.lat, lng: fromCoord.lng, name: fromCoord.name || 'Your location' },
        to: toCoord ? { lat: toCoord.lat, lng: toCoord.lng, name: toCoord.name || 'Destination' } : null,
        walkingLegs: [], direct: [], transfers: [],
        message: 'No nearby transit available near your starting location.',
      });
    }
    fromStop = result.stop;
  } else if (fromStopId) {
    fromStop = simplifiedStops.find(s => s.id === fromStopId);
  }

  // ── Resolve 'to' ─────────────────────────────────────────────────────────
  if (toCoord && toCoord.lat != null && toCoord.lng != null) {
    const result = findNearestStops(toCoord.lat, toCoord.lng, 1000);
    if (!result.stop) {
      return res.json({
        from: fromStop ? { id: fromStop.id, name: fromStop.name, lat: fromStop.lat, lng: fromStop.lng }
                       : { lat: fromCoord?.lat, lng: fromCoord?.lng, name: fromCoord?.name },
        to: { lat: toCoord.lat, lng: toCoord.lng, name: toCoord.name || 'Destination' },
        walkingLegs: [], direct: [], transfers: [],
        message: 'No nearby transit available near your destination.',
      });
    }
    toStop = result.stop;
  } else if (toStopId) {
    toStop = simplifiedStops.find(s => s.id === toStopId);
  }

  if (!fromStop || !toStop) {
    return res.status(400).json({ error: 'Could not resolve stops. Please try selecting stops from the list.' });
  }
  if (fromStop.id === toStop.id) {
    return res.json({
      from: { id: fromStop.id, name: fromStop.name, lat: fromStop.lat, lng: fromStop.lng },
      to:   { id: toStop.id,   name: toStop.name,   lat: toStop.lat,   lng: toStop.lng },
      walkingLegs: [], direct: [], transfers: [],
      message: 'Same origin and destination.',
    });
  }

  // ── GTFS journey plan ────────────────────────────────────────────────────
  const gtfsFromId = fromStop.stop_id;
  const gtfsToId = toStop.stop_id;

  console.log(`[Journey] gtfs.stopsMap has from=${gtfs.stopsMap.has(gtfsFromId)} to=${gtfs.stopsMap.has(gtfsToId)}`);
  console.log(`[Journey] gtfs.stopTimesByStop has from=${gtfs.stopTimesByStop.has(gtfsFromId)} to=${gtfs.stopTimesByStop.has(gtfsToId)}`);

  const gtfsResult = gtfs.planJourney(gtfsFromId, gtfsToId);
  console.log(`[Journey] planJourney result: direct=${gtfsResult.direct?.length} transfers=${gtfsResult.transfers?.length} message=${gtfsResult.message}`);

  res.json({
    from: { id: fromStop.id, name: fromStop.name, lat: fromStop.lat, lng: fromStop.lng },
    to:   { id: toStop.id,   name: toStop.name,   lat: toStop.lat,   lng: toStop.lng },
    walkingLegs: [],
    direct: (gtfsResult.direct || []).map(d => ({
      type: 'direct',
      route: { ...d.route, id: `route_${d.route.id}` },
      departure: d.departure,
      arrival: d.arrival,
      duration: d.duration,
      intermediateStops: d.intermediateStops,
      // FIX: transform stops to { id, name, lat, lng, arrivalTime, departureTime, sequence }
      stops: transformStops(d.stops),
    })),
    transfers: (gtfsResult.transfers || []).map(t => ({
      type: 'transfer',
      leg1: { ...t.leg1, route: { ...t.leg1.route, id: `route_${t.leg1.route.id}` } },
      leg2: { ...t.leg2, route: { ...t.leg2.route, id: `route_${t.leg2.route.id}` } },
      transfer: t.transfer,
      totalDuration: t.totalDuration,
    })),
    message: gtfsResult.error || gtfsResult.message,
  });
});

// ─── SIMULATED ROUTE PLANNER ─────────────────────────────────────────────────
app.post('/api/routes/plan', (req, res) => {
  const { from, to, fromStopId, toStopId } = req.body;

  if (fromStopId && toStopId) {
    const fromStop = simplifiedStops.find(s => s.id === fromStopId);
    const toStop = simplifiedStops.find(s => s.id === toStopId);
    if (fromStop && toStop) {
      const fromRefs = new Set(fromStop.routes.map(r => r.ref));
      const directRefs = toStop.routes.filter(r => fromRefs.has(r.ref)).map(r => r.ref);
      const directOptions = directRefs.map(ref => {
        const route = simplifiedRoutes.find(r => r.ref === ref);
        return { routeId: route?.id, routeRef: ref, routeName: route?.name || ref, colour: route?.colour || '#888', type: 'direct', transfers: 0 };
      });
      return res.json({ from: fromStop.name, to: toStop.name, options: directOptions, message: directOptions.length === 0 ? 'No direct route found.' : null });
    }
  }

  const options = simplifiedRoutes.filter(r => r.active).slice(0, 3).map((r, i) => ({
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
    route: simplifiedRoutes.find(r => r.id === v.routeId),
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
        id: ticketObj._id,
        route: ticketObj.routeId ? simplifiedRoutes.find(r => r.id === ticketObj.routeId) : null
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
    if (!TOPUP_AMOUNTS.includes(amount)) {
      return res.status(400).json({ error: 'Invalid topup amount' });
    }
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    user.balance += amount;
    await user.save();
    res.json({ balance: user.balance });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/payments/create-intent', auth, async (req, res) => {
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
      automatic_payment_methods: {
        enabled: true,
      },
      metadata: {
        userId: req.user.id.toString(),
        userEmail: user.email,
        topupAmount: amount.toString(),
      },
    });

    res.json({
      clientSecret: paymentIntent.client_secret,
      amount,
    });
  } catch (err) {
    console.error('Stripe create-intent error:', err.message);
    res.status(500).json({ error: 'Payment initialization failed: ' + err.message });
  }
});

app.post('/api/payments/confirm', auth, async (req, res) => {
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

    res.json({
      success: true,
      balance: user.balance,
      topupAmount,
    });
  } catch (err) {
    console.error('Stripe confirm error:', err.message);
    res.status(500).json({ error: 'Payment confirmation failed: ' + err.message });
  }
});

app.get('/api/payments/config', (req, res) => {
  res.json({
    publishableKey: process.env.STRIPE_PUBLISHABLE_KEY || '',
    topupAmounts: TOPUP_AMOUNTS,
  });
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
      totalRoutes: simplifiedRoutes.length,
      activeRoutes: simplifiedRoutes.filter(r => r.active).length,
      totalStops: simplifiedStops.length,
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
      routePerformance: simplifiedRoutes.slice(0, 10).map(r => ({
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
  res.json(vehicles.map(v => ({ ...v, route: simplifiedRoutes.find(r => r.id === v.routeId) })));
});

app.patch('/api/admin/routes/:id', auth, adminOnly, (req, res) => {
  const route = simplifiedRoutes.find(r => r.id === req.params.id);
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

// ─── NEAREST STOP HELPERS ────────────────────────────────────────────────────
function haversineM(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = d => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

function findNearestStops(lat, lng, maxMeters = 1000) {
  let bestStop = null;
  let bestDist = Infinity;
  for (const stop of simplifiedStops) {
    const d = haversineM(lat, lng, stop.lat, stop.lng);
    if (d < bestDist) {
      bestDist = d;
      bestStop = stop;
    }
  }
  const result = { stop: bestDist <= maxMeters ? bestStop : null, distanceM: Math.round(bestDist) };
  console.log(`[NearestStop] lat=${lat} lng=${lng} maxM=${maxMeters} → found=${!!result.stop} "${result.stop?.name}" dist=${result.distanceM}m`);
  return result;
}

async function fetchWalkingRoute(from, to) {
  if (!ORS_API_KEY) {
    console.log('[WalkingRoute] Skipped: ORS_API_KEY not set');
    return null;
  }
  try {
    const url = 'https://api.openrouteservice.org/v2/directions/foot-walking/geojson';
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': ORS_API_KEY },
      body: JSON.stringify({ coordinates: [from, to] }),
    });
    if (!response.ok) {
      console.log(`[WalkingRoute] ORS error: ${response.status}`);
      return null;
    }
    const data = await response.json();
    const feature = data.features?.[0];
    if (!feature) {
      console.log('[WalkingRoute] No route found from ORS');
      return null;
    }
    const result = {
      geometry: feature.geometry,
      distance_m: Math.round(feature.properties?.summary?.distance || 0),
      duration_s: Math.round(feature.properties?.summary?.duration || 0),
    };
    console.log(`[WalkingRoute] OK: ${result.distance_m}m ${Math.round(result.duration_s / 60)}min`);
    return result;
  } catch (err) {
    console.log(`[WalkingRoute] Exception: ${err.message}`);
    return null;
  }
}

app.post('/api/nearest-stop', (req, res) => {
  const { lat, lng } = req.body;
  if (lat == null || lng == null) return res.status(400).json({ error: 'lat and lng are required' });

  const { stop, distanceM } = findNearestStops(lat, lng, 500);
  res.json({
    stop,
    distanceM,
    withinRadius: distanceM <= 500,
    message: !stop ? 'No stops found within 500 m' : null,
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

async function startServer() {
  await connectDB();
  await initGTFS();
  initializeVehicles();
  scheduleWeeklyRefresh();

  app.listen(PORT, () => {
    console.log(`\nTirana Transit API running on http://localhost:${PORT}`);
    console.log(`  Stops:  ${simplifiedStops.length}`);
    console.log(`  Institutions: ${institutions.length}`);
    if (gtfs) {
      console.log(`  GTFS: ${gtfs.routes.length} routes, ${gtfs.stops.length} stops, ${gtfs.stopTimes.length} stopTimes`);
      console.log(`  GTFS active services: ${gtfs.activeServices.size}`);
    } else {
      console.log('  GTFS: DISABLED (init failed)');
    }
  });
}

startServer().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});