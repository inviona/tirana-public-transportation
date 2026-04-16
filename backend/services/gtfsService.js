const { GTFSData } = require('../gtfs_transit');
const { updateGTFS } = require('../gtfs_updater');
const fs = require('fs');
const path = require('path');

const GTFS_CACHE = path.join(__dirname, '..', 'gtfs_cache.json');

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

    console.log(`[GTFSService] simplifiedStops: ${simplifiedStops.length} stops`);
    console.log(`[GTFSService] gtfs.stopsMap: ${gtfs.stopsMap.size} entries`);
    console.log(`[GTFSService] gtfs.activeServices: ${gtfs.activeServices.size}`);

  } catch (err) {
    console.error(`[GTFSService] init failed: ${err.message}`);
  }
}

async function refreshGTFS() {
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
  }
}

function getGtfs() { return gtfs; }
function getSimplifiedRoutes() { return simplifiedRoutes; }
function getSimplifiedStops() { return simplifiedStops; }
function getGtfsCache() { return GTFS_CACHE; }

module.exports = {
  initGTFS,
  refreshGTFS,
  getGtfs,
  getSimplifiedRoutes,
  getSimplifiedStops,
  getGtfsCache,
};
