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
    .filter(s => s.lat !== null && s.lng !== null);
}

module.exports = transformStops;
