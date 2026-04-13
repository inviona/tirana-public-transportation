import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { Bus, Map, Navigation, Ticket, LayoutDashboard, LogOut, Bell, Wallet } from 'lucide-react';

export default function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = () => { logout(); navigate('/login'); };

  const navItems = [
    { to: '/', icon: LayoutDashboard, label: 'Dashboard', end: true },
    { to: '/plan', icon: Map, label: 'Plan Route' },
    { to: '/tracking', icon: Navigation, label: 'Live Tracking' },
    { to: '/tickets', icon: Ticket, label: 'My Tickets' },
    ...(user?.role === 'admin' ? [{ to: '/admin', icon: LayoutDashboard, label: 'Admin Panel' }] : []),
  ];

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
      {/* Sidebar */}
      <aside style={{
        width: 240, background: 'var(--bg2)', borderRight: '1px solid var(--border)',
        display: 'flex', flexDirection: 'column', padding: '0', flexShrink: 0
      }}>
        {/* Logo */}
        <div style={{ padding: '28px 24px 20px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ background: 'var(--accent)', borderRadius: 10, padding: 8, display: 'flex' }}>
              <Bus size={18} color="#000" />
            </div>
            <div>
              <div style={{ fontFamily: 'Syne', fontWeight: 800, fontSize: 15, color: 'var(--text)' }}>TIRANA</div>
              <div style={{ fontFamily: 'Syne', fontWeight: 400, fontSize: 10, color: 'var(--muted)', letterSpacing: 2 }}>TRANSIT</div>
            </div>
          </div>
        </div>

        {/* Nav */}
        <nav style={{ flex: 1, padding: '16px 12px', display: 'flex', flexDirection: 'column', gap: 2 }}>
          {navItems.map(({ to, icon: Icon, label, end }) => (
            <NavLink key={to} to={to} end={end} style={({ isActive }) => ({
              display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px',
              borderRadius: 10, textDecoration: 'none', fontFamily: 'Syne', fontWeight: 600,
              fontSize: 13, transition: 'all 0.15s',
              background: isActive ? 'rgba(232,184,75,0.12)' : 'transparent',
              color: isActive ? 'var(--accent)' : 'var(--muted)',
              border: isActive ? '1px solid rgba(232,184,75,0.2)' : '1px solid transparent',
            })}>
              <Icon size={16} />
              {label}
            </NavLink>
          ))}
        </nav>

        {/* User */}
        <div style={{ padding: '16px 12px', borderTop: '1px solid var(--border)' }}>
          <div style={{ background: 'var(--bg3)', borderRadius: 12, padding: '12px 14px', marginBottom: 8 }}>
            <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text)', marginBottom: 2 }}>{user?.name}</div>
            <div style={{ fontSize: 11, color: 'var(--muted)' }}>{user?.email}</div>
            {user?.role === 'passenger' && (
              <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                <Wallet size={12} color="var(--accent)" />
                <span style={{ fontSize: 12, color: 'var(--accent)', fontWeight: 600 }}>{user?.balance?.toLocaleString()} L</span>
              </div>
            )}
          </div>
          <button onClick={handleLogout} className="btn btn-secondary" style={{ width: '100%', justifyContent: 'center', fontSize: 12 }}>
            <LogOut size={14} /> Sign Out
          </button>
        </div>
      </aside>

      {/* Main */}
      <main style={{ flex: 1, overflow: 'auto', background: 'var(--bg)' }}>
        <Outlet />
      </main>
    </div>
  );
}
