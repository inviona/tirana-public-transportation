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

/* ─── helper: check if a stop has valid coordinates ─────────────────────────── */
// FIX: guards against null, undefined, 0, or non-finite lat/lng values
function hasValidCoords(stop) {
  return (
    stop != null &&
    typeof stop.lat === 'number' &&
    typeof stop.lng === 'number' &&
    isFinite(stop.lat) &&
    isFinite(stop.lng) &&
    stop.lat !== 0 &&
    stop.lng !== 0
  );
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
  /* ─── data state ─────────────────────────────────────────────────────────── */
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

  /* ─── address search state ───────────────────────────────────────────────── */
  const [addressInput, setAddressInput] = useState('');
  const [geocodeResults, setGeocodeResults] = useState([]);
  const [geocodeOpen, setGeocodeOpen] = useState(false);
  const [selectedAddress, setSelectedAddress] = useState(null);
  const [geocodeLoading, setGeocodeLoading] = useState(false);
  const [nearestStopResult, setNearestStopResult] = useState(null);
  const [walkingRoute, setWalkingRoute] = useState(null);
  const [walkingLoading, setWalkingLoading] = useState(false);
  const [findRouteError, setFindRouteError] = useState('');

  /* ─── institutions state ─────────────────────────────────────────────────── */
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

  /* ─── stop-to-stop journey planner ───────────────────────────────────────── */
  const runPlan = async () => {
    if (!fromStop && !selectedAddress) return;
    if (!toStop) return;

    // FIX: reset all result/error state at the start of each new search
    // so stale results from the previous query never linger on screen
    setPlan(null);
    setHighlight(null);

    setPlanLoading(true);
    try {
      const body = { toStopId: toStop.id };

      if (selectedAddress) {
        body.from = {
          lat: selectedAddress.lat,
          lng: selectedAddress.lng,
          name: selectedAddress.display_name?.split(',')[0] || 'Your location',
        };
      } else if (fromStop) {
        body.fromStopId = fromStop.id;
      }

      const res = await fetch(`${API}/api/transit/journey`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Plan failed');
      setPlan(data);
    } catch (err) {
      setPlan({ error: err.message || 'Could not load journey plan. Is the API running?' });
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

  // FIX: routeStopsForHighlight now reads stop.name (not stop.stop_name),
  // and uses stop.lat / stop.lng directly (server now sends the flat shape).
  // Also guards against stops with null/zero coordinates.
  const routeStopsForHighlight = useMemo(() => {
    if (!highlight || !plan) return [];

    if (highlight.kind === 'direct') {
      const directOption = plan.direct?.find(d => (d.route?.id || '') === highlight.routeId);
      if (directOption?.stops) {
        // Server now sends: { id, name, lat, lng, arrivalTime, departureTime, sequence }
        return directOption.stops
          .filter(s => hasValidCoords(s))   // FIX: drop stops with 0/null coords
          .map((s, i, arr) => ({
            id: s.id || `stop_${i}`,
            name: s.name || 'Unknown',       // FIX: read s.name, not s.stop?.stop_name
            lat: s.lat,
            lng: s.lng,
            isStart: i === 0,
            isEnd: i === arr.length - 1,
          }));
      }
      return [];
    }

    if (highlight.kind === 'transfer') {
      const transfer = plan.transfers?.find(t => {
        const leg1RouteId = t.leg1?.route?.id || '';
        const leg2RouteId = t.leg2?.route?.id || '';
        const viaStopId = t.transfer?.stopId || '';
        return (
          leg1RouteId === highlight.routeId1 &&
          leg2RouteId === highlight.routeId2 &&
          viaStopId === highlight.viaStopId
        );
      });
      const transferStop = transfer?.transfer || {};

      const viaLat = parseFloat(transferStop.lat);
      const viaLng = parseFloat(transferStop.lng);

      const pts = [];

      // origin
      if (hasValidCoords(plan.from)) {
        pts.push({ ...plan.from, isStart: true });
      }
      // transfer point
      if (isFinite(viaLat) && viaLat !== 0 && isFinite(viaLng) && viaLng !== 0) {
        pts.push({
          id: highlight.viaStopId,
          name: highlight.viaName || 'Transfer',
          lat: viaLat,
          lng: viaLng,
          isTransfer: true,
        });
      }
      // destination
      if (hasValidCoords(plan.to)) {
        pts.push({ ...plan.to, isEnd: true });
      }

      return pts;
    }

    return [];
  }, [highlight, plan]);

  /* ─── walking path as Leaflet positions ──────────────────────────────────── */
  const walkingPositions = useMemo(() => {
    if (!walkingRoute?.geometry) return [];
    return orsGeometryToLeaflet(walkingRoute.geometry);
  }, [walkingRoute]);

  /* ─── map bounds ─────────────────────────────────────────────────────────── */
  // FIX: only extend bounds with stops that have valid, non-zero coordinates
  const bounds = useMemo(() => {
    const b = L.latLngBounds([]);
    let any = false;
    const extend = (pt) => {
      // Guard: skip [0,0] or invalid lat/lng which would zoom map to Africa
      const lat = Array.isArray(pt) ? pt[0] : pt?.lat;
      const lng = Array.isArray(pt) ? pt[1] : pt?.lng;
      if (!isFinite(lat) || !isFinite(lng) || lat === 0 || lng === 0) return;
      b.extend(Array.isArray(pt) ? pt : [lat, lng]);
      any = true;
    };

    highlightedPolylines.forEach((route) => {
      geometryToLeafletSegments(route.geometry).forEach((seg) => seg.forEach(extend));
    });
    walkingPositions.forEach(extend);

    (plan?.walkingLegs || []).forEach(leg => {
      extend([leg.from.lat, leg.from.lng]);
      extend([leg.to.lat, leg.to.lng]);
      if (leg.geometry) {
        orsGeometryToLeaflet(leg.geometry).forEach(pt => extend(pt));
      }
    });

    if (fromStop && hasValidCoords(fromStop)) extend([fromStop.lat, fromStop.lng]);
    if (toStop && hasValidCoords(toStop)) extend([toStop.lat, toStop.lng]);
    if (selectedAddress) extend([selectedAddress.lat, selectedAddress.lng]);
    if (nearestStopResult?.stop && hasValidCoords(nearestStopResult.stop)) {
      extend([nearestStopResult.stop.lat, nearestStopResult.stop.lng]);
    }
    if (highlight?.kind === 'transfer' && highlight.viaLat != null) {
      extend([highlight.viaLat, highlight.viaLng]);
    }

    // FIX: extend bounds to all valid route stops so the map fits the full route
    routeStopsForHighlight.forEach(s => {
      if (hasValidCoords(s)) extend([s.lat, s.lng]);
    });

    return any ? b : null;
  }, [highlightedPolylines, walkingPositions, fromStop, toStop, selectedAddress, nearestStopResult, highlight, routeStopsForHighlight, plan]);

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

      {/* ─── FIND ROUTE FROM ADDRESS ────────────────────────────────────────── */}
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

      {/* ─── STOP-TO-STOP PLANNER ───────────────────────────────────────────── */}
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
            disabled={planLoading || (!fromStop && !selectedAddress) || !toStop || loadingStops}
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
              <MapResizeNotifier trigger={highlight || walkingRoute || plan} />
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

              {/* Walking path (address → nearest stop) */}
              {walkingPositions.length > 0 && (
                <Polyline
                  positions={walkingPositions}
                  pathOptions={{ color: '#4e9eff', weight: 5, opacity: 0.9, dashArray: '10 8' }}
                />
              )}

              {/* Journey plan walking legs */}
              {(plan?.walkingLegs || []).map((leg, i) => (
                <Polyline
                  key={`walk-leg-${i}`}
                  positions={orsGeometryToLeaflet(leg.geometry)}
                  pathOptions={{ color: '#4e9eff', weight: 5, opacity: 0.9, dashArray: '10 8' }}
                />
              ))}

              {/* Address pin */}
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
              {nearestStopResult?.stop && hasValidCoords(nearestStopResult.stop) && (
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
              {fromStop && hasValidCoords(fromStop) && (
                <Marker position={[fromStop.lat, fromStop.lng]}>
                  <Popup>From: {fromStop.name}</Popup>
                </Marker>
              )}
              {toStop && hasValidCoords(toStop) && (
                <Marker position={[toStop.lat, toStop.lng]}>
                  <Popup>To: {toStop.name}</Popup>
                </Marker>
              )}

              {/* Walking leg origin markers */}
              {(plan?.walkingLegs || []).map((leg, i) => (
                <CircleMarker
                  key={`walk-leg-marker-${i}`}
                  center={[leg.from.lat, leg.from.lng]}
                  radius={8}
                  pathOptions={{ color: '#4e9eff', fillColor: '#4e9eff', fillOpacity: 0.85, weight: 2 }}
                >
                  <Tooltip direction="top" offset={[0, -6]} opacity={1} permanent>
                    <span style={{ fontWeight: 600 }}>🚶 {leg.from.name}</span>
                  </Tooltip>
                </CircleMarker>
              ))}

              {/* Transfer stop marker (if transfer highlighted) */}
              {highlight?.kind === 'transfer' && highlight.viaLat != null && (
                <Marker position={[highlight.viaLat, highlight.viaLng]}>
                  <Popup>Change: {highlight.viaName}</Popup>
                </Marker>
              )}

              {/* FIX: Route stops along highlighted route.
                  Only render stops where hasValidCoords() passes.
                  START = stops[0], END = stops[last]; colour-coded accordingly.
                  Name reads from stop.name (the flat field the server now sends). */}
              {routeStopsForHighlight.map((stop, idx) => (
                <CircleMarker
                  key={stop.id || idx}
                  center={[stop.lat, stop.lng]}
                  radius={stop.isStart || stop.isEnd || stop.isTransfer ? 10 : 7}
                  pathOptions={{
                    color: stop.isTransfer
                      ? '#fbbf24'
                      : stop.isStart
                        ? '#22c55e'
                        : stop.isEnd
                          ? '#ef4444'
                          : '#4e9eff',
                    fillColor: stop.isTransfer
                      ? '#fbbf24'
                      : stop.isStart
                        ? '#22c55e'
                        : stop.isEnd
                          ? '#ef4444'
                          : '#4e9eff',
                    fillOpacity: 0.9,
                    weight: 3,
                  }}
                >
                  <Tooltip
                    direction="top"
                    offset={[0, -8]}
                    opacity={1}
                    permanent={idx === 0 || idx === routeStopsForHighlight.length - 1}
                  >
                    <span style={{ fontWeight: 600 }}>
                      {stop.isStart
                        ? `🟢 ${stop.name}`
                        : stop.isEnd
                          ? `🔴 ${stop.name}`
                          : stop.isTransfer
                            ? `🟡 ${stop.name}`
                            : `🚏 ${stop.name}`}
                    </span>
                  </Tooltip>
                </CircleMarker>
              ))}

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
          {plan?.error && (
            <div className="card" style={{ borderColor: 'var(--red)', color: 'var(--red)', fontSize: 13 }}>
              {plan.error}
            </div>
          )}

          {plan && !plan.error && (
            <>
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                <strong style={{ color: 'var(--text)' }}>
                  {selectedAddress?.display_name?.split(',')[0] || plan.from?.name}
                </strong>
                <ArrowRight size={12} style={{ display: 'inline', verticalAlign: 'middle', margin: '0 6px' }} />
                <strong style={{ color: 'var(--text)' }}>{plan.to?.name}</strong>
              </div>

              {plan.message && (
                <div className="card" style={{
                  fontSize: 13,
                  color: plan.message.includes('No nearby') ? 'var(--red)' : 'var(--muted)',
                  borderColor: plan.message.includes('No nearby') ? 'rgba(239,68,68,0.3)' : 'var(--border)',
                }}>
                  {plan.message}
                </div>
              )}

              {/* Walking legs */}
              {plan.walkingLegs?.length > 0 && plan.walkingLegs.map((leg, i) => (
                <div key={i} className="card" style={{ borderColor: 'rgba(78,158,255,0.3)', background: 'rgba(78,158,255,0.06)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                    <div style={{ fontSize: 18 }}>🚶</div>
                    <div style={{ fontFamily: 'Syne', fontWeight: 700, fontSize: 13 }}>
                      {leg.kind === 'walk_to_stop' ? 'Walk to bus stop' : 'Walk to destination'}
                    </div>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.6 }}>
                    <div>From <strong style={{ color: 'var(--text)' }}>{leg.from.name}</strong></div>
                    <div style={{ margin: '2px 0 2px 16px', color: 'var(--accent2)', fontSize: 11 }}>
                      {leg.distanceM ? `${leg.distanceM} m, ~${formatDuration(leg.durationS)}` : `~${formatDuration(leg.durationS)} walk`}
                    </div>
                    <div>To <strong style={{ color: 'var(--text)' }}>{leg.to.name}</strong></div>
                  </div>
                </div>
              ))}

              {/* Direct routes */}
              {plan.direct?.length > 0 && (
                <div>
                  <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--muted)', marginBottom: 8 }}>Direct</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {plan.direct.map((d, idx) => {
                      const routeId = d.route?.id || `direct_${idx}`;
                      const routeRef = d.route?.ref || '?';
                      const routeName = d.route?.name || '';
                      const routeColour = d.route?.colour || '#4e9eff';
                      // FIX: stops now have flat { id, name, lat, lng } shape
                      const allStops = (d.stops || []).filter(s => hasValidCoords(s));
                      const active = highlight?.kind === 'direct' && highlight.routeId === routeId;

                      return (
                        <button
                          key={routeId}
                          type="button"
                          onClick={() => setHighlight({ kind: 'direct', routeId })}
                          className="card"
                          style={{
                            padding: '12px 14px', cursor: 'pointer', textAlign: 'left',
                            borderColor: active ? routeColour : 'var(--border)',
                            background: active ? `${routeColour}14` : 'var(--card)',
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <div
                              style={{
                                width: 40, height: 40, borderRadius: 10, background: routeColour,
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                color: '#fff', fontFamily: 'Syne', fontWeight: 800, fontSize: 12, flexShrink: 0,
                              }}
                            >
                              {routeRef}
                            </div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontFamily: 'Syne', fontWeight: 700 }}>Line {routeRef}</div>
                              <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{routeName}</div>
                              {d.duration && (
                                <div style={{ fontSize: 10, color: 'var(--accent2)', marginTop: 4 }}>
                                  {d.duration} min · {d.departure?.time} → {d.arrival?.time}
                                </div>
                              )}
                            </div>
                          </div>

                          {active && allStops.length > 0 && (
                            <div style={{ marginTop: 16 }}>
                              <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--muted)', marginBottom: 12 }}>Route Stops</div>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                                {allStops.map((stop, i) => (
                                  <div key={stop.id || i} style={{ display: 'flex', alignItems: 'center', gap: 10, position: 'relative' }}>
                                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                                      <div style={{
                                        width: 12, height: 12, borderRadius: '50%',
                                        background: i === 0 ? '#22c55e' : i === allStops.length - 1 ? '#ef4444' : routeColour,
                                        border: '2px solid var(--bg)',
                                        boxShadow: '0 0 0 2px var(--bg2)',
                                        zIndex: 2,
                                      }} />
                                      {i < allStops.length - 1 && (
                                        <div style={{ width: 2, height: 24, background: routeColour, opacity: 0.4 }} />
                                      )}
                                    </div>
                                    <div style={{ flex: 1, paddingBottom: i < allStops.length - 1 ? 8 : 0 }}>
                                      {/* FIX: read stop.name (flat field) not stop.stop?.stop_name */}
                                      <div style={{
                                        fontSize: 12,
                                        fontWeight: i === 0 || i === allStops.length - 1 ? 600 : 400,
                                        color: i === 0 || i === allStops.length - 1 ? 'var(--text)' : 'var(--muted)',
                                      }}>
                                        {stop.name}
                                      </div>
                                      {stop.departureTime && (
                                        <div style={{ fontSize: 10, color: 'var(--muted)' }}>{stop.departureTime}</div>
                                      )}
                                      {i === 0 && <div style={{ fontSize: 10, color: '#22c55e' }}>START</div>}
                                      {i === allStops.length - 1 && <div style={{ fontSize: 10, color: '#ef4444' }}>END</div>}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Transfer routes */}
              {plan.transfers?.length > 0 && (
                <div>
                  <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--muted)', marginBottom: 8 }}>One transfer</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {plan.transfers.map((t, idx) => {
                      const leg1RouteId = t.leg1?.route?.id || `leg1_${idx}`;
                      const leg2RouteId = t.leg2?.route?.id || `leg2_${idx}`;
                      const viaStopId = t.transfer?.stopId || `via_${idx}`;
                      const viaStopName = t.transfer?.stopName || 'Transfer stop';
                      const leg1Colour = t.leg1?.route?.colour || '#4e9eff';
                      const leg2Colour = t.leg2?.route?.colour || '#4e9eff';

                      const active =
                        highlight?.kind === 'transfer' &&
                        highlight.routeId1 === leg1RouteId &&
                        highlight.routeId2 === leg2RouteId &&
                        highlight.viaStopId === viaStopId;

                      return (
                        <button
                          key={`${viaStopId}-${t.leg1?.route?.ref}-${t.leg2?.route?.ref}-${idx}`}
                          type="button"
                          onClick={() =>
                            setHighlight({
                              kind: 'transfer',
                              routeId1: leg1RouteId,
                              routeId2: leg2RouteId,
                              viaStopId: viaStopId,
                              viaName: viaStopName,
                            })
                          }
                          className="card"
                          style={{
                            padding: '12px 14px', cursor: 'pointer', textAlign: 'left',
                            borderColor: active ? leg1Colour : 'var(--border)',
                            background: active ? `${leg1Colour}12` : 'var(--card)',
                          }}
                        >
                          <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 6 }}>
                            Change at {viaStopName}
                            {t.transfer?.waitTime > 0 && <span style={{ marginLeft: 6 }}>(wait {t.transfer.waitTime} min)</span>}
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: 13 }}>
                            <span style={{ fontWeight: 700, color: leg1Colour }}>{t.leg1?.route?.ref}</span>
                            <span style={{ color: 'var(--muted)' }}>{t.leg1?.departure?.time} → {t.leg1?.arrival?.time}</span>
                            <ArrowRight size={14} color="var(--muted)" />
                            <span style={{ fontWeight: 700, color: leg2Colour }}>{t.leg2?.route?.ref}</span>
                            <span style={{ color: 'var(--muted)' }}>{t.leg2?.departure?.time} → {t.leg2?.arrival?.time}</span>
                          </div>
                          {t.totalDuration && (
                            <div style={{ fontSize: 10, color: 'var(--accent2)', marginTop: 6 }}>
                              Total: {t.totalDuration} min
                            </div>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* No results */}
              {!plan.message && plan.direct?.length === 0 && plan.transfers?.length === 0 && (
                <div className="card" style={{ fontSize: 13, color: 'var(--muted)', textAlign: 'center', padding: 24 }}>
                  No connections found between these stops.
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


