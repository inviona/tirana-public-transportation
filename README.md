# 🚌 Tirana Public Transportation Management System
**Full-Stack Web Application — Software Project Management Course**

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18 + Vite, React Router, Recharts |
| Backend | Node.js + Express |
| Database | In-memory (JSON) — easily swappable to PostgreSQL |
| Auth | JWT (JSON Web Tokens) + bcrypt |
| Styling | Custom CSS Design System (dark theme) |

---

## Project Structure

```
tirana-transit/
├── backend/
│   ├── server.js          # Express API server
│   └── package.json
└── frontend-app/
    ├── src/
    │   ├── pages/
    │   │   ├── Login.jsx          # Auth (login + register)
    │   │   ├── Dashboard.jsx      # Home with live stats + alerts
    │   │   ├── RoutePlanner.jsx   # Route search + trip options
    │   │   ├── LiveTracking.jsx   # Real-time vehicle map
    │   │   ├── Tickets.jsx        # Buy/view tickets + wallet
    │   │   └── AdminDashboard.jsx # Analytics + fleet + user mgmt
    │   ├── components/
    │   │   └── Layout.jsx         # Sidebar navigation
    │   └── lib/
    │       └── auth.js            # Auth context + API helper
    └── package.json
```

---

## Quick Start

### 1. Start the Backend
```bash
cd backend
node server.js
# API running on http://localhost:3001
```

### 2. Start the Frontend
```bash
cd frontend-app
npm install
npm run dev
# App running on http://localhost:5173
```

### 3. Login Credentials

| Role | Email | Password |
|------|-------|----------|
| Passenger | arta@example.com | password123 |
| Admin | admin@transit.al | admin123 |

---

## Features Implemented

### 🗺️ Route Planning
- Select departure and destination from all Tirana stops
- See multiple route options with duration, transfers, price, crowd level
- Expandable route detail with stop sequence
- One-click ticket purchase from results

### 📍 Live Vehicle Tracking
- SVG map of Tirana with streets and landmarks
- Animated vehicle positions updating every 3 seconds
- Filter by route
- Click vehicle for detailed info (speed, crowd, ETA)
- Color-coded by route

### 🎫 Digital Ticketing & Wallet
- Wallet system with top-up
- 4 ticket types: Single (40L), Day (150L), Weekly (600L), Monthly (2500L)
- QR code generation for active tickets
- Full ticket history

### 📊 Admin Dashboard
- KPI cards: users, vehicles, revenue, tickets sold
- Weekly ridership bar chart
- Per-route on-time performance
- Fleet status for all vehicles
- Route activate/suspend controls
- User management table
- Post service alerts (delay, disruption, maintenance)
- System health monitor

### 🔐 Authentication
- JWT-based login/register
- Role-based routing (passenger vs admin)
- Protected API endpoints

---

## API Endpoints

```
POST   /api/auth/login          Login user
POST   /api/auth/register       Register user
GET    /api/auth/me             Get current user

GET    /api/routes              All routes
POST   /api/routes/plan         Plan route (from/to)
GET    /api/tracking            Live vehicle positions

GET    /api/tickets             User's tickets (auth)
POST   /api/tickets/purchase    Buy ticket (auth)
POST   /api/wallet/topup        Top up balance (auth)

GET    /api/alerts              Service alerts
POST   /api/alerts              Post alert (admin)

GET    /api/admin/analytics     KPIs + charts (admin)
GET    /api/admin/users         All users (admin)
GET    /api/admin/vehicles      Fleet status (admin)
PATCH  /api/admin/routes/:id    Toggle route (admin)
```

---

## Upgrading to Production

To make this production-ready, swap the in-memory DB for **PostgreSQL** or **MongoDB**:

```bash
npm install pg  # PostgreSQL driver
```

Then replace `db` object in `server.js` with SQL queries. The API structure stays identical.

---

## Connecting to Real GPS Data

The tracking endpoint currently simulates movement. To connect real GPS:
1. Vehicle devices POST their location to `/api/vehicles/:id/location`
2. The tracking endpoint broadcasts via WebSocket (add `socket.io`)
3. Frontend subscribes to WebSocket instead of polling

---

*Built for: Software Project Management — Tirana's Public Transportation Management System*
