# Ecoflow Dashboard — Express + better-sqlite3 (нативний модуль) + зібраний фронт.
# Збірка dist/ і server/dist/ робиться поза образом (npm run build), сюди
# потрапляє вже готовий результат — так само, як його запускав systemd.

FROM node:22-slim AS deps
WORKDIR /build
# better-sqlite3 компілюється з джерел, якщо немає prebuilt під цю версію Node
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*
COPY server/package.json server/package-lock.json* ./
RUN npm ci --omit=dev

FROM node:22-slim
WORKDIR /app

RUN apt-get update \
 && apt-get install -y --no-install-recommends tini curl \
 && rm -rf /var/lib/apt/lists/*

COPY --from=deps /build/node_modules ./server/node_modules
COPY server/package.json ./server/package.json
COPY server/dist ./server/dist
COPY dist ./dist

# БД лежить у server/data — монтується томом
RUN mkdir -p /app/server/data && chown -R node:node /app

USER node
WORKDIR /app/server

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "dist/index.js"]
