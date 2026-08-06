# EcoFlow API Control Dashboard

## Production installation and GitHub updates

The dashboard must run from a Git clone and keep `.env` plus `server/data/` outside version control. First deploy/update manually once:

```bash
git clone https://github.com/IvanSnezhok/ecoflow-dashboard.git
cd ecoflow-dashboard
cp .env.example .env # or create it with your EcoFlow keys
npm ci
npm ci --prefix server
npm run build
npm run build:backend
```

Serve the frontend `dist/` through a reverse proxy/static server and run `server/dist/index.js` under a supervisor. An example systemd unit is in `deploy/ecoflow-dashboard.service`.

### In-panel GitHub updates

This is deliberately disabled by default. The update endpoint can fetch code and restart the service, so do **not** expose it publicly without authentication/reverse-proxy protection.

Add these values to the server environment after the first manual deployment:

```dotenv
DASHBOARD_UPDATES_ENABLED=true
DASHBOARD_UPDATE_BRANCH=main
DASHBOARD_SYSTEMD_SERVICE=ecoflow-dashboard
```

Allow the service account a narrowly-scoped, passwordless restart command (`sudo -n systemctl restart ecoflow-dashboard`). The Settings page then fetches `origin/main`, pins the fetched commit, runs `npm ci`, builds frontend/backend, and restarts the configured service. Update output is recorded in `server/data/update.log`.

If an update build fails, inspect that log and repair the checkout manually; the updater never uses a shell or an interactive sudo prompt.

## Device support

Unknown EcoFlow products are intentionally read-only. Add a documented profile in `server/src/services/deviceProfiles.ts` with quota fixtures and command payload tests before exposing controls for that product.
