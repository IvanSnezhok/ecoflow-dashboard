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
2. **Extra batteries** appear only when `bmsSlave1.soc` or `bmsSlave2.soc` exists in API response
3. **Controls** use optimistic UI updates via `updateDeviceState` in Zustand store
4. **Logs page** filters by type: API_CALL, COMMAND, MQTT
