import { useState, useEffect } from 'react';
import { useAuth } from '../lib/auth';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, LineChart, Line } from 'recharts';
import { Users, Bus, Route, TrendingUp, AlertTriangle, CheckCircle, Power } from 'lucide-react';

export default function AdminDashboard() {
  const { token } = useAuth();
  const [analytics, setAnalytics] = useState(null);
  const [users, setUsers] = useState([]);
  const [vehicles, setVehicles] = useState([]);
  const [routes, setRoutes] = useState([]);
  const [tab, setTab] = useState('overview');
  const [loading, setLoading] = useState(true);
  const [alertForm, setAlertForm] = useState({ type: 'delay', message: '', severity: 'medium', routeId: '' });
  const [toastMsg, setToastMsg] = useState('');

  const h = { Authorization: `Bearer ${token}` };
  const showToast = (m) => { setToastMsg(m); setTimeout(() => setToastMsg(''), 3000); };

  useEffect(() => {
    Promise.all([
      fetch('http://localhost:3001/api/admin/analytics', { headers: h }).then(r => r.json()),
      fetch('http://localhost:3001/api/admin/users', { headers: h }).then(r => r.json()),
      fetch('http://localhost:3001/api/admin/vehicles', { headers: h }).then(r => r.json()),
      fetch('http://localhost:3001/api/routes', { headers: h }).then(r => r.json()),
    ]).then(([a, u, v, r]) => {
      setAnalytics(a); setUsers(u); setVehicles(v); setRoutes(r);
      setLoading(false);
    });
  }, []);

  const toggleRoute = async (id, current) => {
    await fetch(`http://localhost:3001/api/admin/routes/${id}`, {
      method: 'PATCH', headers: { ...h, 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: !current })
    });
    setRoutes(prev => prev.map(r => r.id === id ? { ...r, active: !r.active } : r));
    showToast(`Route ${!current ? 'activated' : 'suspended'} successfully`);
  };

  const postAlert = async () => {
    if (!alertForm.message) return;
    await fetch('http://localhost:3001/api/alerts', {
      method: 'POST', headers: { ...h, 'Content-Type': 'application/json' },
      body: JSON.stringify(alertForm)
    });
    showToast('✅ Alert posted to all users');
    setAlertForm({ type: 'delay', message: '', severity: 'medium', routeId: '' });
  };

  if (loading) return <div style={{ padding: 32, color: 'var(--muted)' }}>Loading admin data...</div>;

  const TABS = ['overview', 'fleet', 'routes', 'users', 'alerts'];

  return (
    <div style={{ padding: 32 }}>
      {toastMsg && (
        <div style={{ position: 'fixed', top: 24, right: 24, background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 12, padding: '14px 20px', zIndex: 9999, fontWeight: 600, fontSize: 14, boxShadow: '0 8px 32px rgba(0,0,0,0.4)' }}>
          {toastMsg}
        </div>
      )}

      <div style={{ marginBottom: 28 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
          <h1 style={{ fontSize: 28, fontWeight: 800 }}>Admin Control Panel</h1>
          <span className="badge badge-red">Admin Only</span>
        </div>
        <p style={{ color: 'var(--muted)' }}>Full control over Tirana's transit network.</p>
      </div>

      {/* Tab Nav */}
      <div style={{ display: 'flex', gap: 4, background: 'var(--bg3)', padding: 4, borderRadius: 12, marginBottom: 28, width: 'fit-content' }}>
        {TABS.map(t => (
          <button key={t} onClick={() => setTab(t)} className="btn" style={{
            padding: '8px 18px', textTransform: 'capitalize',
            background: tab === t ? 'var(--accent)' : 'transparent',
            color: tab === t ? '#000' : 'var(--muted)', fontSize: 13,
          }}>{t}</button>
        ))}
      </div>

      {tab === 'overview' && analytics && (
        <div>
          {/* Stats */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 28 }}>
            {[
              { label: 'Total Users', value: analytics.totalUsers, icon: Users, color: 'var(--accent2)' },
              { label: 'Vehicles', value: analytics.totalVehicles, icon: Bus, color: 'var(--accent3)' },
              { label: 'Tickets Sold', value: analytics.totalTicketsSold, icon: Route, color: 'var(--accent)' },
              { label: 'Revenue (L)', value: analytics.revenue.toLocaleString(), icon: TrendingUp, color: '#a78bfa' },
            ].map(s => (
              <div key={s.label} className="card" style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <div style={{ background: `${s.color}18`, borderRadius: 12, padding: 12, flexShrink: 0 }}>
                  <s.icon size={20} color={s.color} />
                </div>
                <div>
                  <div style={{ fontSize: 24, fontFamily: 'Syne', fontWeight: 800, color: s.color }}>{s.value}</div>
                  <div style={{ fontSize: 12, color: 'var(--muted)' }}>{s.label}</div>
                </div>
              </div>
            ))}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
            {/* Ridership chart */}
            <div className="card">
              <h3 style={{ marginBottom: 20, fontWeight: 700 }}>Weekly Ridership</h3>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={analytics.dailyRidership}>
                  <XAxis dataKey="day" stroke="var(--muted)" fontSize={11} />
                  <YAxis stroke="var(--muted)" fontSize={11} />
                  <Tooltip contentStyle={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text)' }} />
                  <Bar dataKey="riders" fill="var(--accent)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Route performance */}
            <div className="card">
              <h3 style={{ marginBottom: 20, fontWeight: 700 }}>Route Performance</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {analytics.routePerformance.slice(0, 5).map(r => (
                  <div key={r.number} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{ width: 28, fontFamily: 'Syne', fontWeight: 700, fontSize: 13, color: 'var(--accent)' }}>#{r.number}</div>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, fontSize: 12 }}>
                        <span>{r.name}</span>
                        <span style={{ color: r.onTime > 85 ? 'var(--accent3)' : r.onTime > 70 ? 'var(--accent)' : 'var(--red)' }}>{r.onTime}% on-time</span>
                      </div>
                      <div style={{ height: 6, background: 'var(--bg3)', borderRadius: 3, overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${r.onTime}%`, background: r.onTime > 85 ? 'var(--accent3)' : r.onTime > 70 ? 'var(--accent)' : 'var(--red)', borderRadius: 3, transition: 'width 0.5s' }} />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {tab === 'fleet' && (
        <div>
          <h3 style={{ marginBottom: 20, fontWeight: 700 }}>Fleet Status — {vehicles.length} vehicles</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
            {vehicles.map(v => (
              <div key={v.id} className="card" style={{ padding: '16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
                  <span style={{ fontFamily: 'Syne', fontWeight: 700 }}>{v.plate}</span>
                  <span className={`badge ${v.status === 'moving' ? 'badge-green' : v.status === 'stopped' ? 'badge-yellow' : 'badge-red'}`}>{v.status}</span>
                </div>
                <div style={{ fontSize: 12, color: 'var(--muted)', display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>Route</span>
                    <span style={{ color: 'var(--text)' }}>{v.route?.number} — {v.route?.name?.split(' → ')[0]}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>Speed</span>
                    <span style={{ color: 'var(--text)' }}>{v.speed} km/h</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>Crowd</span>
                    <span style={{ color: v.crowdLevel === 'high' ? 'var(--red)' : v.crowdLevel === 'medium' ? 'var(--accent)' : 'var(--accent3)', textTransform: 'capitalize' }}>{v.crowdLevel}</span>
                  </div>
                  {v.nextStop && <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>Next Stop</span>
                    <span style={{ color: 'var(--accent2)' }}>{v.nextStop}</span>
                  </div>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'routes' && (
        <div>
          <h3 style={{ marginBottom: 20, fontWeight: 700 }}>Route Management</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {routes.map(r => (
              <div key={r.id} className="card" style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '16px 20px' }}>
                <div style={{ width: 40, height: 40, borderRadius: 10, background: r.color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Syne', fontWeight: 800, color: '#fff', flexShrink: 0 }}>
                  {r.number}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, marginBottom: 2 }}>{r.name}</div>
                  <div style={{ fontSize: 12, color: 'var(--muted)' }}>{r.stops.join(' → ')}</div>
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>Every {r.frequency}min · {r.duration}min · {r.vehicles} vehicles</div>
                </div>
                <span className={`badge ${r.active ? 'badge-green' : 'badge-red'}`}>{r.active ? 'Active' : 'Suspended'}</span>
                <button
                  className={`btn btn-sm ${r.active ? 'btn-danger' : 'btn-secondary'}`}
                  onClick={() => toggleRoute(r.id, r.active)}
                  style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Power size={12} />
                  {r.active ? 'Suspend' : 'Activate'}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'users' && (
        <div>
          <h3 style={{ marginBottom: 20, fontWeight: 700 }}>User Management — {users.length} users</h3>
          <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 16, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                  {['Name', 'Email', 'Role', 'Balance', 'Joined'].map(h => (
                    <th key={h} style={{ padding: '14px 20px', textAlign: 'left', fontSize: 12, color: 'var(--muted)', fontWeight: 600 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {users.map((u, i) => (
                  <tr key={u.id} style={{ borderBottom: i < users.length - 1 ? '1px solid var(--border)' : 'none' }}>
                    <td style={{ padding: '14px 20px', fontWeight: 600 }}>{u.name}</td>
                    <td style={{ padding: '14px 20px', color: 'var(--muted)', fontSize: 13 }}>{u.email}</td>
                    <td style={{ padding: '14px 20px' }}>
                      <span className={`badge ${u.role === 'admin' ? 'badge-red' : 'badge-blue'}`}>{u.role}</span>
                    </td>
                    <td style={{ padding: '14px 20px', fontFamily: 'Syne', color: 'var(--accent)' }}>{u.balance?.toLocaleString()} L</td>
                    <td style={{ padding: '14px 20px', color: 'var(--muted)', fontSize: 13 }}>{u.joinedAt}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'alerts' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
          <div className="card">
            <h3 style={{ marginBottom: 20, fontWeight: 700 }}>Post Service Alert</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label>Alert Type</label>
                <select value={alertForm.type} onChange={e => setAlertForm({ ...alertForm, type: e.target.value })}>
                  <option value="delay">Delay</option>
                  <option value="disruption">Disruption</option>
                  <option value="maintenance">Maintenance</option>
                  <option value="info">Information</option>
                </select>
              </div>
              <div>
                <label>Severity</label>
                <select value={alertForm.severity} onChange={e => setAlertForm({ ...alertForm, severity: e.target.value })}>
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                </select>
              </div>
              <div>
                <label>Affected Route (optional)</label>
                <select value={alertForm.routeId} onChange={e => setAlertForm({ ...alertForm, routeId: e.target.value })}>
                  <option value="">All Routes</option>
                  {routes.map(r => <option key={r.id} value={r.id}>Route {r.number} — {r.name}</option>)}
                </select>
              </div>
              <div>
                <label>Message</label>
                <textarea rows={3} value={alertForm.message} onChange={e => setAlertForm({ ...alertForm, message: e.target.value })} placeholder="Describe the service disruption..." style={{ resize: 'vertical' }} />
              </div>
              <button className="btn btn-primary" onClick={postAlert} disabled={!alertForm.message}>
                <AlertTriangle size={14} /> Post Alert
              </button>
            </div>
          </div>

          <div className="card">
            <h3 style={{ marginBottom: 20, fontWeight: 700 }}>System Health</h3>
            {[
              { label: 'GPS Feed', status: 'online' },
              { label: 'Payment Gateway', status: 'online' },
              { label: 'Route Data', status: 'online' },
              { label: 'Push Notifications', status: 'online' },
              { label: 'Analytics Engine', status: 'online' },
            ].map(s => (
              <div key={s.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 0', borderBottom: '1px solid var(--border)' }}>
                <span style={{ fontSize: 13 }}>{s.label}</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--accent3)', boxShadow: '0 0 8px var(--accent3)' }} />
                  <span style={{ fontSize: 12, color: 'var(--accent3)', fontWeight: 600 }}>Online</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
