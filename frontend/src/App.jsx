import { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import RoutePlanner from './pages/RoutePlanner';
import LiveTracking from './pages/LiveTracking';
import Tickets from './pages/Tickets';
import AdminDashboard from './pages/AdminDashboard';
import Layout from './components/Layout';
import { AuthContext } from './lib/auth';
import './App.css';

export default function App() {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(localStorage.getItem('tt_token'));
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (token) {
      fetch('http://localhost:3001/api/auth/me', {
        headers: { Authorization: `Bearer ${token}` }
      }).then(r => r.json()).then(data => {
        if (!data.error) setUser(data);
        else { localStorage.removeItem('tt_token'); setToken(null); }
      }).finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, [token]);

  const login = (token, user) => {
    localStorage.setItem('tt_token', token);
    setToken(token);
    setUser(user);
  };

  const logout = () => {
    localStorage.removeItem('tt_token');
    setToken(null);
    setUser(null);
  };

  if (loading) return (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'100vh', background:'#0a0e1a', color:'#e8b84b', fontFamily:'monospace', fontSize:'1.2rem' }}>
      Loading Tirana Transit...
    </div>
  );

  return (
    <AuthContext.Provider value={{ user, token, login, logout }}>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={!user ? <Login /> : <Navigate to="/" />} />
          <Route path="/" element={user ? <Layout /> : <Navigate to="/login" />}>
            <Route index element={<Dashboard />} />
            <Route path="plan" element={<RoutePlanner />} />
            <Route path="tracking" element={<LiveTracking />} />
            <Route path="tickets" element={<Tickets />} />
            <Route path="admin" element={user?.role === 'admin' ? <AdminDashboard /> : <Navigate to="/" />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthContext.Provider>
  );
}
