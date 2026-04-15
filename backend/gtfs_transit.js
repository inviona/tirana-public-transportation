const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');

const GTFS_URL = 'https://pt.tirana.al/gtfs/gtfs.zip';
const GTFS_ZIP = path.join(__dirname, 'tirana_gtfs.zip');
const GTFS_CACHE = path.join(__dirname, 'gtfs_cache.json');

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

function timeToSeconds(time) {
  const parts = time.split(':');
  if (parts.length !== 3) return 0;
  return parseInt(parts[0]) * 3600 + parseInt(parts[1]) * 60 + parseInt(parts[2]);
}

function secondsToTime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function formatTime(seconds) {
  const h = Math.floor(seconds / 3600) % 24;
  const m = Math.floor((seconds % 3600) / 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

class GTFSData {
  constructor() {
    this.routes = [];
    this.stops = [];
    this.trips = [];
    this.stopTimes = [];
    this.shapes = [];
    this.calendar = [];
    this.calendarDates = [];
    
    this.stopsMap = new Map();
    this.routesMap = new Map();
    this.tripsMap = new Map();
    this.shapesMap = new Map();
    this.stopTimesByTrip = new Map();
    this.stopTimesByStop = new Map();
    this.tripsByRoute = new Map();
    this.routeStops = new Map();
    this.stopRoutes = new Map();
    this.serviceByTrip = new Map();
    this.activeServices = new Set();
  }
  
  loadFromCache() {
    if (!fs.existsSync(GTFS_CACHE)) {
      throw new Error('GTFS cache not found. Run gtfs_updater.js first: node -e "require(\'./gtfs_updater\').updateGTFS()"');
    }

    const data = JSON.parse(fs.readFileSync(GTFS_CACHE, 'utf-8'));

    this.routes = data.routes || [];
    this.stops = data.stops || [];
    this.trips = data.trips || [];
    this.stopTimes = data.stopTimes || [];
    this.shapes = data.shapes || [];
    this.calendar = data.calendar || [];
    this.calendarDates = data.calendarDates || [];

    // ── If stopTimesByStop is missing (old cache), rebuild from stopTimes ─────
    if (!data.stopTimesByStop || Object.keys(data.stopTimesByStop).length === 0) {
      console.warn('[GTFS] Cache is missing stopTimesByStop — rebuilding from stopTimes array...');
      const idx = {};
      this.stopTimes.forEach(st => {
        if (!idx[st.stop_id]) idx[st.stop_id] = [];
        idx[st.stop_id].push(st);
      });
      Object.values(idx).forEach(arr => arr.sort((a, b) => a.stop_sequence - b.stop_sequence));
      this._stopTimesByStopObj = idx;
    } else {
      this._stopTimesByStopObj = data.stopTimesByStop;
    }

    if (!data.stopTimesByTrip || Object.keys(data.stopTimesByTrip).length === 0) {
      const idx = {};
      this.stopTimes.forEach(st => {
        if (!idx[st.trip_id]) idx[st.trip_id] = [];
        idx[st.trip_id].push(st);
      });
      Object.values(idx).forEach(arr => arr.sort((a, b) => a.stop_sequence - b.stop_sequence));
      this._stopTimesByTripObj = idx;
    } else {
      this._stopTimesByTripObj = data.stopTimesByTrip;
    }

    console.log(`[GTFS] loadFromCache: ${this.routes.length} routes, ${this.stops.length} stops, ${this.stopTimes.length} stopTimes`);
    console.log(`[GTFS] loadFromCache: stopTimesByStop entries=${Object.keys(this._stopTimesByStopObj).length}`);

    this.buildIndexes();
    this.updateActiveServices();

    return this;
  }

  buildIndexes() {
    this.routesMap.clear();
    this.stopsMap.clear();
    this.tripsMap.clear();
    this.tripsByRoute.clear();
    this.stopTimesByTrip.clear();
    this.stopTimesByStop.clear();
    this.shapesMap.clear();
    this.routeStops.clear();
    this.stopRoutes.clear();

    this.routes.forEach(r => this.routesMap.set(r.route_id, r));
    this.stops.forEach(s => {
      if (!s.stop_id) {
        console.warn(`[GTFS] buildIndexes: stop with no stop_id: ${JSON.stringify(s).slice(0, 80)}`);
        return;
      }
      this.stopsMap.set(s.stop_id, s);
    });
    this.trips.forEach(t => {
      if (!this.tripsByRoute.has(t.route_id)) this.tripsByRoute.set(t.route_id, []);
      this.tripsByRoute.get(t.route_id).push(t);
      this.tripsMap.set(t.trip_id, t);
      if (t.service_id) this.serviceByTrip.set(t.trip_id, t.service_id);
    });

    // Populate stopTimesByStop from the pre-built object
    Object.entries(this._stopTimesByStopObj || {}).forEach(([stopId, times]) => {
      this.stopTimesByStop.set(stopId, times);
    });

    // Populate stopTimesByTrip from the pre-built object
    Object.entries(this._stopTimesByTripObj || {}).forEach(([tripId, times]) => {
      this.stopTimesByTrip.set(tripId, times);
    });

    // Build routeStops (routeId → Set of stop_ids) and stopRoutes (stopId → Set of routeIds)
    this.stopTimes.forEach(st => {
      const trip = this.tripsMap.get(st.trip_id);
      if (!trip) return;
      const routeId = trip.route_id;
      const stopId = st.stop_id;

      if (!this.routeStops.has(routeId)) this.routeStops.set(routeId, new Set());
      this.routeStops.get(routeId).add(stopId);

      if (!this.stopRoutes.has(stopId)) this.stopRoutes.set(stopId, new Set());
      this.stopRoutes.get(stopId).add(routeId);
    });

    this.shapes.forEach(p => {
      if (!this.shapesMap.has(p.shape_id)) this.shapesMap.set(p.shape_id, []);
      this.shapesMap.get(p.shape_id).push(p);
    });
    this.shapesMap.forEach((pts, id) => pts.sort((a, b) => a.shape_pt_sequence - b.shape_pt_sequence));

    console.log(`[GTFS] buildIndexes: routesMap=${this.routesMap.size} stopsMap=${this.stopsMap.size} stopTimesByStop=${this.stopTimesByStop.size} routeStops=${this.routeStops.size} stopRoutes=${this.stopRoutes.size}`);
    const sampleStopKeys = [...this.stopsMap.keys()].slice(0, 3);
    const sampleSTKeys = [...this.stopTimesByStop.keys()].slice(0, 3);
    console.log(`[GTFS] stopsMap sample keys: ${sampleStopKeys.join(', ')}`);
    console.log(`[GTFS] stopTimesByStop sample keys: ${sampleSTKeys.join(', ')}`);
    if (this.stopsMap.has(undefined)) console.warn('[GTFS] WARNING: stopsMap has undefined key!');
    if (this.stopTimesByStop.has(undefined)) console.warn('[GTFS] WARNING: stopTimesByStop has undefined key!');
  }
  
  updateActiveServices() {
    const now = new Date();
    const today = parseInt(`${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`);
    const dayOfWeek = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'][now.getDay()];
    console.log(`[GTFS] updateActiveServices: today=${today} (${dayOfWeek}) calendar entries=${this.calendar.length}`);

    let matched = 0;
    this.calendar.forEach(service => {
      if (service[dayOfWeek] === '1') {
        const startDate = parseInt(service.start_date);
        const endDate = parseInt(service.end_date);
        // Relaxed: only check start_date. end_date is often stale in archived GTFS data.
        if (today >= startDate) {
          this.activeServices.add(service.service_id);
          matched++;
        }
      }
    });

    this.calendarDates.forEach(exception => {
      if (exception.exception_type === '1') {
        this.activeServices.add(exception.service_id);
      } else if (exception.exception_type === '2') {
        this.activeServices.delete(exception.service_id);
      }
    });

    console.log(`[GTFS] After calendar filter: ${matched}/${this.calendar.length} services matched today`);
    console.log(`[GTFS] After calendarDates: activeServices=${this.activeServices.size}`);

    // Fallback: if no services are active (stale calendar data), activate all services
    if (this.activeServices.size === 0 && this.calendar.length > 0) {
      this.calendar.forEach(service => {
        this.activeServices.add(service.service_id);
      });
      console.warn('[GTFS] WARNING: Stale calendar — activating ALL services as fallback.');
    }
    console.log(`[GTFS] Final activeServices count: ${this.activeServices.size}`);
  }
  
  isServiceActive(serviceId) {
    return this.activeServices.has(serviceId);
  }
  
  getRoute(routeId) {
    return this.routesMap.get(routeId);
  }

  getStop(stopId) {
    if (stopId == null) return null;
    const str = String(stopId).trim();
    let stop = this.stopsMap.get(str);
    if (stop) return stop;
    if (/^\d+$/.test(str)) {
      stop = this.stopsMap.get(parseInt(str));
      if (stop) return stop;
    }
    if (!str.startsWith('stop_')) {
      stop = this.stopsMap.get(`stop_${str}`);
      if (stop) return stop;
    }
    return null;
  }
  
  getRouteTrips(routeId) {
    const route = this.getRoute(routeId);
    if (!route) return [];
    
    return this.tripsByRoute.get(route.route_id)?.filter(trip => {
      const serviceId = this.serviceByTrip.get(trip.trip_id);
      return !serviceId || this.isServiceActive(serviceId);
    }) || [];
  }
  
  getTripStops(tripId) {
    const stops = this.stopTimesByTrip.get(tripId) || [];
    return stops.map(st => ({
      stop: this.getStop(st.stop_id),
      arrivalTime: formatTime(timeToSeconds(st.arrival_time)),
      departureTime: formatTime(timeToSeconds(st.departure_time)),
      sequence: parseInt(st.stop_sequence),
      headsign: st.stop_headsign || '',
    })).filter(s => s.stop);
  }
  
  getStopArrivals(stopId, limit = 10) {
    const stop = this.getStop(stopId);
    if (!stop) return [];

    // Use the normalised stop_id from the stop object
    const stopTimes = this.stopTimesByStop.get(stop.stop_id) || [];
    const arrivals = [];
    const seen = new Set();
    
    const now = new Date();
    const currentSeconds = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
    const dayOfWeek = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'][now.getDay()];
    
    stopTimes.forEach(st => {
      const trip = this.tripsMap.get(st.trip_id);
      if (!trip) return;
      
      const serviceId = this.serviceByTrip.get(st.trip_id);
      if (serviceId && !this.isServiceActive(serviceId)) return;
      
      const route = this.getRoute(trip.route_id);
      if (!route) return;
      
      const key = `${route.route_id}-${st.trip_id}-${st.departure_time}`;
      if (seen.has(key)) return;
      seen.add(key);
      
      const departureSecs = timeToSeconds(st.departure_time);
      let arrivalSecs = timeToSeconds(st.arrival_time);
      
      if (departureSecs < currentSeconds - 3600) return;
      
      const isToday = departureSecs >= currentSeconds;
      const displayTime = formatTime(departureSecs);
      const minutesUntil = isToday 
        ? Math.floor((departureSecs - currentSeconds) / 60)
        : Math.floor((86400 - currentSeconds + departureSecs) / 60);
      
      const stopSeq = parseInt(st.stop_sequence);
      const allStops = this.stopTimesByTrip.get(st.trip_id) || [];
      const totalStops = allStops.length;
      
      arrivals.push({
        routeId: route.route_id,
        routeRef: route.route_short_name || route.route_long_name?.split(':')[0] || '?',
        routeName: route.route_long_name,
        routeColour: route.route_color || '#4e9eff',
        tripId: st.trip_id,
        headsign: trip.trip_headsign || route.route_long_name,
        arrivalTime: formatTime(arrivalSecs),
        departureTime: displayTime,
        minutesUntil: Math.max(0, minutesUntil),
        stopSequence: stopSeq,
        totalStops,
        isNextStop: stopSeq === 1,
        isLastStop: stopSeq === totalStops,
      });
    });
    
    return arrivals
      .sort((a, b) => a.departureTime.localeCompare(b.departureTime))
      .slice(0, limit);
  }
  
  getRouteStopsInOrder(routeId) {
    const route = this.getRoute(routeId);
    if (!route) return null;
    
    const trips = this.getRouteTrips(routeId);
    if (trips.length === 0) return null;
    
    const trip = trips[0];
    const stopSequence = this.stopTimesByTrip.get(trip.trip_id) || [];
    
    return stopSequence.map(st => {
      const stop = this.getStop(st.stop_id);
      return {
        stopId: st.stop_id,
        stopName: stop?.stop_name || '',
        lat: parseFloat(stop?.stop_lat || 0),
        lng: parseFloat(stop?.stop_lon || 0),
        sequence: parseInt(st.stop_sequence),
        arrivalTime: formatTime(timeToSeconds(st.arrival_time)),
        departureTime: formatTime(timeToSeconds(st.departure_time)),
      };
    });
  }
  
  getRouteSchedule(routeId, date = null) {
    const route = this.getRoute(routeId);
    if (!route) return null;
    
    const trips = this.tripsByRoute.get(route.route_id) || [];
    const schedule = [];
    
    trips.slice(0, 20).forEach(trip => {
      const stops = this.getTripStops(trip.trip_id);
      if (stops.length === 0) return;
      
      const serviceId = this.serviceByTrip.get(trip.trip_id);
      const isActive = !serviceId || this.isServiceActive(serviceId);
      
      schedule.push({
        tripId: trip.trip_id,
        headsign: trip.trip_headsign || route.route_long_name,
        direction: trip.direction_id === '1' ? 'return' : 'outbound',
        serviceClass: isActive ? 'active' : 'inactive',
        firstDeparture: stops[0]?.departureTime || '',
        lastArrival: stops[stops.length - 1]?.arrivalTime || '',
        stops,
      });
    });
    
    return {
      routeId: route.route_id,
      routeRef: route.route_short_name || route.route_long_name?.split(':')[0] || '?',
      routeName: route.route_long_name,
      routeColour: route.route_color || '#4e9eff',
      schedule: schedule.slice(0, 30),
    };
  }
  
  planJourney(fromStopId, toStopId) {
    const startTime = Date.now();

    const fromStop = this.getStop(fromStopId);
    const toStop = this.getStop(toStopId);

    if (!fromStop || !toStop) {
      console.warn(`[GTFS] planJourney: fromStop=${!!fromStop} toStop=${!!toStop}`);
      if (!fromStop) console.warn(`[GTFS] fromStop NOT FOUND for "${fromStopId}". stopsMap keys: ${[...this.stopsMap.keys()].slice(0, 5).join(', ')}`);
      if (!toStop) console.warn(`[GTFS] toStop NOT FOUND for "${toStopId}".`);
      return { error: 'Invalid stops' };
    }

    const normFromId = fromStop.stop_id;
    const normToId = toStop.stop_id;

    if (normFromId === normToId) {
      return { error: 'Same origin and destination' };
    }

    console.log(`[GTFS] planJourney: from="${fromStop.stop_name}"(${normFromId}) to="${toStop.stop_name}"(${normToId})`);

    const fromStopTimes = this.stopTimesByStop.get(normFromId) || [];
    const toStopTimes = this.stopTimesByStop.get(normToId) || [];

    console.log(`[GTFS] fromStopTimes=${fromStopTimes.length} toStopTimes=${toStopTimes.length}`);

    const directRoutes = [];
    const transfers = [];

    // OPTIMIZED: Use routeStops and stopRoutes indexes for O(1) route lookups
    const fromRoutes = this.stopRoutes.get(normFromId) || new Set();
    const toRoutes = this.stopRoutes.get(normToId) || new Set();

    console.log(`[GTFS] fromRoutes=${fromRoutes.size} toRoutes=${toRoutes.size}`);

    // Direct routes: O(routes) intersection
    const directRouteIds = [...fromRoutes].filter(r => toRoutes.has(r));

    // Find direct routes using trip data
    const directRouteSet = new Set(directRouteIds);

    directRouteIds.forEach(routeId => {
      const route = this.getRoute(routeId);
      const fromTimes = fromStopTimes.filter(st => {
        const trip = this.tripsMap.get(st.trip_id);
        return trip && trip.route_id === routeId;
      });

      const toTimes = toStopTimes.filter(st => {
        const trip = this.tripsMap.get(st.trip_id);
        return trip && trip.route_id === routeId;
      });

      fromTimes.forEach(ft => {
        toTimes.forEach(tt => {
          if (ft.trip_id === tt.trip_id) {
            const departureSecs = timeToSeconds(ft.departure_time);
            const arrivalSecs = timeToSeconds(tt.arrival_time);

            if (arrivalSecs > departureSecs) {
              const trip = this.tripsMap.get(ft.trip_id);
              const stops = this.getTripStops(ft.trip_id);
              const fromIdx = stops.findIndex(s => s.stop?.stop_id === normFromId);
              const toIdx = stops.findIndex(s => s.stop?.stop_id === normToId);

              directRoutes.push({
                type: 'direct',
                route: {
                  id: route.route_id,
                  ref: route.route_short_name || '?',
                  name: route.route_long_name,
                  colour: route.route_color || '#4e9eff',
                },
                departure: {
                  stopId: normFromId,
                  stopName: fromStop.stop_name,
                  time: formatTime(departureSecs),
                },
                arrival: {
                  stopId: normToId,
                  stopName: toStop.stop_name,
                  time: formatTime(arrivalSecs),
                },
                duration: Math.round((arrivalSecs - departureSecs) / 60),
                intermediateStops: toIdx - fromIdx - 1,
                stops: stops.slice(fromIdx, toIdx + 1),
              });
            }
          }
        });
      });
    });

    // OPTIMIZED: Transfer detection using Set intersections - O(routes^2) not O(stopTimes^4)
    // For each fromRoute, find stops it serves, then check which toRoutes also serve those stops
    const transferStopsMap = new Map(); // transferStopId -> {fromRoute, toRoute} pairs

    fromRoutes.forEach(fromRouteId => {
      const fromStops = this.routeStops.get(fromRouteId);
      if (!fromStops) return;

      toRoutes.forEach(toRouteId => {
        if (fromRouteId === toRouteId) return;

        const toStops = this.routeStops.get(toRouteId);
        if (!toStops) return;

        // Find common stops between fromRoute and toRoute
        fromStops.forEach(stopId => {
          if (toStops.has(stopId)) {
            if (!transferStopsMap.has(stopId)) transferStopsMap.set(stopId, new Set());
            transferStopsMap.get(stopId).add(`${fromRouteId}|${toRouteId}`);
          }
        });
      });
    });

    const transferStopIds = [...transferStopsMap.keys()].filter(sid => sid !== normFromId && sid !== normToId);

    // Now build transfer journeys
    transferStopIds.forEach(transferStopId => {
      const transferStop = this.getStop(transferStopId);
      if (!transferStop) return;

      const routePairs = transferStopsMap.get(transferStopId);

      routePairs.forEach(pair => {
        const [route1Id, route2Id] = pair.split('|');

        const fromTimes = fromStopTimes.filter(st => {
          const trip = this.tripsMap.get(st.trip_id);
          return trip && trip.route_id === route1Id;
        });

        const toTimes = toStopTimes.filter(st => {
          const trip = this.tripsMap.get(st.trip_id);
          return trip && trip.route_id === route2Id;
        });

        fromTimes.forEach(ft => {
          const ftStops = this.stopTimesByTrip.get(ft.trip_id) || [];
          const transferFrom = ftStops.find(s => s.stop_id === transferStopId);
          if (!transferFrom) return;

          toTimes.forEach(tt => {
            const ttStops = this.stopTimesByTrip.get(tt.trip_id) || [];
            const transferTo = ttStops.find(s => s.stop_id === transferStopId);
            if (!transferTo) return;

            const ftDepSecs = timeToSeconds(ft.departure_time);
            const ftArrSecs = timeToSeconds(transferFrom.arrival_time);
            const ttDepSecs = timeToSeconds(transferTo.departure_time);
            const ttArrSecs = timeToSeconds(tt.arrival_time);

            if (ftDepSecs < ftArrSecs && ttDepSecs >= ftArrSecs) {
              const route1 = this.getRoute(route1Id);
              const route2 = this.getRoute(route2Id);

              const waitTime = Math.max(0, Math.round((ttDepSecs - ftArrSecs) / 60));

              transfers.push({
                type: 'transfer',
                leg1: {
                  route: {
                    id: route1?.route_id,
                    ref: route1?.route_short_name || '?',
                    name: route1?.route_long_name,
                    colour: route1?.route_color || '#4e9eff',
                  },
                  departure: {
                    stopId: normFromId,
                    stopName: fromStop.stop_name,
                    time: formatTime(ftDepSecs),
                  },
                  arrival: {
                    stopId: transferStopId,
                    stopName: transferStop.stop_name,
                    time: formatTime(ftArrSecs),
                  },
                },
                transfer: {
                  stopId: transferStopId,
                  stopName: transferStop.stop_name,
                  lat: transferStop.stop_lat,
                  lng: transferStop.stop_lon,
                  waitTime,
                },
                leg2: {
                  route: {
                    id: route2?.route_id,
                    ref: route2?.route_short_name || '?',
                    name: route2?.route_long_name,
                    colour: route2?.route_color || '#4e9eff',
                  },
                  departure: {
                    stopId: transferStopId,
                    stopName: transferStop.stop_name,
                    time: formatTime(ttDepSecs),
                  },
                  arrival: {
                    stopId: normToId,
                    stopName: toStop.stop_name,
                    time: formatTime(ttArrSecs),
                  },
                },
                totalDuration: Math.round((ttArrSecs - ftDepSecs) / 60),
              });
            }
          });
        });
      });
    });

    directRoutes.sort((a, b) => a.departure.time.localeCompare(b.departure.time));
    transfers.sort((a, b) => a.leg1.departure.time.localeCompare(b.leg1.departure.time));

    const elapsed = Date.now() - startTime;
    console.log(`[GTFS] planJourney result: direct=${directRoutes.length} transfers=${transfers.length} elapsed=${elapsed}ms`);
    return {
      from: { id: normFromId, name: fromStop.stop_name, lat: fromStop.stop_lat, lng: fromStop.stop_lon },
      to: { id: normToId, name: toStop.stop_name, lat: toStop.stop_lat, lng: toStop.stop_lon },
      direct: directRoutes.slice(0, 10),
      transfers: transfers.slice(0, 10),
      message: directRoutes.length === 0 && transfers.length === 0 ? 'No connections found' : null,
    };
  }
}

module.exports = { GTFSData, GTFS_URL, GTFS_CACHE, GTFS_ZIP };
