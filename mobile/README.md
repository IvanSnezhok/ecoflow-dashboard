# EcoFlow Panel: phone app

A native iOS/Android app (Expo, React Native) for the panel in this repository. It signs
in to your own panel and shows what the panel shows: stations, live power, controls,
battery packs, history charts and the grid/outage status.

History is recorded by the panel's server around the clock; the app reads it from there,
so charts are complete even when the phone was off.

## What it covers (stage 1)

- Sign-in with the panel account: username, password and authenticator code. The session
  token is kept in the device keychain; the password is never stored.
- Stations list with live updates (the panel's WebSocket) and a 10 s poll.
- Station page: level, power in/out, AC output switch, charge limits, charging power,
  battery packs, history (1 h, 24 h, 7 d, 30 d), device issues.
- Grid tab: grid state, battery reserve forecast, outage schedule, last 7 days.
- Roles: a viewer sees the controls disabled; the server refuses the commands anyway.

Account setup, invitations, users, automation rules, logs and panel settings stay in the
panel in a browser.

## Run it

```bash
cd mobile
npm install
npx expo start          # scan the QR code with a development build
npx expo start --web    # or check it in a browser (set CORS_ORIGIN on the server to this origin)
```

The app uses native modules (keychain), so on a phone it needs a build, not Expo Go:

```bash
npx eas-cli@latest login
npx eas-cli@latest build --profile preview --platform android   # an .apk to install directly
npx eas-cli@latest build --profile preview --platform ios       # needs an Apple Developer account
```

The panel address must be HTTPS (the tunnel's address); iOS and Android refuse plain HTTP.

## Checks

```bash
npx tsc --noEmit
npx expo lint
npx expo export --platform ios --platform android   # bundles without a native build
```

## How it is put together

- `src/app/`: screens (Expo Router). `_layout.tsx` guards the routes by session state.
- `src/lib/session.ts`: sign-in, the saved session, sign-out. `api.ts`: requests with the
  session token as `Authorization: Bearer`. `live.ts`: the `/ws` client; the token goes
  as a WebSocket subprotocol (`ecoflow-session`).
- Shared with the web panel, imported as `@panel/...` from `../src`: the types, the device
  store (`stores/deviceStore.ts`), `lib/deviceStatus.ts`, `lib/liveUpdate.ts`,
  `lib/chartData.ts`, `components/charts/chartStats.ts`, `utils/errorCodes.ts`. Keep those
  files free of browser and React DOM code. `metro.config.js` makes Metro read them and
  resolve their packages from `mobile/node_modules` only.
- Server side: `client: "app"` in a sign-in request returns the session id as `token`
  instead of a cookie (`server/src/services/panelAuth.ts`, `lib/cookies.ts`).
