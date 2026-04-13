import { useState, useEffect } from 'react';
import { useAuth } from '../lib/auth';
import { Bus, AlertTriangle, CheckCircle, Clock, TrendingUp, Users, Route } from 'lucide-react';

export default function Dashboard() {
  const { token, user } = useAuth();
  const [routes, setRoutes] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [tracking, setTracking] = useState([]);

  useEffect(() => {
    fetch('http://localhost:3001/api/routes').then(r => r.json()).then(setRoutes);
    fetch('http://localhost:3001/api/alerts').then(r => r.json()).then(setAlerts);
    fetch('http://localhost:3001/api/tracking').then(r => r.json()).then(setTracking);
    const interval = setInterval(() => {
      fetch('http://localhost:3001/api/tracking').then(r => r.json()).then(setTracking);
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  const movingVehicles = tracking.filter(v => v.status === 'moving').length;
  const activeRoutes = routes.filter(r => r.active).length;
  const highAlerts = alerts.filter(a => a.severity === 'high').length;

  const stats = [
    { label: 'Active Routes', value: activeRoutes, icon: Route, color: 'var(--accent2)' },
    { label: 'Vehicles Moving', value: movingVehicles, icon: Bus, color: 'var(--accent3)' },
    { label: 'Live Alerts', value: alerts.length, icon: AlertTriangle, color: alerts.length > 0 ? 'var(--red)' : 'var(--accent3)' },
    { label: 'On-Time Rate', value: '87%', icon: TrendingUp, color: 'var(--accent)' },
  ];

  return (
    <div style={{ padding: 32 }}>
      {/* Header */}
      <div style={{ marginBottom: 32 }}>
        <h1 style={{ fontSize: 28, fontWeight: 800, marginBottom: 6 }}>
          Good morning, {user?.name?.split(' ')[0]} 👋
        </h1>
        <p style={{ color: 'var(--muted)' }}>Here's the current state of Tirana's transit network.</p>
      </div>

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 32 }}>
        {stats.map(s => (
          <div key={s.label} className="card" style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <div style={{ background: `${s.color}18`, borderRadius: 12, padding: 12, flexShrink: 0 }}>
              <s.icon size={20} color={s.color} />
            </div>
            <div>
              <div style={{ fontSize: 26, fontFamily: 'Syne', fontWeight: 800, color: s.color }}>{s.value}</div>
              <div style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 500 }}>{s.label}</div>
            </div>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
        {/* Routes */}
        <div className="card">
          <h3 style={{ marginBottom: 20, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Bus size={16} color="var(--accent)" /> Active Routes
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {routes.slice(0, 5).map(r => (
              <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', background: 'var(--bg3)', borderRadius: 10 }}>
                <div style={{ width: 36, height: 36, borderRadius: 8, background: r.color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Syne', fontWeight: 800, fontSize: 13, color: '#fff', flexShrink: 0 }}>
                  {r.number}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.name}</div>
                  <div style={{ fontSize: 11, color: 'var(--muted)' }}>Every {r.frequency} min · {r.duration} min ride</div>
                </div>
                <span className={`badge ${r.active ? 'badge-green' : 'badge-red'}`}>{r.active ? 'Active' : 'Suspended'}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Alerts */}
        <div className="card">
          <h3 style={{ marginBottom: 20, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
            <AlertTriangle size={16} color="var(--red)" /> Service Alerts
          </h3>
          {alerts.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 40, color: 'var(--muted)' }}>
              <CheckCircle size={32} color="var(--accent3)" style={{ marginBottom: 12 }} />
              <div>All services running normally</div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {alerts.map(a => (
                <div key={a.id} style={{
                  padding: '12px 14px', borderRadius: 10, borderLeft: '3px solid',
                  borderLeftColor: a.severity === 'high' ? 'var(--red)' : a.severity === 'medium' ? 'var(--accent)' : 'var(--accent3)',
                  background: a.severity === 'high' ? 'rgba(239,68,68,0.06)' : a.severity === 'medium' ? 'rgba(232,184,75,0.06)' : 'rgba(110,231,183,0.06)',
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                    <span className={`badge ${a.severity === 'high' ? 'badge-red' : a.severity === 'medium' ? 'badge-yellow' : 'badge-green'}`}>{a.type}</span>
                    <span style={{ fontSize: 11, color: 'var(--muted)' }}>
                      {Math.floor((Date.now() - new Date(a.createdAt)) / 60000)}m ago
                    </span>
                  </div>
                  <p style={{ fontSize: 12, color: 'var(--text)', lineHeight: 1.5 }}>{a.message}</p>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Live Vehicles */}
        <div className="card" style={{ gridColumn: '1 / -1' }}>
          <h3 style={{ marginBottom: 20, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Clock size={16} color="var(--accent2)" /> Live Vehicle Status
            <span style={{ fontSize: 11, color: 'var(--accent3)', background: 'rgba(110,231,183,0.1)', padding: '2px 8px', borderRadius: 20, marginLeft: 8 }}>● LIVE</span>
          </h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
            {tracking.map(v => (
              <div key={v.id} style={{ padding: '12px 14px', background: 'var(--bg3)', borderRadius: 10, display: 'flex', gap: 12, alignItems: 'center' }}>
                <div style={{ width: 10, height: 10, borderRadius: '50%', flexShrink: 0, background: v.status === 'moving' ? 'var(--accent3)' : v.status === 'stopped' ? 'var(--accent)' : 'var(--red)', boxShadow: v.status === 'moving' ? '0 0 8px var(--accent3)' : 'none' }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{v.plate}</div>
                  <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                    Route {v.route?.number} · {v.status === 'moving' ? `${v.speed} km/h` : v.status}
                  </div>
                  {v.nextStop && <div style={{ fontSize: 11, color: 'var(--accent2)' }}>→ {v.nextStop} in {v.eta}min</div>}
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
