import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { MapContainer, TileLayer, Polyline, Marker, Popup, CircleMarker, Tooltip, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png';
import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';
import { Search, MapPin, Navigation, X, ArrowRight, Footprints, Building2, Clock, Locate } from 'lucide-react';
import { geometryToLeafletSegments, haversineMeters, orsGeometryToLeaflet } from '../lib/mapUtils';

const API = 'http://localhost:3001';
const TIRANA = [41.3275, 19.8187];
const NEARBY_MAX_M = 500;
const AUTOCOMPLETE_LIMIT = 8;

delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
});

/* ─── tiny helpers ──────────────────────────────────────────────────────────── */

function useOnClickOutside(ref, handler, active) {
  useEffect(() => {
    if (!active) return;
    const fn = (e) => {
      if (ref.current && !ref.current.contains(e.target)) handler();
    };
    document.addEventListener('mousedown', fn);
    return () => document.removeEventListener('mousedown', fn);
  }, [ref, handler, active]);
}

function FitBounds({ bounds }) {
  const map = useMap();
  useEffect(() => {
    if (bounds?.isValid()) map.fitBounds(bounds, { padding: [40, 40], maxZoom: 15 });
  }, [bounds, map]);
  return null;
}

function MapResizeNotifier({ trigger }) {
  const map = useMap();
  useEffect(() => {
    const fix = () => map.invalidateSize({ animate: false });
    fix();
    const id = requestAnimationFrame(fix);
    const t = window.setTimeout(fix, 200);
    window.addEventListener('resize', fix);
    return () => {
      cancelAnimationFrame(id);
      window.clearTimeout(t);
      window.removeEventListener('resize', fix);
    };
  }, [map, trigger]);
  return null;
}

/* ─── institution icon colours by type ──────────────────────────────────────── */
const INST_COLORS = {
  university: '#4e9eff',
  school: '#6ee7b7',
  hospital: '#ef4444',
  government: '#e8b84b',
  landmark: '#c084fc',
  culture: '#f472b6',
  shopping: '#fb923c',
  sport: '#34d399',
  transport: '#38bdf8',
  hotel: '#fbbf24',
  embassy: '#a78bfa',
};

function instColor(type) {
  return INST_COLORS[type] || '#8892a4';
}

/* ─── stop search field ─────────────────────────────────────────────────────── */

function StopSearchField({
  label,
  pinColor,
  value,
  onInputChange,
  selectedStop,
  matches,
  open,
  onOpen,
  onClose,
  onSelectStop,
}) {
  return (
    <div>
      <label>{label}</label>
      <div style={{ position: 'relative' }}>
        <MapPin size={14} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: pinColor, pointerEvents: 'none' }} />
        <input
          value={value}
          onChange={(e) => onInputChange(e.target.value)}
          onFocus={() => onOpen()}
          placeholder="Search 500+ stops…"
          autoComplete="off"
          style={{ paddingLeft: 36, paddingRight: selectedStop ? 36 : 14 }}
        />
        {selectedStop && (
          <button
            type="button"
            aria-label="Clear stop"
            onClick={() => {
              onInputChange('');
              onSelectStop(null);
            }}
            className="btn btn-secondary"
            style={{ position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)', padding: '4px 8px', minHeight: 0, height: 28 }}
          >
            <X size={14} />
          </button>
        )}
        {open && matches.length > 0 && (
          <div
            style={{
              position: 'absolute',
              zIndex: 50,
              left: 0,
              right: 0,
              top: '100%',
              marginTop: 4,
              background: 'var(--bg2)',
              border: '1px solid var(--border)',
              borderRadius: 10,
              maxHeight: 260,
              overflowY: 'auto',
              boxShadow: '0 12px 40px rgba(0,0,0,0.45)',
            }}
          >
            {matches.map((s) => (
              <button
                key={s.id}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onSelectStop(s);
                  onClose();
                }}
                style={{
                  display: 'block',
                  width: '100%',
                  textAlign: 'left',
                  padding: '10px 14px',
                  border: 'none',
                  background: 'transparent',
                  color: 'var(--text)',
                  cursor: 'pointer',
                  fontSize: 13,
                  borderBottom: '1px solid var(--border)',
                }}
              >
                <span style={{ fontWeight: 600 }}>{s.name}</span>
                <span style={{ display: 'block', fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
                  {(s.routes || []).map((r) => r.ref).filter(Boolean).slice(0, 6).join(' · ') || '—'}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════════
   MAIN COMPONENT
   ═══════════════════════════════════════════════════════════════════════════════ */

export default function JourneyPlanner() {
  /* ─── existing state ─────────────────────────────────────────────────────── */
  const [stops, setStops] = useState([]);
  const [mapRoutes, setMapRoutes] = useState([]);
  const [fromInput, setFromInput] = useState('');
  const [toInput, setToInput] = useState('');
  const [fromStop, setFromStop] = useState(null);
  const [toStop, setToStop] = useState(null);
  const [openFrom, setOpenFrom] = useState(false);
  const [openTo, setOpenTo] = useState(false);
  const [nearby, setNearby] = useState([]);
  const [nearbyStatus, setNearbyStatus] = useState('');
  const [loadingStops, setLoadingStops] = useState(true);
  const [planLoading, setPlanLoading] = useState(false);
  const [plan, setPlan] = useState(null);
  const [highlight, setHighlight] = useState(null);

  /* ─── NEW state: address → nearest stop → walking route ──────────────────── */
  const [addressInput, setAddressInput] = useState('');
  const [geocodeResults, setGeocodeResults] = useState([]);
  const [geocodeOpen, setGeocodeOpen] = useState(false);
  const [selectedAddress, setSelectedAddress] = useState(null);
  const [geocodeLoading, setGeocodeLoading] = useState(false);
  const [nearestStopResult, setNearestStopResult] = useState(null);
  const [walkingRoute, setWalkingRoute] = useState(null);
  const [walkingLoading, setWalkingLoading] = useState(false);
  const [findRouteError, setFindRouteError] = useState('');

  /* ─── NEW state: institutions ────────────────────────────────────────────── */
  const [institutions, setInstitutions] = useState([]);
  const [showInstitutions, setShowInstitutions] = useState(false);

  const fromWrapRef = useRef(null);
  const toWrapRef = useRef(null);
  const addressWrapRef = useRef(null);
  const geocodeTimerRef = useRef(null);

  /* ─── data fetching ──────────────────────────────────────────────────────── */
  useEffect(() => {
    fetch(`${API}/api/stops`)
      .then((r) => r.json())
      .then(setStops)
      .catch(() => setStops([]))
      .finally(() => setLoadingStops(false));
  }, []);

  useEffect(() => {
    fetch(`${API}/api/map/routes`)
      .then((r) => r.json())
      .then(setMapRoutes)
      .catch(() => setMapRoutes([]));
  }, []);

  useEffect(() => {
    fetch(`${API}/api/institutions`)
      .then((r) => r.json())
      .then(setInstitutions)
      .catch(() => setInstitutions([]));
  }, []);

  /* ─── click-outside ──────────────────────────────────────────────────────── */
  const closeFrom = useCallback(() => setOpenFrom(false), []);
  const closeTo = useCallback(() => setOpenTo(false), []);
  const closeGeocode = useCallback(() => setGeocodeOpen(false), []);
  useOnClickOutside(fromWrapRef, closeFrom, openFrom);
  useOnClickOutside(toWrapRef, closeTo, openTo);
  useOnClickOutside(addressWrapRef, closeGeocode, geocodeOpen);

  /* ─── stop autocomplete filtering ────────────────────────────────────────── */
  const fromMatches = useMemo(() => {
    const q = fromInput.trim().toLowerCase();
    if (!q) return [];
    return stops.filter((s) => s.name.toLowerCase().includes(q)).slice(0, AUTOCOMPLETE_LIMIT);
  }, [stops, fromInput]);

  const toMatches = useMemo(() => {
    const q = toInput.trim().toLowerCase();
    if (!q) return [];
    return stops.filter((s) => s.name.toLowerCase().includes(q)).slice(0, AUTOCOMPLETE_LIMIT);
  }, [stops, toInput]);

  const onFromInput = (v) => {
    setFromInput(v);
    if (fromStop && v !== fromStop.name) setFromStop(null);
    setOpenFrom(true);
  };

  const onToInput = (v) => {
    setToInput(v);
    if (toStop && v !== toStop.name) setToStop(null);
    setOpenTo(true);
  };

  const selectFrom = (s) => {
    if (!s) { setFromStop(null); setFromInput(''); return; }
    setFromStop(s);
    setFromInput(s.name);
  };

  const selectTo = (s) => {
    if (!s) { setToStop(null); setToInput(''); return; }
    setToStop(s);
    setToInput(s.name);
  };

  /* ─── ADDRESS GEOCODING (debounced) ──────────────────────────────────────── */
  const onAddressInput = (v) => {
    setAddressInput(v);
    setGeocodeOpen(true);
    if (selectedAddress) {
      setSelectedAddress(null);
      setNearestStopResult(null);
      setWalkingRoute(null);
    }

    clearTimeout(geocodeTimerRef.current);
    if (v.trim().length < 3) { setGeocodeResults([]); return; }

    geocodeTimerRef.current = setTimeout(async () => {
      setGeocodeLoading(true);
      try {
        const res = await fetch(`${API}/api/geocode?q=${encodeURIComponent(v.trim())}`);
        const data = await res.json();
        setGeocodeResults(Array.isArray(data) ? data : []);
      } catch {
        setGeocodeResults([]);
      } finally {
        setGeocodeLoading(false);
      }
    }, 500);
  };

  /* ─── SELECT ADDRESS → FIND NEAREST STOP → WALKING ──────────────────────── */
  const selectAddress = async (addr) => {
    setSelectedAddress(addr);
    setAddressInput(addr.display_name.split(',')[0]);
    setGeocodeOpen(false);
    setFindRouteError('');
    setWalkingRoute(null);
    setNearestStopResult(null);
    setWalkingLoading(true);

    try {
      // 1. Find nearest stop
      const stopRes = await fetch(`${API}/api/nearest-stop`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lat: addr.lat, lng: addr.lng }),
      });
      const stopData = await stopRes.json();
      setNearestStopResult(stopData);

      if (!stopData.stop) {
        setFindRouteError('No bus stops found nearby.');
        setWalkingLoading(false);
        return;
      }

      // 2. Get walking route from address to nearest stop
      const walkRes = await fetch(`${API}/api/walking-route`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: [addr.lng, addr.lat],
          to: [stopData.stop.lng, stopData.stop.lat],
        }),
      });
      const walkData = await walkRes.json();
      if (walkData.error) {
        setFindRouteError(walkData.error);
      } else {
        setWalkingRoute(walkData);
      }
    } catch {
      setFindRouteError('Could not calculate walking route. Is the API running?');
    } finally {
      setWalkingLoading(false);
    }
  };

  const clearAddress = () => {
    setAddressInput('');
    setSelectedAddress(null);
    setGeocodeResults([]);
    setNearestStopResult(null);
    setWalkingRoute(null);
    setFindRouteError('');
  };

  /* ─── nearby stops ───────────────────────────────────────────────────────── */
  const findNearby = () => {
    setNearbyStatus('Locating…');
    setNearby([]);
    if (!navigator.geolocation) {
      setNearbyStatus('Geolocation is not supported in this browser.');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude: lat, longitude: lng } = pos.coords;
        const withDist = stops
          .map((s) => ({ ...s, dist: haversineMeters(lat, lng, s.lat, s.lng) }))
          .filter((s) => s.dist < NEARBY_MAX_M)
          .sort((a, b) => a.dist - b.dist);
        setNearby(withDist);
        setNearbyStatus(withDist.length ? `${withDist.length} stops within ${NEARBY_MAX_M} m` : `No stops within ${NEARBY_MAX_M} m`);
      },
      () => {
        setNearbyStatus('Could not read your location (permission denied or unavailable).');
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 },
    );
  };

  /* ─── "Use My Location" for address search ───────────────────────────────── */
  const useMyLocation = () => {
    if (!navigator.geolocation) return;
    setWalkingLoading(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const addr = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          display_name: 'My Location',
        };
        selectAddress(addr);
      },
      () => {
        setFindRouteError('Could not get your location.');
        setWalkingLoading(false);
      },
      { enableHighAccuracy: true, timeout: 12000 },
    );
  };

  /* ─── stop-to-stop planner ───────────────────────────────────────────────── */
  const runPlan = async () => {
    if (!fromStop || !toStop) return;
    setPlanLoading(true);
    setPlan(null);
    setHighlight(null);
    try {
      const res = await fetch(`${API}/api/journey/plan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fromStopId: fromStop.id, toStopId: toStop.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Plan failed');
      setPlan(data);
    } catch {
      setPlan({ error: 'Could not load journey plan. Is the API running?' });
    } finally {
      setPlanLoading(false);
    }
  };

  /* ─── map data ───────────────────────────────────────────────────────────── */
  const routesById = useMemo(() => {
    const m = new Map();
    mapRoutes.forEach((r) => m.set(r.id, r));
    return m;
  }, [mapRoutes]);

  const highlightedPolylines = useMemo(() => {
    if (!highlight) return [];
    const rows = [];
    if (highlight.kind === 'direct' && highlight.routeId) {
      const r = routesById.get(highlight.routeId);
      if (r) rows.push(r);
    }
    if (highlight.kind === 'transfer') {
      if (highlight.routeId1) {
        const a = routesById.get(highlight.routeId1);
        if (a) rows.push({ ...a, _weight: 5 });
      }
      if (highlight.routeId2) {
        const b = routesById.get(highlight.routeId2);
        if (b) rows.push({ ...b, _weight: 5 });
      }
    }
    return rows;
  }, [highlight, routesById]);

  /* ─── walking path as Leaflet positions ──────────────────────────────────── */
  const walkingPositions = useMemo(() => {
    if (!walkingRoute?.geometry) return [];
    return orsGeometryToLeaflet(walkingRoute.geometry);
  }, [walkingRoute]);

  /* ─── map bounds ─────────────────────────────────────────────────────────── */
  const bounds = useMemo(() => {
    const b = L.latLngBounds([]);
    let any = false;
    const extend = (pt) => { b.extend(pt); any = true; };

    highlightedPolylines.forEach((route) => {
      geometryToLeafletSegments(route.geometry).forEach((seg) => seg.forEach(extend));
    });
    walkingPositions.forEach(extend);

    if (fromStop) extend([fromStop.lat, fromStop.lng]);
    if (toStop) extend([toStop.lat, toStop.lng]);
    if (selectedAddress) extend([selectedAddress.lat, selectedAddress.lng]);
    if (nearestStopResult?.stop) extend([nearestStopResult.stop.lat, nearestStopResult.stop.lng]);
    if (highlight?.kind === 'transfer' && highlight.viaLat != null) extend([highlight.viaLat, highlight.viaLng]);

    return any ? b : null;
  }, [highlightedPolylines, walkingPositions, fromStop, toStop, selectedAddress, nearestStopResult, highlight]);

  /* ═══════════════════════════════════════════════════════════════════════════
     RENDER
     ═══════════════════════════════════════════════════════════════════════════ */

  const formatDuration = (s) => {
    const m = Math.round(s / 60);
    return m < 60 ? `${m} min` : `${Math.floor(m / 60)} hr ${m % 60} min`;
  };

  return (
    <div style={{ padding: '24px 32px 32px', width: '100%', maxWidth: '100%', boxSizing: 'border-box' }}>
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontSize: 28, fontWeight: 800, marginBottom: 6 }}>Plan Your Route</h1>
        <p style={{ color: 'var(--muted)' }}>Search an address or pick stops to find your best transit route.</p>
      </div>

      {/* ─── FIND ROUTE FROM ADDRESS (NEW) ─────────────────────────────────── */}
      <div className="card" style={{ marginBottom: 20, borderColor: selectedAddress ? 'rgba(78,158,255,0.35)' : 'var(--border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
          <div style={{ background: 'rgba(78,158,255,0.15)', borderRadius: 8, padding: 6, display: 'flex' }}>
            <Footprints size={16} color="var(--accent2)" />
          </div>
          <div>
            <div style={{ fontFamily: 'Syne', fontWeight: 700, fontSize: 15 }}>Find Route from Address</div>
            <div style={{ fontSize: 11, color: 'var(--muted)' }}>Type an address → find nearest stop → see walking directions</div>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', gap: 12, alignItems: 'end' }}>
          <div ref={addressWrapRef} style={{ position: 'relative' }}>
            <label>Address or place</label>
            <div style={{ position: 'relative' }}>
              <Search size={14} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--accent2)', pointerEvents: 'none' }} />
              <input
                id="address-search-input"
                value={addressInput}
                onChange={(e) => onAddressInput(e.target.value)}
                onFocus={() => geocodeResults.length > 0 && setGeocodeOpen(true)}
                placeholder="e.g. Rruga e Kavajës, Bulevardi Zogu I …"
                autoComplete="off"
                style={{ paddingLeft: 36, paddingRight: selectedAddress ? 36 : 14 }}
              />
              {selectedAddress && (
                <button
                  type="button"
                  aria-label="Clear address"
                  onClick={clearAddress}
                  className="btn btn-secondary"
                  style={{ position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)', padding: '4px 8px', minHeight: 0, height: 28 }}
                >
                  <X size={14} />
                </button>
              )}
              {geocodeOpen && geocodeResults.length > 0 && (
                <div
                  style={{
                    position: 'absolute', zIndex: 60, left: 0, right: 0, top: '100%', marginTop: 4,
                    background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 10,
                    maxHeight: 260, overflowY: 'auto', boxShadow: '0 12px 40px rgba(0,0,0,0.45)',
                  }}
                >
                  {geocodeResults.map((addr, i) => (
                    <button
                      key={i}
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => selectAddress(addr)}
                      style={{
                        display: 'block', width: '100%', textAlign: 'left', padding: '10px 14px',
                        border: 'none', background: 'transparent', color: 'var(--text)',
                        cursor: 'pointer', fontSize: 13, borderBottom: '1px solid var(--border)',
                      }}
                    >
                      <span style={{ fontWeight: 600 }}>{addr.display_name.split(',')[0]}</span>
                      <span style={{ display: 'block', fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
                        {addr.display_name.split(',').slice(1, 3).join(',')}
                      </span>
                    </button>
                  ))}
                </div>
              )}
              {geocodeLoading && (
                <div style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', fontSize: 11, color: 'var(--muted)' }}>
                  Searching…
                </div>
              )}
            </div>
          </div>
          <button type="button" className="btn btn-secondary" onClick={useMyLocation} style={{ height: 42, whiteSpace: 'nowrap' }}>
            <Locate size={15} /> My Location
          </button>
          {selectedAddress && (
            <button type="button" className="btn btn-primary" disabled style={{ height: 42, opacity: 0.6, cursor: 'default' }}>
              {walkingLoading ? 'Calculating…' : '✓ Found'}
            </button>
          )}
        </div>

        {/* Walking result card */}
        {walkingLoading && (
          <div style={{ marginTop: 16, padding: '16px 20px', borderRadius: 12, background: 'var(--bg3)', border: '1px solid var(--border)', textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
            <div className="walking-spinner" style={{ display: 'inline-block', width: 18, height: 18, border: '2px solid var(--border)', borderTopColor: 'var(--accent2)', borderRadius: '50%', marginRight: 8, verticalAlign: 'middle' }} />
            Calculating walking route…
          </div>
        )}

        {findRouteError && (
          <div style={{ marginTop: 16, padding: '12px 16px', borderRadius: 12, background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', color: 'var(--red)', fontSize: 13 }}>
            {findRouteError}
          </div>
        )}

        {nearestStopResult && !walkingLoading && (
          <div style={{ marginTop: 16, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            {/* Nearest stop info */}
            <div style={{ padding: '16px 20px', borderRadius: 12, background: 'var(--bg3)', border: '1px solid var(--border)' }}>
              <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--muted)', marginBottom: 8 }}>Nearest Bus Stop</div>
              <div style={{ fontSize: 16, fontFamily: 'Syne', fontWeight: 700, marginBottom: 4 }}>{nearestStopResult.stop?.name || '—'}</div>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', fontSize: 12 }}>
                <span style={{ color: nearestStopResult.withinRadius ? 'var(--accent3)' : 'var(--red)' }}>
                  📍 {nearestStopResult.distanceM} m {!nearestStopResult.withinRadius && '(far)'}
                </span>
                {nearestStopResult.stop?.routes?.length > 0 && (
                  <span style={{ color: 'var(--accent2)' }}>
                    🚌 {nearestStopResult.stop.routes.map(r => r.ref).filter(Boolean).join(', ')}
                  </span>
                )}
              </div>
              {/* Quick action: use this stop as "From" in the planner */}
              {nearestStopResult.stop && (
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  style={{ marginTop: 10 }}
                  onClick={() => {
                    selectFrom(nearestStopResult.stop);
                    setFromInput(nearestStopResult.stop.name);
                  }}
                >
                  Use as departure stop
                </button>
              )}
            </div>

            {/* Walking stats */}
            {walkingRoute && (
              <div style={{ padding: '16px 20px', borderRadius: 12, background: 'var(--bg3)', border: '1px solid var(--border)' }}>
                <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--muted)', marginBottom: 8 }}>Walking Directions</div>
                <div style={{ display: 'flex', gap: 20, alignItems: 'center' }}>
                  <div>
                    <div style={{ fontSize: 28, fontFamily: 'Syne', fontWeight: 800, color: 'var(--accent2)' }}>
                      {formatDuration(walkingRoute.duration_s)}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                      <Footprints size={12} style={{ verticalAlign: 'middle', marginRight: 4 }} />
                      {walkingRoute.distance_m} m walk
                    </div>
                  </div>
                  <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <div style={{
                      display: 'flex', alignItems: 'center', gap: 6, padding: '6px 14px',
                      borderRadius: 20, background: 'rgba(78,158,255,0.12)', border: '1px solid rgba(78,158,255,0.25)',
                      fontSize: 12, fontWeight: 600, color: 'var(--accent2)',
                    }}>
                      <Clock size={12} />
                      {formatDuration(walkingRoute.duration_s)}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ─── EXISTING STOP-TO-STOP PLANNER ─────────────────────────────────── */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 16, alignItems: 'end' }}>
          <div ref={fromWrapRef}>
            <StopSearchField
              label="From"
              pinColor="var(--accent3)"
              value={fromInput}
              onInputChange={onFromInput}
              selectedStop={fromStop}
              matches={fromMatches}
              open={openFrom}
              onOpen={() => setOpenFrom(true)}
              onClose={closeFrom}
              onSelectStop={selectFrom}
            />
          </div>
          <div ref={toWrapRef}>
            <StopSearchField
              label="To"
              pinColor="var(--red)"
              value={toInput}
              onInputChange={onToInput}
              selectedStop={toStop}
              matches={toMatches}
              open={openTo}
              onOpen={() => setOpenTo(true)}
              onClose={closeTo}
              onSelectStop={selectTo}
            />
          </div>
          <button
            type="button"
            className="btn btn-primary"
            onClick={runPlan}
            disabled={planLoading || !fromStop || !toStop || loadingStops}
            style={{ padding: '10px 24px', height: 42, whiteSpace: 'nowrap' }}
          >
            <Search size={15} /> {planLoading ? 'Planning…' : 'Find routes'}
          </button>
        </div>

        <div style={{ marginTop: 18, paddingTop: 16, borderTop: '1px solid var(--border)', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12 }}>
          <button type="button" className="btn btn-secondary btn-sm" onClick={findNearby}>
            <Navigation size={14} /> Nearby stops ({NEARBY_MAX_M} m)
          </button>
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>{nearbyStatus}</span>
        </div>

        {nearby.length > 0 && (
          <div style={{ marginTop: 14, maxHeight: 200, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
            {nearby.map((s) => (
              <div
                key={s.id}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
                  padding: '8px 12px', borderRadius: 10, background: 'var(--bg3)',
                  border: '1px solid var(--border)', fontSize: 13,
                }}
              >
                <div>
                  <span style={{ fontWeight: 600 }}>{s.name}</span>
                  <span style={{ color: 'var(--muted)', marginLeft: 8 }}>{Math.round(s.dist)} m</span>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => selectFrom(s)}>From</button>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => selectTo(s)}>To</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ─── MAP + RESULTS GRID ────────────────────────────────────────────── */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1fr) minmax(280px, 360px)',
          gap: 24,
          alignItems: 'start',
          width: '100%',
        }}
      >
        <div className="card" style={{ padding: 0, overflow: 'hidden', width: '100%', minWidth: 0 }}>
          <div style={{ padding: '12px 18px', borderBottom: '1px solid var(--border)', fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              Route preview
              <span style={{ fontWeight: 400, color: 'var(--muted)', marginLeft: 8 }}>
                {walkingRoute ? 'Walking path shown' : highlight ? 'GPS path from OpenStreetMap' : 'Select a journey option below'}
              </span>
            </div>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => setShowInstitutions(!showInstitutions)}
              style={{ fontSize: 11, padding: '4px 10px', gap: 4, borderColor: showInstitutions ? 'rgba(232,184,75,0.4)' : 'var(--border)' }}
            >
              <Building2 size={12} />
              {showInstitutions ? 'Hide' : 'Show'} Landmarks
            </button>
          </div>
          <div style={{ height: 460, width: '100%', minWidth: 0, position: 'relative' }}>
            <MapContainer
              center={TIRANA}
              zoom={13}
              style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
              scrollWheelZoom
            >
              <MapResizeNotifier trigger={highlight || walkingRoute} />
              <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
              {bounds && <FitBounds bounds={bounds} />}

              {/* Route polylines */}
              {highlightedPolylines.map((route) =>
                geometryToLeafletSegments(route.geometry).map((positions, segIdx) => (
                  <Polyline
                    key={`${route.id}-${segIdx}`}
                    positions={positions}
                    pathOptions={{ color: route.colour, weight: route._weight || 6, opacity: 0.92 }}
                  />
                )),
              )}

              {/* Walking path */}
              {walkingPositions.length > 0 && (
                <Polyline
                  positions={walkingPositions}
                  pathOptions={{ color: '#4e9eff', weight: 5, opacity: 0.9, dashArray: '10 8' }}
                />
              )}

              {/* Address marker */}
              {selectedAddress && (
                <CircleMarker
                  center={[selectedAddress.lat, selectedAddress.lng]}
                  radius={10}
                  pathOptions={{ color: '#4e9eff', fillColor: '#4e9eff', fillOpacity: 0.85, weight: 3 }}
                >
                  <Tooltip direction="top" offset={[0, -8]} opacity={1} permanent>
                    <span style={{ fontWeight: 600 }}>📍 {addressInput || 'Your address'}</span>
                  </Tooltip>
                </CircleMarker>
              )}

              {/* Nearest stop marker (green) */}
              {nearestStopResult?.stop && (
                <CircleMarker
                  center={[nearestStopResult.stop.lat, nearestStopResult.stop.lng]}
                  radius={9}
                  pathOptions={{ color: '#6ee7b7', fillColor: '#6ee7b7', fillOpacity: 0.85, weight: 3 }}
                >
                  <Popup>
                    <strong>🚏 {nearestStopResult.stop.name}</strong><br />
                    {nearestStopResult.distanceM} m away<br />
                    Routes: {nearestStopResult.stop.routes?.map(r => r.ref).filter(Boolean).join(', ') || '—'}
                  </Popup>
                </CircleMarker>
              )}

              {/* From / To stop markers */}
              {fromStop && (
                <Marker position={[fromStop.lat, fromStop.lng]}>
                  <Popup>From: {fromStop.name}</Popup>
                </Marker>
              )}
              {toStop && (
                <Marker position={[toStop.lat, toStop.lng]}>
                  <Popup>To: {toStop.name}</Popup>
                </Marker>
              )}
              {highlight?.kind === 'transfer' && highlight.viaLat != null && (
                <Marker position={[highlight.viaLat, highlight.viaLng]}>
                  <Popup>Change: {highlight.viaName}</Popup>
                </Marker>
              )}

              {/* Institutions layer */}
              {showInstitutions && institutions.map((inst) => (
                <CircleMarker
                  key={inst.id}
                  center={[inst.lat, inst.lng]}
                  radius={5}
                  pathOptions={{ color: instColor(inst.type), fillColor: instColor(inst.type), fillOpacity: 0.7, weight: 1.5 }}
                >
                  <Tooltip direction="top" offset={[0, -4]} opacity={0.92}>
                    <span style={{ fontSize: 11 }}>{inst.name}</span>
                  </Tooltip>
                </CircleMarker>
              ))}
            </MapContainer>
          </div>
        </div>

        {/* ─── RESULTS SIDEBAR ───────────────────────────────────────────── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, maxHeight: 520, overflowY: 'auto' }}>
          {plan?.error && <div className="card" style={{ borderColor: 'var(--red)', color: 'var(--red)', fontSize: 13 }}>{plan.error}</div>}

          {plan && !plan.error && (
            <>
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                <strong style={{ color: 'var(--text)' }}>{plan.fromStop?.name}</strong>
                <ArrowRight size={12} style={{ display: 'inline', verticalAlign: 'middle', margin: '0 6px' }} />
                <strong style={{ color: 'var(--text)' }}>{plan.toStop?.name}</strong>
              </div>

              {plan.message && (
                <div className="card" style={{ fontSize: 13, color: 'var(--muted)' }}>
                  {plan.message}
                </div>
              )}

              {plan.direct?.length > 0 && (
                <div>
                  <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--muted)', marginBottom: 8 }}>Direct</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {plan.direct.map((d) => {
                      const active = highlight?.kind === 'direct' && highlight.routeId === d.routeId;
                      return (
                        <button
                          key={d.routeId || d.ref}
                          type="button"
                          onClick={() => setHighlight({ kind: 'direct', routeId: d.routeId })}
                          className="card"
                          style={{
                            padding: '12px 14px', cursor: 'pointer', textAlign: 'left',
                            borderColor: active ? d.colour : 'var(--border)',
                            background: active ? `${d.colour}14` : 'var(--card)',
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <div
                              style={{
                                width: 40, height: 40, borderRadius: 10, background: d.colour,
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                color: '#fff', fontFamily: 'Syne', fontWeight: 800, fontSize: 12, flexShrink: 0,
                              }}
                            >
                              {d.ref}
                            </div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontFamily: 'Syne', fontWeight: 700 }}>Line {d.ref}</div>
                              <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{d.name}</div>
                            </div>
                          </div>

                          {active && d.intermediateStops && d.intermediateStops.length > 0 && (
                            <div style={{ marginTop: 16, paddingLeft: 20, position: 'relative' }}>
                              <div style={{ position: 'absolute', left: 8, top: 4, bottom: 4, width: 2, background: d.colour, opacity: 0.3, borderRadius: 2 }} />
                              
                              <div style={{ position: 'relative', marginBottom: 10, fontSize: 12 }}>
                                <div style={{ position: 'absolute', left: -16, top: 4, width: 6, height: 6, borderRadius: '50%', background: 'var(--accent3)' }} />
                                <strong style={{ color: 'var(--text)' }}>{plan.fromStop?.name}</strong>
                              </div>

                              {d.intermediateStops.map((stop, i) => (
                                <div key={i} style={{ position: 'relative', marginBottom: 6, fontSize: 11, color: 'var(--muted)' }}>
                                  <div style={{ position: 'absolute', left: -15, top: 5, width: 4, height: 4, borderRadius: '50%', background: d.colour }} />
                                  {stop.name}
                                </div>
                              ))}

                              <div style={{ position: 'relative', marginTop: 10, fontSize: 12 }}>
                                <div style={{ position: 'absolute', left: -16, top: 4, width: 6, height: 6, borderRadius: '50%', background: 'var(--red)' }} />
                                <strong style={{ color: 'var(--text)' }}>{plan.toStop?.name}</strong>
                              </div>
                            </div>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {plan.transfers?.length > 0 && (
                <div>
                  <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--muted)', marginBottom: 8 }}>One transfer</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {plan.transfers.map((t, idx) => {
                      const active =
                        highlight?.kind === 'transfer' &&
                        highlight.routeId1 === t.leg1.routeId &&
                        highlight.routeId2 === t.leg2.routeId &&
                        highlight.viaStopId === t.viaStopId;
                      return (
                        <button
                          key={`${t.viaStopId}-${t.leg1.ref}-${t.leg2.ref}-${idx}`}
                          type="button"
                          onClick={() =>
                            setHighlight({
                              kind: 'transfer',
                              routeId1: t.leg1.routeId,
                              routeId2: t.leg2.routeId,
                              viaStopId: t.viaStopId,
                              viaLat: t.viaLat,
                              viaLng: t.viaLng,
                              viaName: t.viaStopName,
                            })
                          }
                          className="card"
                          style={{
                            padding: '12px 14px', cursor: 'pointer', textAlign: 'left',
                            borderColor: active ? t.leg1.colour : 'var(--border)',
                            background: active ? `${t.leg1.colour}12` : 'var(--card)',
                          }}
                        >
                          <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 6 }}>Change at {t.viaStopName}</div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: 13 }}>
                            <span style={{ fontWeight: 700, color: t.leg1.colour }}>{t.leg1.ref}</span>
                            <ArrowRight size={14} color="var(--muted)" />
                            <span style={{ fontWeight: 700, color: t.leg2.colour }}>{t.leg2.ref}</span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </>
          )}

          {!plan && !planLoading && (
            <div style={{ textAlign: 'center', padding: 32, color: 'var(--muted)', fontSize: 13 }}>
              Choose two stops and tap <strong style={{ color: 'var(--text)' }}>Find routes</strong> to see direct and transfer options.
            </div>
          )}
        </div>
      </div>

      {/* spinner keyframes */}
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        .walking-spinner { animation: spin 0.8s linear infinite; }
      `}</style>
    </div>
  );
}
