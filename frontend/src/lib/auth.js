import { createContext, useContext } from 'react';
export const AuthContext = createContext(null);
export const useAuth = () => useContext(AuthContext);
export const API = 'http://localhost:3001/api';
export const apiFetch = async (path, options = {}, token = null) => {
  const headers = { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...options.headers };
  const res = await fetch(`${API}${path}`, { ...options, headers });
  return res.json();
};
