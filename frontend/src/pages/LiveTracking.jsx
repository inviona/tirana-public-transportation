import { useState, useEffect, useMemo, useRef } from 'react';
import { useAuth } from '../lib/auth';
import { Filter, Locate } from 'lucide-react';
import { MapContainer, TileLayer, Polyline, Marker, CircleMarker, Tooltip, Popup } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png';
import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';
import { geometryToLeafletSegments, nearestPointOnLine, flattenRoutePositions } from '../lib/mapUtils';

const TIRANA = [41.3275, 19.8187];
const OFF_ROUTE_THRESHOLD_M = 200;

delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
});

/* ─── custom bus icon ─────────────────────────────────────────────────────────── */
function createBusIcon(colour, isSelected) {
  const size = isSelected ? 40 : 32;
  const busColor = '#cf0a2c';
  const borderColor = '#ffffff';
  const html = `
    <div style="
      width: ${size}px;
      height: ${size}px;
      background: ${busColor};
      border-radius: 50%;
      border: ${isSelected ? '4px' : '3px'} solid ${borderColor};
      box-shadow: 
        0 0 0 2px rgba(0,0,0,0.3),
        0 0 ${isSelected ? '20px' : '12px'} ${busColor}80,
        0 4px 12px rgba(0,0,0,0.5);
      display: flex;
      align-items: center;
      justify-content: center;
    ">
      <div style="
        width: 0;
        height: 0;
        border-left: ${size * 0.22}px solid transparent;
        border-right: ${size * 0.22}px solid transparent;
        border-bottom: ${size * 0.3}px solid ${borderColor};
        margin-top: -2px;
      "></div>
    </div>
  `;
  return L.divIcon({
    html,
    className: 'bus-icon',
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -size / 2],
  });
}

const pulseStyle = `
  @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
  @keyframes busGlow { 0%,100%{box-shadow: 0 0 20px currentColor, 0 0 40px currentColor;} 50%{box-shadow: 0 0 30px currentColor, 0 0 60px currentColor;} }
  .bus-icon { background: transparent !important; border: none !important; }
`;

export default function LiveTracking() {
  const { token } = useAuth();
  const [vehicles, setVehicles] = useState([]);
  const [routes, setRoutes] = useState([]);
  const [mapRoutes, setMapRoutes] = useState([]);
  const [selectedRoute, setSelectedRoute] = useState('all');
  const [selected, setSelected] = useState(null);

  /* ─── NEW: live location snapping ────────────────────────────────────────── */
  const [liveMode, setLiveMode] = useState(false);
  const [liveRouteId, setLiveRouteId] = useState('');
  const [rawPosition, setRawPosition] = useState(null);
  const [snappedPosition, setSnappedPosition] = useState(null);
  const [snapDistance, setSnapDistance] = useState(null);
  const watchIdRef = useRef(null);

  useEffect(() => {
    fetch('http://localhost:3001/api/transit/routes').then((r) => r.json()).then(setRoutes);
  }, []);

  useEffect(() => {
    fetch('http://localhost:3001/api/transit/map/routes').then((r) => r.json()).then(setMapRoutes);
  }, []);

  useEffect(() => {
    const fetchVehicles = () => {
      fetch('http://localhost:3001/api/vehicles/tracking')
        .then((r) => r.json())
        .then(setVehicles);
    };
    fetchVehicles();
    const interval = setInterval(fetchVehicles, 3000);
    return () => clearInterval(interval);
  }, [token]);

  /* ─── Live location tracking ─────────────────────────────────────────────── */
  useEffect(() => {
    if (!liveMode || !navigator.geolocation) return;

    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        const raw = [pos.coords.latitude, pos.coords.longitude];
        setRawPosition(raw);
      },
      (err) => {
        console.warn('Geolocation error:', err.message);
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 3000 },
    );

    return () => {
      if (watchIdRef.current != null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
    };
  }, [liveMode]);

  /* ─── Snap raw position to selected route ────────────────────────────────── */
  const selectedRouteGeometry = useMemo(() => {
    if (!liveRouteId) return null;
    return mapRoutes.find((r) => r.id === liveRouteId);
  }, [mapRoutes, liveRouteId]);

  useEffect(() => {
    if (!rawPosition || !selectedRouteGeometry?.geometry) {
      setSnappedPosition(null);
      setSnapDistance(null);
      return;
    }

    const allPositions = flattenRoutePositions(selectedRouteGeometry.geometry);
    if (allPositions.length < 2) {
      setSnappedPosition(rawPosition);
      setSnapDistance(0);
      return;
    }

    const result = nearestPointOnLine(rawPosition, allPositions);
    setSnappedPosition(result.point);
    setSnapDistance(Math.round(result.distance));
  }, [rawPosition, selectedRouteGeometry]);

  const toggleLive = () => {
    if (liveMode) {
      setLiveMode(false);
      setRawPosition(null);
      setSnappedPosition(null);
      setSnapDistance(null);
    } else {
      if (!liveRouteId && routes.length > 0) {
        setLiveRouteId(routes[0].id);
      }
      setLiveMode(true);
    }
  };

  /* ─── filtered data ──────────────────────────────────────────────────────── */
  const selectedRef = useMemo(() => {
    if (selectedRoute === 'all') return null;
    return routes.find((r) => r.id === selectedRoute)?.ref ?? null;
  }, [routes, selectedRoute]);

  const displayedRoutes = useMemo(() => {
    if (selectedRoute === 'all') return mapRoutes;
    return mapRoutes.filter((r) => r.id === selectedRoute);
  }, [mapRoutes, selectedRoute]);

  const displayed = vehicles.filter((v) => selectedRoute === 'all' || v.routeId === selectedRoute);
  const crowdColor = (c) => (c === 'low' ? '#6ee7b7' : c === 'medium' ? '#e8b84b' : c === 'high' ? '#ef4444' : '#8892a4');
  const statusColor = (s) => (s === 'moving' ? '#6ee7b7' : s === 'stopped' ? '#e8b84b' : '#ef4444');

  const isOffRoute = snapDistance != null && snapDistance > OFF_ROUTE_THRESHOLD_M;

  return (
    <div style={{ padding: 32 }}>
      <div style={{ marginBottom: 24, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 28, fontWeight: 800, marginBottom: 6 }}>Live Tracking</h1>
          <p style={{ color: 'var(--muted)' }}>Real-time GPS positions of all active vehicles.</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          {/* "I'm on a Bus" toggle */}
          <button
            type="button"
            className={`btn ${liveMode ? 'btn-primary' : 'btn-secondary'} btn-sm`}
            onClick={toggleLive}
            style={liveMode ? {} : {}}
          >
            <Locate size={14} />
            {liveMode ? 'Stop Tracking' : "I'm on a Bus"}
          </button>

          {/* Route that user is riding (only when live mode) */}
          {liveMode && (
            <select
              value={liveRouteId}
              onChange={(e) => setLiveRouteId(e.target.value)}
              style={{ width: 200, fontSize: 12 }}
            >
              <option value="">Select your bus…</option>
              {routes.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.ref} — {r.name}
                </option>
              ))}
            </select>
          )}

          {/* Off-route badge */}
          {liveMode && isOffRoute && (
            <span className="badge badge-red" style={{ fontSize: 11 }}>
              ⚠ Off route ({snapDistance} m)
            </span>
          )}
          {liveMode && snappedPosition && !isOffRoute && (
            <span className="badge badge-green" style={{ fontSize: 11 }}>
              ✓ On route
            </span>
          )}

          <Filter size={14} color="var(--muted)" />
          <select value={selectedRoute} onChange={(e) => setSelectedRoute(e.target.value)} style={{ width: 220 }}>
            <option value="all">All Routes</option>
            {routes.map((r) => (
              <option key={r.id} value={r.id}>
                Route {r.ref} — {r.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 24 }}>
        <div className="card" style={{ padding: 0, overflow: 'hidden', position: 'relative' }}>
          <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#6ee7b7', animation: 'pulse 2s infinite' }} />
            <span style={{ fontSize: 13, fontWeight: 600 }}>Live Map — Tirana</span>
            <span style={{ fontSize: 11, color: 'var(--muted)', marginLeft: 'auto' }}>
              {displayed.length} buses tracked
            </span>
          </div>
          <div style={{ height: 520, width: '100%' }}>
            <MapContainer center={TIRANA} zoom={13} style={{ height: '100%', width: '100%' }} scrollWheelZoom>
              <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />

              {/* Route lines */}
              {displayedRoutes.map((route) =>
                geometryToLeafletSegments(route.geometry).map((positions, segIdx) => (
                  <Polyline key={`${route.id}-${segIdx}`} positions={positions} pathOptions={{ color: route.colour, weight: 4, opacity: 0.85 }} />
                )),
              )}

              {/* Vehicles */}
              {displayed.map((v) => {
                const colour = v.route?.colour || '#555555';
                const isSel = selected?.id === v.id;
                const busIcon = createBusIcon(colour, isSel);
                return (
                  <Marker
                    key={v.id}
                    position={[v.lat, v.lng]}
                    icon={busIcon}
                    eventHandlers={{
                      click: () => setSelected(selected?.id === v.id ? null : v),
                    }}
                  >
                    <Tooltip direction="top" offset={[0, -10]} opacity={1}>
                      <span style={{ fontWeight: 600 }}>{v.route?.ref || '?'}</span> · {v.plate}
                    </Tooltip>
                  </Marker>
                );
              })}

              {/* ─── Live location blue dot (snapped) ──────────────────────── */}
              {liveMode && snappedPosition && (
                <CircleMarker
                  center={snappedPosition}
                  radius={12}
                  pathOptions={{
                    color: '#ffffff',
                    weight: 3,
                    fillColor: isOffRoute ? '#ef4444' : '#4e9eff',
                    fillOpacity: 0.95,
                  }}
                >
                  <Tooltip direction="top" offset={[0, -10]} opacity={1} permanent>
                    <span style={{ fontWeight: 700, color: isOffRoute ? '#ef4444' : '#4e9eff' }}>
                      📍 You {isOffRoute ? `(${snapDistance}m off)` : ''}
                    </span>
                  </Tooltip>
                </CircleMarker>
              )}

              {/* Raw position ghost dot (faint, for debugging) */}
              {liveMode && rawPosition && snappedPosition && (
                <CircleMarker
                  center={rawPosition}
                  radius={5}
                  pathOptions={{
                    color: 'rgba(78,158,255,0.4)',
                    weight: 1,
                    fillColor: 'rgba(78,158,255,0.2)',
                    fillOpacity: 0.5,
                  }}
                />
              )}


            </MapContainer>
          </div>
          <style dangerouslySetInnerHTML={{ __html: pulseStyle }} />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxHeight: 560, overflowY: 'auto' }}>
          {displayed.map((v) => (
            <div
              key={v.id}
              onClick={() => setSelected(selected?.id === v.id ? null : v)}
              className="card"
              style={{
                padding: '14px 16px',
                cursor: 'pointer',
                border: `1px solid ${selected?.id === v.id ? (v.route?.colour || 'var(--accent)') : 'var(--border)'}`,
                background: selected?.id === v.id ? `${v.route?.colour || '#e8b84b'}10` : 'var(--card)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: 8,
                    background: v.route?.colour || '#444',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontFamily: 'Syne',
                    fontWeight: 800,
                    fontSize: 12,
                    color: '#fff',
                    flexShrink: 0,
                  }}
                >
                  {v.route?.ref || '?'}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{v.plate}</div>
                  <div style={{ fontSize: 11, color: 'var(--muted)' }}>{v.route?.name || 'Unknown'}</div>
                </div>
                <div
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    background: statusColor(v.status),
                    boxShadow: v.status === 'moving' ? `0 0 6px ${statusColor(v.status)}` : 'none',
                  }}
                />
              </div>
              {selected?.id === v.id && (
                <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border)', fontSize: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--muted)' }}>Status</span>
                    <span style={{ color: statusColor(v.status), fontWeight: 600, textTransform: 'capitalize' }}>{v.status}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--muted)' }}>Speed</span>
                    <span>{v.speed} km/h</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--muted)' }}>Crowd Level</span>
                    <span style={{ color: crowdColor(v.crowdLevel), fontWeight: 600, textTransform: 'capitalize' }}>{v.crowdLevel}</span>
                  </div>
                  {v.prevStop && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                      <span style={{ color: 'var(--muted)' }}>← Prev</span>
                      <span style={{ color: 'var(--muted)', fontSize: 11, maxWidth: 140, textAlign: 'right', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v.prevStop}</span>
                    </div>
                  )}
                  {v.nextStop && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                      <span style={{ color: 'var(--accent2)' }}>→ Next</span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ color: 'var(--accent2)', fontSize: 11, maxWidth: 120, textAlign: 'right', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v.nextStop}</span>
                        {v.eta && <span style={{ fontSize: 10, color: 'var(--muted)', background: 'var(--bg3)', padding: '2px 6px', borderRadius: 4 }}>{v.eta}min</span>}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
