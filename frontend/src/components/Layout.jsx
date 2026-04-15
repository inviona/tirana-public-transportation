import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { Bus, Map, Navigation, Ticket, LayoutDashboard, LogOut, Wallet as WalletIcon, CreditCard } from 'lucide-react';
import logo from '../logo.jpeg';

export default function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = () => { logout(); navigate('/login'); };

  const navItems = [
    { to: '/', icon: LayoutDashboard, label: 'Dashboard', end: true },
    { to: '/plan', icon: Map, label: 'Plan Route' },
    { to: '/tracking', icon: Navigation, label: 'Live Tracking' },
    { to: '/wallet', icon: WalletIcon, label: 'Wallet & Payments' },
    { to: '/tickets', icon: Ticket, label: 'My Tickets' },
    ...(user?.role === 'admin' ? [{ to: '/admin', icon: LayoutDashboard, label: 'Admin Panel' }] : []),
  ];

  return (
    <div className="app-container" style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
      {/* Sidebar */}
      <aside className="sidebar" style={{
        width: 260, 
        display: 'flex', 
        flexDirection: 'column', 
        padding: '0', 
        flexShrink: 0
      }}>
        {/* Logo */}
        <div className="sidebar-logo" style={{ padding: '28px 24px 20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <img src={logo} alt="Logo" style={{ width: 52, height: 52, borderRadius: 12, objectFit: 'cover', boxShadow: '0 4px 12px rgba(0,0,0,0.3)' }} />
            <div>
              <div style={{ fontFamily: 'Syne', fontWeight: 800, fontSize: 18, color: 'var(--text)', letterSpacing: 1 }}>TIRANA</div>
              <div style={{ fontFamily: 'Syne', fontWeight: 400, fontSize: 11, color: 'var(--muted)', letterSpacing: 3 }}>TRANSIT</div>
            </div>
          </div>
        </div>

        {/* Nav */}
        <nav className="sidebar-nav" style={{ flex: 1, padding: '20px 14px', display: 'flex', flexDirection: 'column', gap: 4 }}>
          {navItems.map(({ to, icon: Icon, label, end }) => (
            <NavLink key={to} to={to} end={end} className="nav-link" style={({ isActive }) => ({
              display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px',
              borderRadius: 12, textDecoration: 'none', fontFamily: 'Syne', fontWeight: 600,
              fontSize: 13, transition: 'all 0.2s ease',
              color: isActive ? 'var(--accent)' : 'var(--muted)',
            })}>
              <Icon size={18} />
              {label}
            </NavLink>
          ))}
        </nav>

        {/* User */}
        <div style={{ padding: '16px 14px', borderTop: '1px solid var(--glass-border)' }}>
          <div className="sidebar-user" style={{ borderRadius: 14, padding: '14px 16px', marginBottom: 10 }}>
            <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--text)', marginBottom: 2 }}>{user?.name}</div>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 6 }}>{user?.email}</div>
            {user?.role === 'passenger' && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 10px', background: 'rgba(207,10,44,0.1)', borderRadius: 8, border: '1px solid rgba(207,10,44,0.2)' }}>
                <CreditCard size={14} color="var(--accent)" />
                <span style={{ fontSize: 13, color: 'var(--accent)', fontWeight: 700 }}>{user?.balance?.toLocaleString()} L</span>
              </div>
            )}
          </div>
          <button onClick={handleLogout} className="btn btn-secondary" style={{ width: '100%', justifyContent: 'center', fontSize: 12, padding: '10px 16px' }}>
            <LogOut size={14} /> Sign Out
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="main-content" style={{ flex: 1, overflow: 'auto', position: 'relative' }}>
        <Outlet />
      </main>
    </div>
  );
}
