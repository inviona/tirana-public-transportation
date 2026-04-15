const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { pipeline } = require('stream/promises');

const GTFS_URL = 'https://pt.tirana.al/gtfs/gtfs.zip';
const GTFS_DIR = path.join(__dirname);
const GTFS_ZIP = path.join(GTFS_DIR, 'tirana_gtfs.zip');
const GTFS_CACHE = path.join(GTFS_DIR, 'gtfs_cache.json');
const GTFS_ZIP_TMP = GTFS_ZIP + '.tmp';

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

function parseCSV(csvText) {
  if (!csvText || csvText.trim() === '') return [];
  const lines = csvText.trim().split('\n');
  if (lines.length === 0) return [];
  const headers = parseCSVLine(lines[0]);
  return lines.slice(1).map(line => {
    const values = parseCSVLine(line);
    const obj = {};
    headers.forEach((h, i) => { obj[h] = values[i] || ''; });
    return obj;
  });
}

function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
}

function normaliseStopId(raw) {
  if (raw == null) return '';
  const s = String(raw).trim();
  // Prefer bare numeric IDs: "942" not "stop_942"
  if (s.startsWith('stop_')) return s.slice(5);
  return s;
}

async function downloadGTFSZip(force) {
  if (fs.existsSync(GTFS_ZIP)) {
    const stats = fs.statSync(GTFS_ZIP);
    const age = Date.now() - stats.mtimeMs;
    if (!force && age < SEVEN_DAYS_MS) {
      console.log(`[Updater] Using cached GTFS zip (${Math.round(age / 86400000)}d old, < 7d). Skip download.`);
      return false;
    }
    console.log(`[Updater] Cached GTFS zip is ${Math.round(age / 86400000)}d old (> 7d). Re-downloading...`);
  } else {
    console.log('[Updater] No GTFS zip found. Downloading fresh copy...');
  }

  let AdmZip;
  try { AdmZip = require('adm-zip'); }
  catch {
    console.log('[Updater] Installing adm-zip...');
    await new Promise((resolve, reject) => {
      exec('npm install adm-zip', (err, stdout, stderr) => {
        if (err) reject(err); else resolve();
      });
    });
    AdmZip = require('adm-zip');
  }

  try {
    const response = await fetch(GTFS_URL, { timeout: 180000, redirect: 'follow' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const totalSize = parseInt(response.headers.get('content-length') || '0');

    await pipeline(response.body, fs.createWriteStream(GTFS_ZIP_TMP));
    fs.renameSync(GTFS_ZIP_TMP, GTFS_ZIP);

    const downloadedSize = fs.statSync(GTFS_ZIP).size;
    console.log(`[Updater] Downloaded ${(downloadedSize / 1024 / 1024).toFixed(1)} MB${totalSize ? ` / ${(totalSize / 1024 / 1024).toFixed(1)} MB` : ''}`);
    return true;
  } catch (err) {
    if (fs.existsSync(GTFS_ZIP_TMP)) fs.unlinkSync(GTFS_ZIP_TMP);
    throw err;
  }
}

function extractAndBuildCache() {
  let AdmZip;
  try { AdmZip = require('adm-zip'); }
  catch {
    execSync('npm install adm-zip', { stdio: 'inherit' });
    AdmZip = require('adm-zip');
  }

  if (!fs.existsSync(GTFS_ZIP)) {
    throw new Error('GTFS zip not found. Run updateGTFS() first.');
  }

  console.log('[Updater] Extracting zip...');
  const zip = new AdmZip(GTFS_ZIP);
  const zipEntries = {};
  zip.getEntries().forEach(entry => {
    if (!entry.isDirectory) {
      zipEntries[entry.entryName] = entry.getData().toString('utf8');
    }
  });

  const rawRoutes = parseCSV(zipEntries['routes.txt'] || '');
  const rawStops = parseCSV(zipEntries['stops.txt'] || '');
  const rawTrips = parseCSV(zipEntries['trips.txt'] || '');
  const rawStopTimes = parseCSV(zipEntries['stop_times.txt'] || '');
  const rawShapes = parseCSV(zipEntries['shapes.txt'] || '');
  const rawCalendar = parseCSV(zipEntries['calendar.txt'] || '');
  const rawCalendarDates = parseCSV(zipEntries['calendar_dates.txt'] || '');

  console.log(`[Updater] routes=${rawRoutes.length} stops=${rawStops.length} trips=${rawTrips.length} stopTimes=${rawStopTimes.length} shapes=${rawShapes.length}`);

  // ── Build shapes map ─────────────────────────────────────────────────────────
  const shapesMap = new Map();
  rawShapes.forEach(p => {
    if (!shapesMap.has(p.shape_id)) shapesMap.set(p.shape_id, []);
    shapesMap.get(p.shape_id).push({
      shape_id: p.shape_id,
      shape_pt_lat: parseFloat(p.shape_pt_lat),
      shape_pt_lon: parseFloat(p.shape_pt_lon),
      shape_pt_sequence: parseInt(p.shape_pt_sequence),
    });
  });
  shapesMap.forEach((pts, id) => pts.sort((a, b) => a.shape_pt_sequence - b.shape_pt_sequence));

  // ── Normalise stopTimes FIRST (authoritative stop_id source) ─────────────────
  // stop_times.txt stop_ids are the canonical format — all lookups use these keys
  const stopTimes = rawStopTimes.map(st => ({
    trip_id: String(st.trip_id || ''),
    stop_id: normaliseStopId(st.stop_id),        // normalised string
    stop_sequence: parseInt(st.stop_sequence) || 0,
    arrival_time: st.arrival_time || '00:00:00',
    departure_time: st.departure_time || '00:00:00',
    stop_headsign: st.stop_headsign || '',
    pickup_type: st.pickup_type || '0',
    drop_off_type: st.drop_off_type || '0',
  }));

  // ── Build stop → routes map from stopTimes (authoritative) ──────────────────
  // trip_id → route_id
  const tripRouteMap = new Map();
  rawTrips.forEach(t => tripRouteMap.set(String(t.trip_id), String(t.route_id)));

  const stopRoutesMap = new Map(); // stop_id → [{ref, colour, name}]
  const routeStopIdsMap = new Map(); // route_id → Set<stop_id>
  const routeInfoMap = new Map();   // route_id → {route_short_name, route_long_name, route_color}

  rawRoutes.forEach(r => {
    routeInfoMap.set(String(r.route_id), {
      route_short_name: r.route_short_name || r.route_long_name?.split(':')[0] || '',
      route_long_name: r.route_long_name || r.route_short_name || '',
      route_color: r.route_color || '#4e9eff',
      route_text_color: r.route_text_color || '#ffffff',
    });
    routeStopIdsMap.set(String(r.route_id), new Set());
  });

  stopTimes.forEach(st => {
    const routeId = tripRouteMap.get(st.trip_id);
    if (routeId) {
      routeStopIdsMap.get(routeId)?.add(st.stop_id);
    }
  });

  // Build stop → routes
  routeStopIdsMap.forEach((stopIds, routeId) => {
    const info = routeInfoMap.get(routeId);
    const ref = info?.route_short_name || routeId;
    const colour = info?.route_color || '#4e9eff';
    const name = info?.route_long_name || '';
    stopIds.forEach(stopId => {
      if (!stopRoutesMap.has(stopId)) stopRoutesMap.set(stopId, []);
      stopRoutesMap.get(stopId).push({ ref, colour, name });
    });
  });

  // ── Build stopTimesByStop & stopTimesByTrip indexes (for the cache) ──────────
  const stopTimesByStop = {}; // { [stop_id]: [...] }
  const stopTimesByTrip = {}; // { [trip_id]: [...] }
  stopTimes.forEach(st => {
    if (!stopTimesByStop[st.stop_id]) stopTimesByStop[st.stop_id] = [];
    stopTimesByStop[st.stop_id].push(st);
    if (!stopTimesByTrip[st.trip_id]) stopTimesByTrip[st.trip_id] = [];
    stopTimesByTrip[st.trip_id].push(st);
  });
  // Sort by sequence
  Object.values(stopTimesByStop).forEach(arr => arr.sort((a, b) => a.stop_sequence - b.stop_sequence));
  Object.values(stopTimesByTrip).forEach(arr => arr.sort((a, b) => a.stop_sequence - b.stop_sequence));

  // ── Process stops (normalise stop_id to match stopTimes) ────────────────────
  const stops = rawStops.map(s => {
    const sid = normaliseStopId(s.stop_id);
    return {
      stop_id: sid,
      stop_name: s.stop_name || '',
      stop_lat: parseFloat(s.stop_lat) || 0,
      stop_lon: parseFloat(s.stop_lon) || 0,
      zone_id: s.zone_id || '',
      location_type: s.location_type || '0',
      parent_station: s.parent_station || '',
      routes: stopRoutesMap.get(sid) || [],
    };
  });

  // ── Process routes ───────────────────────────────────────────────────────────
  const COLOURS = [
    '#e74c3c', '#3498db', '#2ecc71', '#f39c12', '#9b59b6',
    '#1abc9c', '#e67e22', '#34495e', '#16a085', '#c0392b',
    '#2980b9', '#27ae60', '#d35400', '#8e44ad', '#7f8c8d',
    '#f1c40f', '#2c3e50', '#95a5a6', '#bdc3c7', '#d35400',
    '#16a085', '#2980b9', '#c0392b', '#8e44ad', '#f39c12',
    '#1abc9c', '#3498db',
  ];

  const routes = rawRoutes.map((r, i) => {
    const rid = String(r.route_id || '');
    const routeTrips = rawTrips.filter(t => String(t.route_id) === rid);
    const sampleTrip = routeTrips[0];
    const shapeId = sampleTrip?.shape_id;
    const shapePoints = shapeId ? shapesMap.get(shapeId) || [] : [];
    const coordinates = shapePoints.map(p => [p.shape_pt_lon, p.shape_pt_lat]);
    const stopIds = [...(routeStopIdsMap.get(rid) || [])];

    return {
      route_id: rid,
      route_short_name: r.route_short_name || r.route_long_name?.split(':')[0] || `R${i}`,
      route_long_name: r.route_long_name || r.route_short_name || '',
      route_type: r.route_type || '3',
      route_color: r.route_color || COLOURS[i % COLOURS.length],
      route_text_color: r.route_text_color || '#ffffff',
      agency_id: r.agency_id || '',
      stops: stopIds,
      geometry: coordinates.length >= 2
        ? { type: 'LineString', coordinates }
        : null,
    };
  });

  // ── Process trips ───────────────────────────────────────────────────────────
  const trips = rawTrips.map(t => ({
    trip_id: String(t.trip_id || ''),
    route_id: String(t.route_id || ''),
    service_id: t.service_id || '',
    trip_headsign: t.trip_headsign || '',
    trip_short_name: t.trip_short_name || '',
    direction_id: t.direction_id || '0',
    shape_id: t.shape_id || '',
    block_id: t.block_id || '',
  }));

  // ── Process calendar ────────────────────────────────────────────────────────
  const calendar = rawCalendar.map(c => ({
    service_id: c.service_id || '',
    monday: c.monday || '0',
    tuesday: c.tuesday || '0',
    wednesday: c.wednesday || '0',
    thursday: c.thursday || '0',
    friday: c.friday || '0',
    saturday: c.saturday || '0',
    sunday: c.sunday || '0',
    start_date: parseInt(c.start_date) || 0,
    end_date: parseInt(c.end_date) || 0,
  }));

  const calendarDates = rawCalendarDates.map(c => ({
    service_id: c.service_id || '',
    date: parseInt(c.date) || 0,
    exception_type: c.exception_type || '1',
  }));

  const shapes = [];
  shapesMap.forEach(pts => shapes.push(...pts));

  const result = {
    routes,
    stops,
    trips,
    stopTimes,
    stopTimesByStop,
    stopTimesByTrip,
    shapes,
    calendar,
    calendarDates,
    metadata: {
      downloaded: new Date().toISOString(),
      source: 'pt.tirana.al',
      version: '1.0',
    },
  };

  // Write atomically: write to .tmp then rename
  fs.writeFileSync(GTFS_CACHE + '.tmp', JSON.stringify(result));
  fs.renameSync(GTFS_CACHE + '.tmp', GTFS_CACHE);

  console.log(`[Updater] Cache written: ${stops.length} stops, ${routes.length} routes, ${stopTimes.length} stopTimes`);
  console.log(`[Updater] stopTimesByStop entries: ${Object.keys(stopTimesByStop).length}`);
  console.log(`[Updater] Routes with geometry: ${routes.filter(r => r.geometry).length}`);

  // Sample
  const sampleStopId = stops[0]?.stop_id;
  console.log(`[Updater] Sample stop_id="${sampleStopId}" has ${stopTimesByStop[sampleStopId]?.length || 0} stopTimes entries`);

  return result;
}

/**
 * Main entry point.
 * @param {boolean} force - If true, always re-download even if cache is fresh.
 * @returns {object} The parsed GTFS cache data
 */
async function updateGTFS(force = false) {
  console.log('[Updater] ============================================');
  console.log(`[Updater] Starting GTFS update (force=${force}) at ${new Date().toISOString()}`);
  const downloaded = await downloadGTFSZip(force);
  const data = extractAndBuildCache();
  console.log(`[Updater] Done. Next auto-refresh in ~7 days.`);
  console.log('[Updater] ============================================');
  return data;
}

module.exports = { updateGTFS };
