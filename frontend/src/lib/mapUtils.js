/** GeoJSON coordinates are [lng, lat]; Leaflet expects [lat, lng]. */
export function geometryToLeafletSegments(geometry) {
  if (!geometry?.coordinates) return [];
  if (geometry.type === 'LineString') {
    return [geometry.coordinates.map(([lng, lat]) => [lat, lng])];
  }
  if (geometry.type === 'MultiLineString') {
    return geometry.coordinates.map((line) => line.map(([lng, lat]) => [lat, lng]));
  }
  return [];
}

/** Great-circle distance in metres (WGS84 spherical approximation). */
export function haversineMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * Convert an ORS GeoJSON geometry ([lng, lat] coords) to Leaflet [lat, lng]
 * positions array.
 */
export function orsGeometryToLeaflet(geometry) {
  if (!geometry?.coordinates) return [];
  return geometry.coordinates.map(([lng, lat]) => [lat, lng]);
}

/**
 * Find the nearest point on a polyline (array of [lat, lng]) to a given point.
 * Returns { point: [lat, lng], index: segmentIndex, distance: meters }.
 *
 * Used for snapping the user's live GPS position to a bus route line.
 */
export function nearestPointOnLine(targetLatLng, linePositions) {
  const [pLat, pLng] = targetLatLng;
  let bestDist = Infinity;
  let bestPoint = linePositions[0] || [0, 0];
  let bestIdx = 0;

  for (let i = 0; i < linePositions.length - 1; i++) {
    const [aLat, aLng] = linePositions[i];
    const [bLat, bLng] = linePositions[i + 1];

    // Project point onto segment AB
    const dx = bLng - aLng;
    const dy = bLat - aLat;
    const lenSq = dx * dx + dy * dy;

    let t = 0;
    if (lenSq > 0) {
      t = ((pLng - aLng) * dx + (pLat - aLat) * dy) / lenSq;
      t = Math.max(0, Math.min(1, t));
    }

    const projLat = aLat + t * dy;
    const projLng = aLng + t * dx;
    const d = haversineMeters(pLat, pLng, projLat, projLng);

    if (d < bestDist) {
      bestDist = d;
      bestPoint = [projLat, projLng];
      bestIdx = i;
    }
  }

  return { point: bestPoint, index: bestIdx, distance: bestDist };
}

/**
 * Flatten all segments of a route geometry into a single positions array.
 * Useful for snapping across an entire route that may have multiple segments.
 */
export function flattenRoutePositions(geometry) {
  const segments = geometryToLeafletSegments(geometry);
  return segments.flat();
}
