const haversineM = require('../utils/haversine');

let vehicles = [];

function getVehicles() { return vehicles; }

function setVehicles(v) { vehicles = v; }

function initializeVehicles(simplifiedRoutes, simplifiedStops) {
  const activeRoutes = simplifiedRoutes.filter(r => r.active).slice(0, 6);
  const statuses = ['moving', 'moving', 'stopped', 'moving', 'maintenance', 'moving'];
  const crowds = ['medium', 'high', 'low', 'medium', 'empty', 'low'];

  vehicles = activeRoutes.map((route, i) => {
    const lat = 41.3275 + (Math.random() - 0.5) * 0.05;
    const lng = 19.8187 + (Math.random() - 0.5) * 0.05;
    const stopInfo = findNearestStopsForVehicle(lat, lng, route.id, simplifiedRoutes, simplifiedStops);

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

function findNearestStopsForVehicle(lat, lng, routeId, simplifiedRoutes, simplifiedStops) {
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

function startVehicleUpdates(simplifiedRoutes, simplifiedStops) {
  setInterval(() => {
    vehicles.forEach(v => {
      if (v.status === 'moving') {
        v.lat += (Math.random() - 0.5) * 0.001;
        v.lng += (Math.random() - 0.5) * 0.001;
        const stopInfo = findNearestStopsForVehicle(v.lat, v.lng, v.routeId, simplifiedRoutes, simplifiedStops);
        v.nextStop = stopInfo.nextStop?.name || null;
        v.nextStopLat = stopInfo.nextStop?.lat || null;
        v.nextStopLng = stopInfo.nextStop?.lng || null;
        v.prevStop = stopInfo.prevStop?.name || null;
        v.eta = stopInfo.eta || null;
        v.speed = Math.floor(20 + Math.random() * 50);
      }
    });
  }, 5000);
}

module.exports = {
  getVehicles,
  setVehicles,
  initializeVehicles,
  startVehicleUpdates,
  findNearestStopsForVehicle,
};
