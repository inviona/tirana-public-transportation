const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');
const { createWriteStream } = require('fs');
const { exec } = require('child_process');

const GTFS_URL = 'https://pt.tirana.al/gtfs/gtfs.zip';
const GTFS_DIR = path.join(__dirname);
const GTFS_ZIP = path.join(GTFS_DIR, 'tirana_gtfs.zip');
const GTFS_CACHE = path.join(GTFS_DIR, 'gtfs_cache.json');

function parseCSV(csvText) {
  if (!csvText || csvText.trim() === '') return [];
  const lines = csvText.trim().split('\n');
  if (lines.length === 0) return [];
  
  const headers = parseCSVLine(lines[0]);
  return lines.slice(1).map(line => {
    const values = parseCSVLine(line);
    const obj = {};
    headers.forEach((h, i) => obj[h] = values[i] || '');
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

async function downloadGTFS() {
  if (fs.existsSync(GTFS_ZIP)) {
    const stats = fs.statSync(GTFS_ZIP);
    const age = Date.now() - stats.mtimeMs;
    const oneDay = 24 * 60 * 60 * 1000;
    
    if (age < oneDay) {
      console.log('Using cached GTFS zip file (less than 24h old)');
      return;
    }
  }
  
  console.log('Downloading GTFS data from pt.tirana.al...');
  
  try {
    const response = await fetch(GTFS_URL, { timeout: 120000 });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    
    const totalSize = parseInt(response.headers.get('content-length') || '0');
    let downloaded = 0;
    
    const fileStream = createWriteStream(GTFS_ZIP);
    
    response.body.on('data', (chunk) => {
      downloaded += chunk.length;
      if (totalSize > 0) {
        const percent = Math.round((downloaded / totalSize) * 100);
        process.stdout.write(`\rDownloading: ${percent}%`);
      }
    });
    
    response.body.pipe(fileStream);
    
    await new Promise((resolve, reject) => {
      fileStream.on('finish', resolve);
      fileStream.on('error', reject);
    });
    
    console.log('\nGTFS downloaded successfully!');
  } catch (err) {
    console.error('\nDownload failed:', err.message);
    throw err;
  }
}

async function extractAndParseGTFS() {
  let AdmZip;
  try {
    AdmZip = require('adm-zip');
  } catch {
    console.log('Installing adm-zip...');
    await new Promise((resolve, reject) => {
      exec('npm install adm-zip', (err, stdout, stderr) => {
        if (err) reject(err);
        else resolve();
      });
    });
    AdmZip = require('adm-zip');
  }
  
  if (!fs.existsSync(GTFS_ZIP)) {
    throw new Error('GTFS zip file not found');
  }
  
  console.log('Extracting GTFS data...');
  const zip = new AdmZip(GTFS_ZIP);
  const zipEntries = {};
  
  zip.getEntries().forEach(entry => {
    if (!entry.isDirectory) {
      zipEntries[entry.entryName] = entry.getData().toString('utf8');
    }
  });
  
  const routes = parseCSV(zipEntries['routes.txt'] || '');
  const stops = parseCSV(zipEntries['stops.txt'] || '');
  const trips = parseCSV(zipEntries['trips.txt'] || '');
  const stopTimes = parseCSV(zipEntries['stop_times.txt'] || '');
  const shapes = parseCSV(zipEntries['shapes.txt'] || '');
  const calendar = parseCSV(zipEntries['calendar.txt'] || '');
  const calendarDates = parseCSV(zipEntries['calendar_dates.txt'] || '');
  
  console.log(`Routes: ${routes.length}`);
  console.log(`Stops: ${stops.length}`);
  console.log(`Trips: ${trips.length}`);
  console.log(`Stop times: ${stopTimes.length}`);
  console.log(`Shape points: ${shapes.length}`);
  console.log(`Calendar: ${calendar.length}`);
  console.log(`Calendar dates: ${calendarDates.length}`);
  
  const COLOURS = [
    '#e74c3c', '#3498db', '#2ecc71', '#f39c12', '#9b59b6',
    '#1abc9c', '#e67e22', '#34495e', '#16a085', '#c0392b',
    '#2980b9', '#27ae60', '#d35400', '#8e44ad', '#7f8c8d',
    '#f1c40f', '#2c3e50', '#95a5a6', '#bdc3c7', '#d35400',
    '#16a085', '#2980b9', '#c0392b', '#8e44ad', '#f39c12',
    '#1abc9c', '#3498db',
  ];
  
  const shapesMap = new Map();
  shapes.forEach(point => {
    if (!shapesMap.has(point.shape_id)) {
      shapesMap.set(point.shape_id, []);
    }
    shapesMap.get(point.shape_id).push({
      shape_id: point.shape_id,
      shape_pt_lat: parseFloat(point.shape_pt_lat),
      shape_pt_lon: parseFloat(point.shape_pt_lon),
      shape_pt_sequence: parseInt(point.shape_pt_sequence),
    });
  });
  
  shapesMap.forEach((points, shapeId) => {
    points.sort((a, b) => a.shape_pt_sequence - b.shape_pt_sequence);
  });
  
  const tripShapeMap = new Map();
  trips.forEach(trip => {
    if (trip.shape_id && shapesMap.has(trip.shape_id)) {
      tripShapeMap.set(trip.trip_id, trip.shape_id);
    }
  });
  
  const processedRoutes = routes.map((r, i) => {
    const routeTrips = trips.filter(t => t.route_id === r.route_id);
    const sampleTrip = routeTrips[0];
    const shapeId = sampleTrip ? tripShapeMap.get(sampleTrip.trip_id) : null;
    const shapePoints = shapeId ? shapesMap.get(shapeId) : [];
    const coordinates = shapePoints.map(p => [p.shape_pt_lon, p.shape_pt_lat]);
    
    const routeStopIds = new Set();
    routeTrips.forEach(trip => {
      stopTimes.forEach(st => {
        if (st.trip_id === trip.trip_id) {
          routeStopIds.add(st.stop_id);
        }
      });
    });
    
    return {
      route_id: r.route_id,
      route_short_name: r.route_short_name || r.route_long_name?.split(':')[0] || `R${i}`,
      route_long_name: r.route_long_name || r.route_short_name || '',
      route_type: r.route_type || '3',
      route_color: r.route_color || COLOURS[i % COLOURS.length],
      route_text_color: r.route_text_color || '#ffffff',
      agency_id: r.agency_id || '',
      stops: Array.from(routeStopIds),
    };
  });
  
  const processedStops = stops.map(s => ({
    stop_id: s.stop_id,
    stop_name: s.stop_name,
    stop_lat: parseFloat(s.stop_lat),
    stop_lon: parseFloat(s.stop_lon),
    zone_id: s.zone_id || '',
    location_type: s.location_type || '0',
    parent_station: s.parent_station || '',
  }));
  
  const processedTrips = trips.map(t => ({
    trip_id: t.trip_id,
    route_id: t.route_id,
    service_id: t.service_id || '',
    trip_headsign: t.trip_headsign || '',
    trip_short_name: t.trip_short_name || '',
    direction_id: t.direction_id || '0',
    shape_id: t.shape_id || '',
    block_id: t.block_id || '',
  }));
  
  const processedStopTimes = stopTimes.map(st => ({
    trip_id: st.trip_id,
    stop_id: st.stop_id,
    stop_sequence: parseInt(st.stop_sequence) || 0,
    arrival_time: st.arrival_time || '00:00:00',
    departure_time: st.departure_time || '00:00:00',
    stop_headsign: st.stop_headsign || '',
    pickup_type: st.pickup_type || '0',
    drop_off_type: st.drop_off_type || '0',
  }));
  
  const processedCalendar = calendar.map(c => ({
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
  
  const processedCalendarDates = calendarDates.map(c => ({
    service_id: c.service_id || '',
    date: parseInt(c.date) || 0,
    exception_type: c.exception_type || '1',
  }));
  
  const processedShapes = [];
  shapesMap.forEach((points, shapeId) => {
    processedShapes.push(...points);
  });
  
  const result = {
    routes: processedRoutes,
    stops: processedStops,
    trips: processedTrips,
    stopTimes: processedStopTimes,
    shapes: processedShapes,
    calendar: processedCalendar,
    calendarDates: processedCalendarDates,
    metadata: {
      downloaded: new Date().toISOString(),
      source: 'pt.tirana.al',
      version: '1.0',
    },
  };
  
  fs.writeFileSync(GTFS_CACHE, JSON.stringify(result, null, 2));
  console.log(`\nSaved to ${GTFS_CACHE}`);
  
  return result;
}

async function main() {
  try {
    await downloadGTFS();
    const data = await extractAndParseGTFS();
    
    console.log('\n=== GTFS Data Summary ===');
    console.log(`Total routes: ${data.routes.length}`);
    console.log(`Total stops: ${data.stops.length}`);
    console.log(`Total trips: ${data.trips.length}`);
    console.log(`Total stop times: ${data.stopTimes.length}`);
    console.log(`Routes with shapes: ${new Set(data.shapes.map(s => s.shape_id)).size}`);
    
    console.log('\nSample routes:');
    data.routes.slice(0, 10).forEach(r => {
      console.log(`  ${r.route_short_name}: ${r.route_long_name} (${r.stops.length} stops)`);
    });
    
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
}

main();
