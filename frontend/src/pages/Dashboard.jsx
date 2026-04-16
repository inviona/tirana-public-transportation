import { useState, useEffect } from 'react';
import { useAuth } from '../lib/auth';
import { Bus, AlertTriangle, CheckCircle, Clock, TrendingUp, Route, Navigation } from 'lucide-react';

export default function Dashboard() {
  const { token, user } = useAuth();
  const [routes, setRoutes] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [tracking, setTracking] = useState([]);

  useEffect(() => {
    fetch('http://localhost:3001/api/transit/routes').then(r => r.json()).then(setRoutes);
    fetch('http://localhost:3001/api/alerts').then(r => r.json()).then(setAlerts);
    fetch('http://localhost:3001/api/vehicles/tracking').then(r => r.json()).then(setTracking);
    const interval = setInterval(() => {
      fetch('http://localhost:3001/api/vehicles/tracking').then(r => r.json()).then(setTracking);
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  const movingVehicles = tracking.filter(v => v.status === 'moving').length;
  const activeRoutes = routes.filter(r => r.active).length;
  const highAlerts = alerts.filter(a => a.severity === 'high').length;

  const stats = [
    { label: 'Active Routes', value: activeRoutes, icon: Route, color: 'var(--accent)' },
    { label: 'Vehicles Moving', value: movingVehicles, icon: Bus, color: '#6ee7b7' },
    { label: 'Service Alerts', value: alerts.length, icon: AlertTriangle, color: alerts.length > 0 ? '#f87171' : '#6ee7b7' },
    { label: 'On-Time Rate', value: '87%', icon: TrendingUp, color: '#fbbf24' },
  ];

  return (
    <div style={{ padding: '40px 48px', maxWidth: 1600, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ marginBottom: 40 }}>
        <h1 style={{ fontSize: 36, fontWeight: 800, marginBottom: 8, fontFamily: 'Syne' }}>
          Good morning, <span className="text-gradient">{user?.name?.split(' ')[0]}</span> 👋
        </h1>
        <p style={{ color: 'var(--muted)', fontSize: 15 }}>Here's the current state of Tirana's transit network.</p>
      </div>

      {/* Stats Grid */}
      <div className="dashboard-stats" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 20, marginBottom: 36 }}>
        {stats.map(s => (
          <div key={s.label} className="card" style={{ display: 'flex', alignItems: 'center', gap: 18, padding: 22 }}>
            <div className="stat-icon" style={{ borderRadius: 14, padding: 14, flexShrink: 0 }}>
              <s.icon size={22} color={s.color} />
            </div>
            <div>
              <div style={{ fontSize: 32, fontFamily: 'Syne', fontWeight: 800, color: s.color, lineHeight: 1 }}>{s.value}</div>
              <div style={{ fontSize: 13, color: 'var(--muted)', fontWeight: 500, marginTop: 4 }}>{s.label}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Main Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 28 }}>
        {/* Routes Card */}
        <div className="card dashboard-routes">
          <h3 style={{ marginBottom: 24, fontWeight: 700, fontSize: 18, display: 'flex', alignItems: 'center', gap: 10 }}>
            <Bus size={20} color="var(--accent)" />
            Active Routes
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {routes.slice(0, 5).map(r => (
              <div key={r.id} className="route-item" style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 16px', borderRadius: 14 }}>
                <div style={{ width: 42, height: 42, borderRadius: 10, background: r.color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Syne', fontWeight: 800, fontSize: 15, color: '#fff', flexShrink: 0, boxShadow: `0 4px 12px ${r.color}40` }}>
                  {r.number}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 2 }}>{r.name}</div>
                  <div style={{ fontSize: 12, color: 'var(--muted)' }}>Every {r.frequency} min · {r.duration} min ride</div>
                </div>
                <span className={`badge ${r.active ? 'badge-green' : 'badge-red'}`}>{r.active ? 'Active' : 'Suspended'}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Alerts Card */}
        <div className="card dashboard-alerts">
          <h3 style={{ marginBottom: 24, fontWeight: 700, fontSize: 18, display: 'flex', alignItems: 'center', gap: 10 }}>
            <AlertTriangle size={20} color="#f87171" />
            Service Alerts
          </h3>
          {alerts.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 48 }}>
              <CheckCircle size={48} color="#6ee7b7" style={{ marginBottom: 16 }} />
              <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--text)' }}>All services running normally</div>
              <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 4 }}>No disruptions detected in the network</div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {alerts.map(a => (
                <div key={a.id} className="alert-item" style={{
                  padding: '14px 16px', borderRadius: 14, borderLeft: '4px solid',
                  borderLeftColor: a.severity === 'high' ? '#f87171' : a.severity === 'medium' ? 'var(--accent)' : '#6ee7b7',
                  background: a.severity === 'high' ? 'rgba(248,113,113,0.08)' : a.severity === 'medium' ? 'rgba(207,10,44,0.08)' : 'rgba(110,231,183,0.08)',
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                    <span className={`badge ${a.severity === 'high' ? 'badge-red' : a.severity === 'medium' ? 'badge-yellow' : 'badge-green'}`}>{a.type}</span>
                    <span style={{ fontSize: 11, color: 'var(--muted)' }}>
                      {Math.floor((Date.now() - new Date(a.createdAt)) / 60000)}m ago
                    </span>
                  </div>
                  <p style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.5 }}>{a.message}</p>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Live Vehicles Card - Full Width */}
        <div className="card dashboard-vehicles" style={{ gridColumn: '1 / -1' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
            <h3 style={{ fontWeight: 700, fontSize: 18, display: 'flex', alignItems: 'center', gap: 10 }}>
              <Navigation size={20} color="var(--accent)" />
              Live Vehicle Status
            </h3>
            <span className="live-indicator">● LIVE</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14 }}>
            {tracking.map(v => (
              <div key={v.id} className="vehicle-item" style={{ padding: '14px 16px', borderRadius: 14, display: 'flex', gap: 14, alignItems: 'center' }}>
                <div style={{ width: 12, height: 12, borderRadius: '50%', flexShrink: 0, background: v.status === 'moving' ? '#6ee7b7' : v.status === 'stopped' ? '#fbbf24' : '#f87171', boxShadow: v.status === 'moving' ? '0 0 12px #6ee7b7' : 'none' }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 2 }}>{v.plate}</div>
                  <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                    Route {v.route?.number} · {v.status === 'moving' ? `${v.speed} km/h` : v.status}
                  </div>
                  {v.nextStop && <div style={{ fontSize: 12, color: 'var(--accent)', marginTop: 2 }}>→ {v.nextStop} in {v.eta}min</div>}
                </div>
                <span className={`badge ${v.crowdLevel === 'low' ? 'badge-green' : v.crowdLevel === 'medium' ? 'badge-yellow' : v.crowdLevel === 'high' ? 'badge-red' : 'badge-blue'}`}>
                  {v.crowdLevel}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
