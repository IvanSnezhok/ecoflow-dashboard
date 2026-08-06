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

### In-panel updates for Docker deployments

A container has no `.git`, no build toolchain and no way to restart itself, so the
mode above cannot work there. Set `DASHBOARD_UPDATE_MODE=host-agent` instead: the
container writes an update request into the `server/data` volume and a host-side
systemd unit — which owns the worktree, the toolchain and docker — does the work.
The container gets no access to `docker.sock` and no sudo rights.

```dotenv
DASHBOARD_UPDATES_ENABLED=true
DASHBOARD_UPDATE_MODE=host-agent
DASHBOARD_UPDATE_BRANCH=main
```

Install the agent on the host (adjust `ECOFLOW_PROJECT_ROOT` in the unit if the
checkout lives elsewhere):

```bash
cp deploy/ecoflow-updater.path deploy/ecoflow-updater.service ~/.config/systemd/user/
chmod +x deploy/host-updater.sh
systemctl --user daemon-reload
systemctl --user enable --now ecoflow-updater.path
loginctl enable-linger "$USER"   # so the watcher survives logout and reboot
```

`deploy/host-updater.sh` fetches, resets to the pinned commit, reinstalls locked
dependencies, rebuilds frontend and backend, rebuilds the image and recreates the
container. It writes progress to `server/data/update-status.json`, which the panel
polls — this is what lets the Settings page still report `completed` after the
container it was talking to has been replaced. It also stamps
`server/data/version.json` so the container can report its own revision.

**The telemetry database must not be tracked by git.** `git reset --hard` deletes
tracked files that are absent from the target commit, so a tracked
`server/data/ecoflow.db` would be destroyed on the first update. The agent checks
this and refuses to run; if it does, fix the checkout once:

```bash
git rm --cached server/data/ecoflow.db server/data/ecoflow.db-shm server/data/ecoflow.db-wal
```

## Device support

Unknown EcoFlow products are intentionally read-only. Add a documented profile in `server/src/services/deviceProfiles.ts` with quota fixtures and command payload tests before exposing controls for that product.
