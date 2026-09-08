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

## Telemetry database

`server/data/ecoflow.db` is a SQLite database in WAL mode. Almost all of it is one
column: `device_states.raw_data`, the flat EcoFlow quota snapshot. Roughly 242 keys
repeat verbatim on every row at ~7.4 KB per row, which put the file at **30.3 GiB
across 4.04M rows**.

Those rows are stored compressed in `device_states.raw_data_z`: a one-byte format
flag (`0x01`) followed by a zstd frame at level 3, compressed against a dictionary
trained on real rows. Measured on live data this is **0.071–0.078x per row**, so the
table lands at roughly **1–2 GiB (-93…-97%)**. Nothing is dropped, downsampled or
key-slimmed — every row decompresses back to byte-identical JSON.

`server/src/lib/rawDataCodec.ts` owns the format. Writes go to both columns while the
migration is in flight, and reads prefer `raw_data_z` and fall back to `raw_data`, so
an older build of the server keeps working against a migrated database.

### The dictionary

`server/data/zstd.dict` (112 KB) is tracked in git and **required** — a missing
dictionary makes every `raw_data_z` row unreadable, so the server refuses to start
without one. It is looked for in this order:

1. `$ECOFLOW_ZSTD_DICT`
2. `server/data/zstd.dict`
3. `server/dict/zstd.dict` — the copy baked into the Docker image, which survives an
   empty `server/data` volume

Retrain once a year, or after an EcoFlow firmware change alters the quota key set. A
stale dictionary never breaks anything; compression just degrades by roughly 2–3x.
Node can *use* zstd dictionaries but not train them, so that one step needs python3:

```bash
python3 -m pip install zstandard
node server/scripts/trainDictionary.mjs            # --db/--out/--rows/--size to override
```

Rows already written keep decoding only with the dictionary they were written with,
so replace the file only before a database has been migrated.

### Migrating an existing database

```bash
npm run build:backend
node server/dist/scripts/migrateRawData.js --db server/data/ecoflow.db            # backfill
node server/dist/scripts/migrateRawData.js --db server/data/ecoflow.db --verify   # check
```

The backfill only touches rows where `raw_data_z IS NULL AND raw_data IS NOT NULL`,
so an interrupted run is resumed by re-running the same command. It commits every
5000 rows and prints `id`, `rows_migrated`, `eta_seconds` and `file_size_gib` as it
goes. `--verify` asserts `COUNT(raw_data) = COUNT(raw_data_z)` and decodes 100
randomly probed rows back to an equal object.

`--final` drops the legacy `raw_data` column and VACUUMs — without the VACUUM the
file does not actually shrink. It refuses to run unless `--verify` passed in the same
invocation. **VACUUM needs free disk roughly equal to the new database size while it
runs**, and it rewrites the whole file, so leave it until the migration has been
running in production long enough to trust. Use `--no-vacuum` to drop the column
without reclaiming space yet.

### WAL and long reads

A read of the live database that returns too much at once fails with `database
disk image is malformed`. **The file is not corrupt.** The database is in WAL
mode and the writer checkpoints continuously; a reader that holds its snapshot
long enough for the WAL to be recycled underneath it loses that snapshot, and
SQLite reports the loss as a malformed image. Running the identical statement
again succeeds.

The threshold measured on this database is roughly **150K rows in one `fetchall`**
on `device_states`, which is where a single result set gets large enough (~7.4 KB
per row from `raw_data`) for the read to stay open past a checkpoint. Two things
make it worse and are avoided everywhere: `ORDER BY id DESC`, and long scans
driven by `idx_device_states_device_timestamp` rather than the primary key.

- **Application queries are safe.** Every read the server issues is bounded — the
  history ranges are capped at `LIMIT 100000`, logs and error lists paginate, and
  the single-state reads are `LIMIT 1`. None of them can reach the threshold.
- **Maintenance scripts scan forward by primary key**, committing in batches of
  5000 (`migrateRawData`) or 500 (`makeTestDb`), so no single result set is
  anywhere near the limit.
- **Every such read is additionally wrapped in `withMalformedRetry`**
  (`server/src/lib/sqliteRetry.ts`, mirrored for the plain-node scripts in
  `scripts/lib/sqliteRetry.mjs`): on a malformed-image error it waits 2s and
  retries the same statement, up to 3 times. Anything that is not a malformed
  image is never retried.
- If a batch still fails after 3 retries, `migrateRawData` **aborts non-zero** and
  prints the `id` it stopped at. The migration is idempotent, so the fix is to
  stop the writer and re-run the same command; it resumes from that point.

`npm run test:migrate` covers both halves of this: the helper's retry/give-up
behaviour, and a 5000-row copy migrated with `--verify` end to end.

### Measuring read speed

`scripts/dbSpeedCheck.mjs` opens the database read-only and times the 1-day,
7-day and 30-day history windows, printing rows, ms and MB for two reads per
window: `history` (the columns `/history` selects — what the UI pays) and `raw`
(the raw payload columns, which is what the migration shrinks).

```bash
node scripts/dbSpeedCheck.mjs                              # live database, read-only
node scripts/dbSpeedCheck.mjs --db /tmp/eco_test.db        # a copy from makeTestDb
```

Windows end at the newest row by default, so it works unchanged on a small copy;
`--anchor now` uses the wall clock instead. It also prints `EXPLAIN QUERY PLAN`
for the range read, which must say `SEARCH device_states USING INDEX
idx_device_states_device_timestamp` — a `SCAN` there would mean the index is not
being used.

On the live database before the migration, a 30-day window for device 122 read
129,616 rows in 2,678 ms because it pulled ~490 MB of `raw_data` (~7.4 KB per
row); 1 day was 23 ms and 7 days 89 ms. The blobs are ~0.071–0.080x the size, so
the same window moves ~35 MB after `--final` — measured on a 5000-row copy the
raw read went from 17.6 MB / 21 ms to 1.0 MB / 4 ms.

### Rollout

Steps 2–6 are host commands and are not run from a development checkout.

```bash
# 1. Back up. The WAL holds recent pages, so fold it in first, then copy.
node scripts/checkpointDb.mjs server/data/ecoflow.db
cp server/data/ecoflow.db server/data/ecoflow.db.backup-$(date +%F)

# 2. Stop the writer.
docker stop ecoflow-dashboard

# 3. Backfill (~15-30 min for 4M rows; prints progress).
node server/dist/scripts/migrateRawData.js --db server/data/ecoflow.db

# 4. Verify.
node server/dist/scripts/migrateRawData.js --db server/data/ecoflow.db --verify

# 5. Restart and smoke-check the dashboard.
docker start ecoflow-dashboard

# 6. Later, once production has run on the compressed column for a while:
node server/dist/scripts/migrateRawData.js --db server/data/ecoflow.db --verify --final
```

To roll back before step 6, stop the container and restore the backup; `raw_data` is
still populated, so an older build reads it directly.

### Tests

```bash
npm run test:codec    # roundtrip on a real 242-key row, corrupt-blob rejection
npm run test:migrate  # malformed-image retry helper + migration on a 5000-row copy
npm run test:smoke    # /history + /errors return identical JSON before/after/-final
```

`npm run test:smoke` builds its own throwaway copy of the live database with
`scripts/makeTestDb.mjs` (`--rows 5000` for a bigger one) and never writes to
`server/data/ecoflow.db`.

## Device support

Unknown EcoFlow products are intentionally read-only. Add a documented profile in `server/src/services/deviceProfiles.ts` with quota fixtures and command payload tests before exposing controls for that product.

## Kyiv outage resilience

The **Power reserve** page reads planned, probable and emergency outage states from
YASNO's public web-service endpoints. Select the EcoFlow device and Kyiv distribution
operator, then search for the street and house to resolve the outage group automatically
(manual group selection remains available as a fallback). Define the daily load profile. The forecast uses
the current SOC of the DELTA Pro and every detected extra battery, the configured
reserve SOC and inverter efficiency.

AC automation has a separate opt-in switch. It turns AC on only inside the configured
warning window (or during an active/emergency state), refuses to do so below the
minimum SOC, and pauses commands when schedule data is stale. It turns AC off after
the recovery delay only when this automation was the component that turned it on.
YASNO schedules remain advisory and can change without notice.
