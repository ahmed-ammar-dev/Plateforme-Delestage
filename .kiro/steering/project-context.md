# STEG TGM — Project Context

## What This Project Is

A **national load-shedding management platform** for STEG (Société Tunisienne de l'Électricité et du Gaz).
It simulates a real-time SCADA-style control room interface for managing scheduled electricity outages (délestage) across Tunisia.

The workspace has two folders:
- `preparation/` — HTML mockups used as design references (DO NOT modify these)
- `frontend/` — The actual React app being built

---

## Tech Stack

| Tool | Version |
|------|---------|
| React | 18.3.1 |
| Vite | 8.3.0 |
| React Router DOM | 6.26.1 |
| TanStack React Query | 5.56.2 |
| Zustand | 4.5.5 (with `persist` middleware) |
| Axios | 1.7.4 |
| Tailwind CSS | 3.4.11 |
| Recharts | 2.12.7 |
| Leaflet + React-Leaflet | 1.9.4 / 4.2.1 |
| clsx | 2.1.1 |
| TypeScript | ~6.0.2 (tsconfig present but JSX files used) |

**Fonts loaded in index.html:** IBM Plex Sans, JetBrains Mono, Material Symbols Outlined (Google Fonts).

---

## Architecture

### Auth & Routing (`src/App.jsx`)

Role-based routing with a `ProtectedRoute` wrapper. Three roles:
- `DN` → `/dn/dashboard`, `/dn/map`
- `CRC` → `/crc/dashboard`
- `BCC` → `/bcc/dashboard`
- Public: `/login`, `/portail` (CitizenPortal)

Auth state is stored in Zustand with `localStorage` persistence under key `steg-auth`. The store shape: `{ user, token, login(), logout() }`.

### API Layer (`src/lib/api.js`)

Axios instance with:
- `baseURL`: `VITE_API_URL` env var, falls back to `http://localhost:8000`
- Request interceptor: attaches Bearer token from auth store
- Response interceptor: auto-logout + redirect on 401

### Layouts

- `InternalLayout` — fixed TopBar (h-14) + fixed Sidebar (w-64) + fixed StatusBar (h-8), main content is `pl-64 pt-14 pb-8`
- `PublicLayout` — simple `<Outlet />` wrapper for the citizen portal

---

## Design System

Dark industrial SCADA theme. All custom tokens are defined in `tailwind.config.js`.

**Color palette** (key tokens):
- `background` / `surface` → `#031427` (deep navy)
- `surface-container-low` → `#0b1c30`
- `surface-container` → `#102034`
- `surface-container-high` → `#1b2b3f`
- `surface-container-highest` → `#26364a`
- `on-surface` → `#d3e4fe`
- `on-surface-variant` → `#c5c6cd`
- `secondary` → `#acc7ff` (main accent blue — conformant state)
- `tertiary` → `#ffb95f` (amber — warning state)
- `error` → `#ffb4ab` / `error-container` → `#93000a` (critical state)
- Short aliases also available: `accent-blue`, `accent-amber`, `accent-red`, `accent-green`, `bg-deep`, `bg-surface`, `bg-container`, etc.

**Typography tokens** (fontSize + fontFamily in tailwind):
- `headline-lg/md/sm` — IBM Plex Sans, 600 weight
- `body-lg/md/sm` — IBM Plex Sans, regular
- `label-caps` — IBM Plex Sans, 600, uppercase
- `label-telemetry-lg/md/sm` — JetBrains Mono

**Spacing tokens** (in tailwind `spacing`):
- `space-xs`=0.125rem, `space-sm`=0.25rem, `space-md`=0.5rem, `space-lg`=0.75rem, `space-xl`=1rem, `gutter`=0.5rem, `margin`=0.75rem

**Border radius**: DEFAULT=2px, lg=4px, xl=8px — very sharp corners, industrial feel.

**CSS classes defined in `src/index.css`** (global utility classes):
- `.steg-card` — surface container card style
- `.steg-label` — small caps label style
- `.steg-input` — dark-themed input
- `.steg-btn-primary`, `.steg-btn-secondary` — button variants
- `.badge-ok`, `.badge-warn`, `.badge-crit` — status badges

**Icons**: Use `<span className="material-symbols-outlined">icon_name</span>`. All pages define a local `Icon` helper component that wraps this. Do not use react-icons or any other icon library.

---

## Mock Data (`src/data/mockData.js`)

All data is currently mocked — no real backend calls yet.

Key exports:
- `MOCK_USER_DN`, `MOCK_USER_CRC_NORD`, `MOCK_USER_BCC3` — demo user objects
- `BCC_LIST` — 7 BCCs with status, MW targets/actuals, operators
- `CRC_LIST` — 2 CRCs (Nord, Sud) with BCCs nested
- `NATIONAL_KPI` — national-level KPIs
- `CHART_DATA` — 48-point 24h chart data
- `ALERTS` — 5 alert objects
- `FEEDERS_BCC3` — 12 HTA feeders for BCC 3 with priority/status
- `TUNISIA_OUTLINE`, `BCC_ZONES`, `P0_SITES`, `LINES_225KV`, `LINES_150KV` — Leaflet map data

---

## Pages & Components — Current State

### ✅ Fully Built

**`LoginPage`** (`/login`)
- Dark SCADA-style login with Tunisia watermark SVG background
- Demo credentials: `dn.admin` / `crc.nord` / `bcc.3` (any password ≥4 chars)
- Redirects by role after login

**`DNDashboard`** (`/dn/dashboard`) — The most complex page
- Critical deficit alert banner with AI panel trigger
- 5 KPI cards: Planifié (450 MW), Réalisé (411.5 MW, -38.5 MW), Zones actives, BCCs en anomalie (2/7), ENS (1428.6 MWh)
- Custom interactive SVG chart (24h, hover tooltip with MW values, deficit hatch zone, "NOW" marker at 14:30)
- CRC Nord + CRC Sud cards with progress bars and BCC mini-cards
- SCADA alert log (5 entries)
- Full BCC telemetry table (7 rows)
- AI slide-in panel (fixed right, translate animation, hardcoded recommendations)
- Detail modal (deficit synthesis)

**`DNMap`** (`/dn/map`)
- Leaflet map: Tunisia polygon, 7 BCC zone polygons colored by status, CRC boundary dashes, 225kV/150kV lines, substation markers, P0 sites (hospital/water icons)
- Click BCC zone → selected panel (top-right card)
- Legend (bottom-left), weather card (bottom-left)
- AI drawer (AiDrawer component)

**`CRCDashboard`** (`/crc/dashboard`)
- Role-aware: reads `user.zone` to determine which CRC to show (defaults to CRC Nord)
- AlertBanner if deficit > 10%
- 4 KPI cards
- Recharts LineChart (24h regional curve, scaled from national data)
- MW arbitrage matrix (editable BCC split with number inputs, balance bar, validation)
- BCC status table

**`BCCDashboard`** (`/bcc/dashboard`)
- Hardcoded to BCC 3 — Nord-Ouest
- Feeder selection table (12 feeders, P0 locked/read-only, P1-P5 toggleable)
- MW balance bar + tolerance check (±1.5 MW)
- Validate & Execute button (enables when within tolerance)
- ExecutionRow component with per-feeder elapsed timer and restore button
- AlertBanner when any feeder exceeds 45 min max

**`CitizenPortal`** (`/portail`)
- Public-facing, completely different light styling (white/gray, not dark SCADA theme)
- Zone search by gouvernorat name
- Leaflet map (light theme) with BCC zones colored by cut status
- Schedule table for all 7 zones
- FAQ section
- Chatbot widget (keyword-matching, fixed bottom-right bubble)

### ✅ Shared Components

- `Sidebar` — Role-based nav links, cycle automator indicator, collapse button. DN nav has 4 items only: Supervision DN, Analyse & Historique ENS, Éditeur SIG & Topologie, Paramètres & Seuils. "Conduite Régionale" and "Postes Locaux" were removed — CRC and BCC each have their own separate login and route, DN does not navigate into them.
- `TopBar` — Logo, frequency badge, role-based view tabs, live clock (UTC+1 + UTC), notifications badge, user info, logout
- `StatusBar` — Fixed bottom bar: date/time, active cuts count, network tension status, SCADA uptime
- `KpiCard` — Generic KPI card with status coloring (ok/warn/crit)
- `AlertBanner` — Colored left-border alert strip with optional action button
- `AiDrawer` — Slide-in AI chat panel with mock responses

---

## Pages NOT Yet Built

These routes exist in the Sidebar nav (DN role) but have no page components yet:

| Route | Label |
|-------|-------|
| `/dn/historique` | Analyse & Historique ENS |
| `/dn/parametres` | Paramètres & Seuils |

Navigating to them currently leads nowhere (no route defined in App.jsx).

The **SIG editor** referenced in `preparation/editeur_SIG_&_topologie_Reseau_Mode_Edition_Avance.html` is also not built yet.

---

## Design Reference Files (in `preparation/`)

These HTML files are the source of truth for UI design. Always consult them before building a new page:

| File | Corresponds To |
|------|---------------|
| `preparation/Page_de_connexion_STEG.html` | LoginPage |
| `preparation/DN/Poste_de_conduite_nationale_tableau_de_bord.html` | DNDashboard |
| `preparation/DN/Poste_de_conduite_Nationale_cartographie_SIG.html` | DNMap |
| `preparation/CRC/Poste_de_conduite_regionale_supervision_&_Repartition.html` | CRCDashboard |
| `preparation/BCC/Poste_de_Conduite_locale_Ordonnancement_&_manoeuvres_HTA.html` | BCCDashboard |
| `preparation/Portail_citoyen/Suivi_du_delestage_en temps_reel.html` | CitizenPortal |
| `preparation/Portail_citoyen/chatbot_d_assistance_ouvert.html` | CitizenPortal chatbot |
| `preparation/editeur_SIG_&_topologie_Reseau_Mode_Edition_Avance.html` | SIG Editor (not yet built) |

---

## Coding Conventions

- Files use `.jsx` extension for React components
- Formatting: opening braces on new lines for functions/JSX blocks, comma-first for multi-line object/array literals
- Each page defines its own local `Icon` helper (not imported from a shared file)
- Tailwind classes use the custom design tokens above — avoid raw hex colors inline unless in Leaflet tooltips
- All text content is in French (Tunisia/STEG context)
- No test files exist — don't create them unless asked
- `index.css` uses `@layer components` for `.steg-*` utility classes

---

## Known Issues / Notes

- `src/counter.ts` and `src/main.ts` are leftover Vite scaffold files — ignore them
- The backend folder is empty — no API yet, everything is mocked
- `CitizenPortal` uses light styling intentionally — it's a public portal, not a SCADA interface
- BCC 3 is hardcoded in BCCDashboard — no BCC-selection logic yet
- The AI panels are all mock/hardcoded — no real AI integration
