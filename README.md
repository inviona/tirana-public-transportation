# 🚌 Tirana Public Transportation Management System
**Full-Stack Web Application — Software Project Management Course**

A modern, full-stack transit management system for the city of Tirana, Albania. Features real GTFS transit data, live vehicle tracking, digital ticketing, and an admin control panel. Styled with Albanian national branding.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19 + Vite, React Router 7, Leaflet, Recharts |
| Backend | Node.js + Express 5 |
| Database | MongoDB Atlas (Mongoose ODM) |
| Auth | JWT + bcryptjs |
| Maps | OpenStreetMap via Leaflet |
| Transit Data | Official GTFS feeds from pt.tirana.al |
| External APIs | OpenStreetMap Nominatim (geocoding), OpenRouteService (walking routes) |

---

## Project Structure

```
tirana-public-transportation/
├── albanian_flag.png          # Albanian flag background image
├── logo.jpeg                  # App logo/branding
├── backend/
│   ├── server.js              # Express API server
│   ├── db.js                  # MongoDB connection + admin seeding
│   ├── gtfs_transit.js        # GTFS data loader & journey planner
│   ├── download_gtfs.js       # GTFS data downloader
│   ├── gtfs_updater.js        # GTFS auto-updater script
│   ├── models/
│   │   ├── User.js            # User model (passenger/admin, wallet balance)
│   │   ├── Ticket.js          # Ticket model (single/daily/weekly/monthly)
│   │   ├── Alert.js           # Service alert model
│   │   └── Report.js          # User report model
│   ├── gtfs_cache.json        # Parsed/stored GTFS data
│   └── package.json
├── frontend/
│   ├── src/
│   │   ├── albanian_flag.png  # Albanian flag for branding
│   │   ├── logo.jpeg          # App logo
│   │   ├── App.jsx            # Router + Auth provider
│   │   ├── main.jsx           # React entry
│   │   ├── index.css          # Design system (dark theme, CSS vars)
│   │   ├── App.css            # Global styles + branding
│   │   ├── pages/
│   │   │   ├── Login.jsx          # Login + register with Albanian flag
│   │   │   ├── Dashboard.jsx      # Home: stats, routes, alerts, live vehicles
│   │   │   ├── RoutePlanner.jsx   # Wrapper → JourneyPlanner
│   │   │   ├── LiveTracking.jsx   # Leaflet map + vehicle tracking
│   │   │   ├── Tickets.jsx        # Wallet + ticket purchase
│   │   │   └── AdminDashboard.jsx # KPIs, fleet, routes, users, alerts
│   │   ├── components/
│   │   │   ├── Layout.jsx         # Sidebar + Albanian flag branding
│   │   │   └── JourneyPlanner.jsx # Full route planner
│   │   └── lib/
│   │       ├── auth.js            # Auth context + API helper
│   │       └── mapUtils.js        # Geo utilities (haversine, snapping)
│   └── package.json
├── README.md
└── .gitignore
```

---

## Quick Start

### 1. Prerequisites

- **Node.js 18+**
- **MongoDB Atlas account** (free tier works fine)
- Create a `.env` file in `backend/`:
  ```
  MONGODB_URI=mongodb+srv://<user>:<pass>@<cluster>.mongodb.net/tirana_transit
  JWT_SECRET=your-secret-key-here
  ORS_API_KEY=your-openrouteservice-api-key   # optional, for walking directions
  ```

### 2. Install & Start Backend

```bash
cd backend
npm install
npm start
# API running on http://localhost:3001
```

On first run, the backend will:
- Connect to MongoDB Atlas
- Auto-seed the admin account (`admin@transit.al / admin123`)
- Load GTFS transit data from cache

### 3. Install & Start Frontend

```bash
cd frontend
npm install
npm run dev
# App running on http://localhost:5173
```

### 4. Default Credentials

| Role | Email | Password |
|------|-------|----------|
| Admin | admin@transit.al | admin123 |
| Passenger | (register any email) | (any) |

---

## Features

### 🗺️ Route Planning (`/plan`)
- **Stop-to-stop search**: Autocomplete across all 500+ GTFS stops
- **Address geocoding**: Type any address → find nearest bus stop (Nominatim)
- **Walking directions**: Real foot routes from address to nearest stop (OpenRouteService)
- **"My Location"**: Use browser GPS to find nearby stops (within 500m)
- **GTFS journey planning**: Direct routes + one-transfer routes with real schedules
- **Interactive map**: Highlighted route polylines, walking path (dashed), stop markers
- **Landmarks layer**: Institutions/landmarks overlaid on the map (togglable)
- **Route visualization**: Stop sequence diagram with times

### 📍 Live Vehicle Tracking (`/tracking`)
- **Leaflet map** of Tirana with OpenStreetMap tiles
- **Animated vehicles** (CircleMarkers) updating every 3 seconds
- **Route filter**: Show all routes or filter by specific line
- **Vehicle details panel**: Plate, speed, crowd level, ETA, next stop
- **"I'm on a Bus" mode**: Use browser GPS to snap position to the nearest route line; shows off-route warning if >200m from route
- **Landmarks layer**: Toggle institutions/POIs on the map
- **Route polylines**: Coloured lines showing each route's path

### 🎫 Digital Ticketing & Wallet (`/tickets`)
- **Wallet system**: Top up balance (200–5000 L options)
- **4 ticket types**: Single (40L / 4hr), Day (150L / 24hr), Weekly (600L), Monthly (2500L)
- **QR code display** for active tickets
- **Ticket history** with expiration tracking
- **Insufficient balance** warnings with quick top-up prompt
- **Stripe payments**: Apple Pay, Card, SEPA Direct Debit (IBAN) via Payment Element

### 📊 Admin Dashboard (`/admin`)

**Overview Tab**
- KPI cards: Total Users, Vehicles, Tickets Sold, Revenue
- Weekly ridership bar chart
- Per-route on-time performance progress bars

**Fleet Tab**
- Grid of all vehicles with live status, speed, crowd level, next stop

**Routes Tab**
- List all routes with activate/suspend toggle

**Users Tab**
- Table: Name, Email, Role, Balance, Joined date

**Alerts Tab**
- Post service alerts (delay, disruption, maintenance, info) with severity levels
- System health monitor (GPS feed, payment gateway, route data, notifications, analytics — all online indicators)

### 🔐 Authentication
- JWT-based login/register with 7-day token expiry
- bcrypt password hashing
- Role-based routing (passenger vs admin)
- Protected API endpoints (middleware)

### 🇦🇱 Albanian Branding
- Albanian flag background on login and layout pages
- Custom app logo
- Consistent national color theming throughout the UI

---

## API Endpoints

### Auth
```
POST   /api/auth/register       Register user
POST   /api/auth/login          Login user
GET    /api/auth/me             Get current user
```

### Routes & Stops
```
GET    /api/routes              All routes (lightweight)
GET    /api/routes/:id          Single route detail
GET    /api/stops               Search stops (q=query, route=filter)
```

### GTFS Transit (real schedules)
```
GET    /api/transit/routes           Route list
GET    /api/transit/routes/:id       Route detail + stops in order + schedule
GET    /api/transit/stops            Search stops
GET    /api/transit/stops/:id        Stop detail + arrivals
GET    /api/transit/stops/:id/arrivals  Real-time arrivals for a stop
POST   /api/transit/journey         Plan journey (fromStopId, toStopId) → direct + transfers
```

### Vehicles & Tracking
```
GET    /api/vehicles           Auth-required: fleet list (filterable by routeId)
GET    /api/tracking           Public: live vehicle positions
```

### Tickets & Wallet
```
GET    /api/tickets            User's tickets (auth)
POST   /api/tickets/purchase   Buy ticket {type, routeId?} (auth)
POST   /api/wallet/topup       Add funds directly (auth, legacy)
```

### Stripe Payments
```
GET    /api/payments/config          Get publishable key + amounts
POST   /api/payments/create-intent   Create Stripe PaymentIntent (auth)
POST   /api/payments/confirm         Confirm payment + credit wallet (auth)
```

### Alerts & Reports
```
GET    /api/alerts             All service alerts
POST   /api/alerts             Post alert (admin)
POST   /api/reports            Submit user report (auth)
GET    /api/reports            View all reports (admin)
```

### Admin Analytics
```
GET    /api/admin/analytics    KPIs: users, vehicles, revenue, ridership, route performance
GET    /api/admin/users        All users (admin)
GET    /api/admin/vehicles     Fleet status (admin)
PATCH  /api/admin/routes/:id   Toggle route active/suspended (admin)
```

### Geospatial Utilities
```
GET    /api/geocode            Geocode address → lat/lng (Nominatim proxy)
POST   /api/nearest-stop       Find nearest bus stop {lat, lng} + distance
POST   /api/walking-route      Walking route {from: [lng,lat], to: [lng,lat]} (ORS)
GET    /api/map/routes         Routes with full geometry for map rendering
GET    /api/institutions       POIs/landmarks in Tirana
```

---

## GTFS Data

The app loads **official GTFS data** from `pt.tirana.al`. To update:

```bash
cd backend
node download_gtfs.js
```

For automatic GTFS updates on a schedule, use the updater:
```bash
cd backend
node gtfs_updater.js
```

This downloads the GTFS zip, parses routes/stops/trips/shapes/calendar, and caches to `gtfs_cache.json`. The `GTFSData` class in `gtfs_transit.js` provides:
- Real schedules by route
- Live arrivals at any stop
- Journey planning (direct + transfer routes)
- Active service detection by day of week

---

## Connecting to Real GPS Data

The tracking endpoint currently simulates vehicle movement in-memory. To connect real GPS:

1. Vehicle devices POST their location to `/api/vehicles/:id/location`
2. Replace the `setInterval` simulation in `server.js` with real position updates
3. (Optional) Add Socket.io for real-time push to the frontend

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `MONGODB_URI` | **Yes** | MongoDB Atlas connection string |
| `JWT_SECRET` | No | JWT signing key (default: `tirana-transit-secret-2024`) |
| `ORS_API_KEY` | No | OpenRouteService API key for walking directions |
| `STRIPE_SECRET_KEY` | **Yes** | Stripe secret key for payment processing |
| `STRIPE_PUBLISHABLE_KEY` | **Yes** | Stripe publishable key (frontend) |

---

## Stripe Payments

The app uses Stripe Payment Intents API for wallet top-ups with support for **Apple Pay**, **Card**, and **SEPA Direct Debit (IBAN)**.

### Setup

1. Create a Stripe account at [stripe.com](https://stripe.com)
2. Enable payment methods in Dashboard → Settings → Payment methods:
   - Cards (enabled by default)
   - Apple Pay / Google Pay (enable "Wallets" toggle)
   - SEPA Direct Debit
3. Add environment variables:

**Backend** (`backend/.env`):
```
STRIPE_SECRET_KEY=sk_test_...
```

**Frontend** (`frontend/.env`):
```
VITE_STRIPE_PUBLISHABLE_KEY=pk_test_...
```

### Payment Flow

1. User selects top-up amount (200–5000 L)
2. Frontend calls `/api/payments/create-intent` → returns `clientSecret`
3. Stripe Payment Element renders with available methods (Apple Pay, Card, SEPA)
4. User completes payment via their preferred method
5. Frontend confirms payment → calls `/api/payments/confirm`
6. Backend credits the user's wallet balance

---

*Built for: Software Project Management — Tirana's Public Transportation Management System*
