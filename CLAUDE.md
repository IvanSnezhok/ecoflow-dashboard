# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Purpose

Dashboard for monitoring and controlling Ecoflow devices (Delta Pro, River Series) with:
- Real-time device status and extra battery monitoring (bmsSlave1/bmsSlave2)
- Device control (AC/DC outputs, charge limits)
- Historical usage data and charts (10 min, daily, weekly, monthly)
- Detailed operation logging

## Development Commands

```bash
# Start both frontend and backend in development
npm run dev

# Frontend only (Vite dev server on port 5173)
npm run dev:frontend

# Backend only (Express server on port 3001)
npm run dev:backend

# Build
npm run build              # Frontend
npm run build:backend      # Backend

# Production
npm run start              # Run built backend
```

## Architecture

### Frontend (React + TypeScript + Vite)
- **State Management**: Zustand store in `src/stores/deviceStore.ts`
- **API Client**: Axios wrapper in `src/services/api.ts`
- **Real-time**: WebSocket client in `src/services/wsClient.ts` connects to backend
- **Routing**: React Router with pages in `src/pages/`
- **UI**: Tailwind CSS + custom components (no shadcn/ui primitives installed, manual implementations)

### Backend (Express + TypeScript)
- **Entry**: `server/src/index.ts`
- **Database**: SQLite via better-sqlite3 in `server/src/db/database.ts`
- **Ecoflow API**: REST client in `server/src/services/ecoflowApi.ts`
- **MQTT**: Real-time device updates via `server/src/services/mqttService.ts`
- **Auth**: HMAC-SHA256 signature in `server/src/services/signatureService.ts`

### Ecoflow API Integration

**Critical**: Params are NOT signed for GET requests. The signature only includes `accessKey`, `nonce`, `timestamp`.

```typescript
// Correct - params not in signature
const { headers } = generateSignature({
  accessKey, secretKey,
  params: {}, // Empty for GET requests
})
```

**API Field Mapping** (dot-notation from Ecoflow API):
- Battery: `pd.soc`, `bmsMaster.soc`
- Power: `inv.inputWatts`, `inv.outputWatts`, `mppt.inWatts`
- State: `inv.cfgAcEnabled`, `mppt.carState`
- Extra batteries: `bmsSlave1.*`, `bmsSlave2.*` (soc, temp, vol, inputWatts, outputWatts, cycles, soh)

### Database Schema (SQLite)

Tables: `devices`, `device_states`, `operation_logs`
- Device states store historical data for charts
- Operation logs track all API calls and commands

## Environment Variables

Create `.env` in project root:
```
ECOFLOW_ACCESS_KEY=your_access_key
ECOFLOW_SECRET_KEY=your_secret_key
ECOFLOW_API_ENDPOINT=https://api-e.ecoflow.com  # Europe
ECOFLOW_MQTT_URL=mqtt-e.ecoflow.com
ECOFLOW_MQTT_PORT=8883
```

## Key Implementation Notes

1. **DeviceLoader component** in `App.tsx` fetches devices globally so direct URL navigation works
2. **Extra batteries** (`server/src/services/extraBatteries.ts`): a slot holds a pack when `bmsSlaveN.fullCap` or `.vol` is non-zero. The cloud often omits one bmsSlave block per answer and BLE sends only their SOC, so `ecoflowApi.getDeviceQuota` fills a missing pack from its last report for up to 30 min (`held` + `lastUpdated` in the device state); the panel, charts and the outage runtime forecast all read that filled quota
3. **Controls** use optimistic UI updates via `updateDeviceState` in Zustand store
4. **Logs page** filters by type: API_CALL, COMMAND, MQTT
5. **Device Info card** (`GET /api/devices/:sn/info`, `server/src/services/deviceInfo.ts`) shows serials, firmware (`*.sysVer` packed one byte per part) and Wi-Fi RSSI (`pd.wifiRssi`, 0 = not reported). The Open API quota has no MAC/SSID for DELTA Pro; they are matched by key name for models that do send them
6. **Connection uptime** (Device Info card, `server/src/services/connectionStats.ts`): the background collector records online/offline changes of the cloud `online` flag in `device_connection_events`; `device_connection_watch` holds a heartbeat so dashboard downtime is marked as unobserved (durations become "≥")
7. **BLE channel** (`ble-bridge/` Python container + `server/src/services/bleBridge.ts`): the bridge serves BLE heartbeats as a cloud-style quota; `ecoflowApi` merges it in `getDeviceList`/`getDeviceQuota` and routes commands BLE-first or cloud-first per `ECOFLOW_BLE_MODE` (prefer | fallback | off), so callers need no BLE awareness. List items carry `cloudOnline` (cloud flag, used for Wi-Fi uptime) next to `online` (cloud or BLE)
8. **BLE account** (Settings page, `server/src/routes/ble.ts`): the panel's login form passes email/password once to the bridge (`/account/login`), which keeps only the resolved user ID in `server/data/ble/user_id` (takes precedence over `.env`). Request logging goes through `lib/redact.ts`, so password fields never reach the log
9. **BLE switch** (Settings page): `POST /api/ble/settings` → bridge `/settings` stores `enabled` and `mode` in `server/data/ble/settings.json`. `bleBridge.active` (configured and switched on) gates all BLE data and commands; `bleBridge.mode` is the panel's mode, else `ECOFLOW_BLE_MODE`
10. **Data access check** (device page, `POST /api/devices/:sn/probe`, `server/src/services/dataAccess.ts` + `dataAccessProbe.ts`): a device shared from another account is in the cloud list, but its quota is refused with code 1006 (`EcoflowApiError` in `lib/ecoflowApiError.ts`, surfaced as `quotaError` in the device list). The check reads the full quota, the named-fields POST and the device's MQTT topics (a `/#` wildcard when the broker allows it, else quota/status/get_reply) on its own client for 45 s, next to a supported online device. On MQTT it sends each full-quota request format (`FULL_QUOTA_REQUESTS` plus a REST-style `quotas` list) twice and credits get_reply answers by id. Read-only, one run at a time
11. **MQTT quota for REST-refused devices** (`server/src/services/mqttQuota.ts`): the shared DELTA Max is refused over REST (1006) but served over MQTT. `ecoflowApi.getServedQuota` marks such a device (REST retried every 10 min) and `mqttQuotas.want(sn)` makes `mqttService` subscribe to `/open/<account>/<sn>/quota` and `/get_reply`. The push is a fixed subset (SOC, limits, USB ports, `bmsMaster.inputWatts/outputWatts`; no AC power, no `bmsSlave*`), so `mqttService` also publishes a full-quota get to `/get` every 20 s, as the EcoFlow app does, and the snapshot arrives on `get_reply` (`data` or `data.quotaMap`). Both formats in `FULL_QUOTA_REQUESTS` go out until a reply with data shows which one works, then only that one. Gets go out at QoS 0 (a refused QoS 1 publish is resent on every reconnect) and stop after 3 disconnects right after one. Fields merge under REST key names and each counts as live for 2 min, so a snapshot that stops drops out instead of going stale; the quota is served while it carries `pd.soc`/`bmsMaster.soc`, with `dataSource` `mqtt`. The 10 s background collection stores it; messages are not stored one by one. `GET /api/devices/:sn/raw` (Download raw data in the Data access check card) returns the quota as read plus the latest raw MQTT message of each shape. MQTT reconnects forever, logging each new error once
12. **Bypass** (device page): AC in and AC out both above 0 with the battery within ±30 W shows BYPASS instead of charging/standby. Without `pd.wattsInSum/OutSum`, battery power comes from `bmsMaster.inputWatts - outputWatts`
13. **EcoFlow app channel** (Settings, `server/src/services/appChannel.ts` + `appChannelProtocol.ts`, `routes/appAccount.ts`): the Open API gives a shared DELTA Max only the 23-field push (the broker refuses `get_reply` to Open API keys; the device never answers a get), so the panel can sign in like the EcoFlow app: `POST <region>.ecoflow.com/auth/login` (password base64, sent once, never stored) → token + userId kept in `server/data/app-account.json` (0600, git-ignored) → `/iot-auth/app/certification` → app MQTT with client ID `ANDROID_<hex>_<userId>`, subscribing `/app/device/property/<sn>` and `/app/<userId>/<sn>/thing/property/get_reply` for the REST-refused devices (`mqttQuotas.wantedDevices()`) and publishing `latestQuotas` to `.../get` every 20 s (QoS 0). Data merges into `appQuotas` (a `MqttQuotaStore`); `ecoflowApi.getServedQuota` serves it over the Open API push with `dataSource` `app` (APP badge). A refused token stops with "sign in again" unless `ECOFLOW_APP_EMAIL`/`ECOFLOW_APP_PASSWORD` allow a fresh login; network failures retry every 5 min. `ECOFLOW_APP_API_BASE` only points tests at a mock. Read-only: no commands go over it
14. **Panel login** (`server/src/services/panelAuth.ts`, `routes/auth.ts`, `lib/totp.ts` + `password.ts` + `cookies.ts`; frontend `components/auth/AuthGate.tsx`, Settings → Panel login): one owner account (username, scrypt password hash, TOTP secret, last used TOTP step) in `server/data/auth.json` (0600, git-ignored); sessions in the `auth_sessions` table keyed by the SHA-256 of the `ecoflow_session` cookie (httpOnly, SameSite=Lax, Secure behind the HTTPS tunnel). Remember me = 30-day cookie and expiry sliding with use; otherwise a browser-session cookie and 12 idle hours. `app.use("/api", panelAuth.requireAuth)` sits after `/api/auth` and `/api/health`; `/ws` checks the cookie in `verifyClient`. First run creates the initial account `admin` from `panelAuthSeed.ts` (scrypt hash only; the password went to the owner privately; marker `server/data/auth-seeded`): it has no TOTP and `mustChange`, so `requireAuth` and `/ws` refuse it and the gate only offers `/api/auth/change/*` (new username other than admin, password, QR + first code). Settings can change the login later with the current password and code; a change signs out the other sessions. Deleting `auth.json` resets: with the seed marker present, the setup needs the one-time code printed in the log (and `server/data/auth-setup-code.txt`) or `ECOFLOW_SECRET_KEY`, then a code from the app; finishing it clears all sessions. Sign-in/setup are rate-limited per `CF-Connecting-IP`; `lib/redact.ts` masks `otp` too. The frontend shows the gate on any 401 (`auth:required` event from `api.ts`)
15. **Users and roles** (`lib/permissions.ts`, `routes/users.ts`, `panelAuth.ts`; frontend `hooks/usePanelAccess.ts`, Settings → Users in `components/settings/PanelUsersSettings.tsx`, invitation screen in `AuthGate.tsx`): the owner (auth.json, session `user_id` "owner") invites people by a one-time link `/invite#<token>` (7 days, only the SHA-256 kept) for a role, `viewer` or `operator`, and `devices` (serials, or null = all, also later ones). Invited users (`server/data/panel-users.json`, 0600, git-ignored; usernames unique ignoring case) sign in like the owner, with their own TOTP; `auth_sessions.user_id` ties a session to them. `requireAuth` sets `req.panelUser`; the devices router checks `:sn` (404 for other devices) and refuses every non-GET for viewers, `/api/resilience` reads need access to its device (`powerReserve` in the auth status) and writes the owner, and logs, automation, system, BLE, app account and users are `requireOwner`. `/ws` sends a device update only to sockets whose user may see that device and closes sockets of removed or signed-out users. Device commands log `by: <username>`. The frontend hides what the role cannot use; the server is what enforces it
