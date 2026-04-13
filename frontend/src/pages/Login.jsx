import { useState } from 'react';
import { useAuth } from '../lib/auth';
import { Bus, Eye, EyeOff } from 'lucide-react';

export default function Login() {
  const { login } = useAuth();
  const [mode, setMode] = useState('login');
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPw, setShowPw] = useState(false);

  const handleSubmit = async () => {
    setError(''); setLoading(true);
    try {
      const path = mode === 'login' ? '/api/auth/login' : '/api/auth/register';
      const res = await fetch(`http://localhost:3001${path}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form)
      });
      const data = await res.json();
      if (data.error) setError(data.error);
      else login(data.token, data.user);
    } catch { setError('Cannot connect to server. Is the backend running?'); }
    finally { setLoading(false); }
  };

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', background: 'var(--bg)',
      backgroundImage: 'radial-gradient(ellipse at 20% 50%, rgba(232,184,75,0.06) 0%, transparent 60%), radial-gradient(ellipse at 80% 20%, rgba(78,158,255,0.06) 0%, transparent 60%)'
    }}>
      {/* Left Panel */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', padding: 60 }}>
        <div style={{ maxWidth: 420, width: '100%' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 48 }}>
            <div style={{ background: 'var(--accent)', borderRadius: 14, padding: 12, display: 'flex' }}>
              <Bus size={24} color="#000" />
            </div>
            <div>
              <div style={{ fontFamily: 'Syne', fontWeight: 800, fontSize: 22, color: 'var(--text)' }}>TIRANA TRANSIT</div>
              <div style={{ fontFamily: 'Syne', fontWeight: 400, fontSize: 11, color: 'var(--muted)', letterSpacing: 3 }}>MANAGEMENT SYSTEM</div>
            </div>
          </div>

          <h2 style={{ fontFamily: 'Syne', fontWeight: 700, fontSize: 28, marginBottom: 6 }}>
            {mode === 'login' ? 'Welcome back' : 'Create account'}
          </h2>
          <p style={{ color: 'var(--muted)', marginBottom: 32 }}>
            {mode === 'login' ? 'Sign in to your account to continue' : 'Join Tirana\'s public transit platform'}
          </p>

          {/* Quick Login */}
          {mode === 'login' && (
            <div style={{ background: 'rgba(78,158,255,0.08)', border: '1px solid rgba(78,158,255,0.2)', borderRadius: 10, padding: '12px 16px', marginBottom: 24 }}>
              <p style={{ fontSize: 12, color: 'var(--accent2)', marginBottom: 8, fontWeight: 600 }}>Quick login credentials:</p>
              <p style={{ fontSize: 11, color: 'var(--muted)' }}>Admin: admin@transit.al / admin123</p>
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {mode === 'register' && (
              <div>
                <label>Full Name</label>
                <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Arta Hoxha" />
              </div>
            )}
            <div>
              <label>Email</label>
              <input type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} placeholder="you@example.com" />
            </div>
            <div>
              <label>Password</label>
              <div style={{ position: 'relative' }}>
                <input type={showPw ? 'text' : 'password'} value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} placeholder="••••••••" style={{ paddingRight: 44 }} />
                <button onClick={() => setShowPw(!showPw)} style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)' }}>
                  {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            {error && <div style={{ color: 'var(--red)', fontSize: 13, padding: '10px 14px', background: 'rgba(239,68,68,0.1)', borderRadius: 8 }}>{error}</div>}

            <button className="btn btn-primary" onClick={handleSubmit} disabled={loading} style={{ width: '100%', justifyContent: 'center', padding: '13px', fontSize: 14, marginTop: 4 }}>
              {loading ? 'Please wait...' : mode === 'login' ? 'Sign In' : 'Create Account'}
            </button>
          </div>

          <p style={{ textAlign: 'center', marginTop: 24, color: 'var(--muted)', fontSize: 13 }}>
            {mode === 'login' ? "Don't have an account? " : "Already have an account? "}
            <button onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(''); }} style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontWeight: 600 }}>
              {mode === 'login' ? 'Sign up' : 'Sign in'}
            </button>
          </p>
        </div>
      </div>

      {/* Right Panel */}
      <div style={{
        width: 480, background: 'var(--bg2)', borderLeft: '1px solid var(--border)',
        display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: 60,
        backgroundImage: 'radial-gradient(ellipse at 50% 80%, rgba(232,184,75,0.08) 0%, transparent 70%)'
      }}>
        <h3 style={{ fontFamily: 'Syne', fontWeight: 700, fontSize: 20, marginBottom: 32, color: 'var(--accent)' }}>System Features</h3>
        {[
          { icon: '🗺️', title: 'Smart Route Planning', desc: 'Find optimal paths across Tirana with real-time alternatives' },
          { icon: '📍', title: 'Live Vehicle Tracking', desc: 'GPS tracking of all buses with crowd levels and ETAs' },
          { icon: '🎫', title: 'Digital Ticketing', desc: 'Purchase single, daily, weekly, or monthly passes instantly' },
          { icon: '📊', title: 'Admin Analytics', desc: 'Fleet management, ridership data, and performance metrics' },
        ].map(f => (
          <div key={f.title} style={{ display: 'flex', gap: 16, marginBottom: 24 }}>
            <div style={{ fontSize: 24, width: 40, flexShrink: 0 }}>{f.icon}</div>
            <div>
              <div style={{ fontFamily: 'Syne', fontWeight: 600, marginBottom: 4 }}>{f.title}</div>
              <div style={{ color: 'var(--muted)', fontSize: 13 }}>{f.desc}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
