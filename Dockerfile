# Beacon — single image: builds the web UI, then runs the platform which serves
# web/dist + REST + WS on one port.
FROM node:22-slim AS build
WORKDIR /app

# Backend deps (better-sqlite3 ships prebuilt binaries for linux/x64 node 22).
COPY package.json package-lock.json* ./
RUN npm install --no-audit --no-fund

# Web deps + production build.
COPY web/package.json web/package-lock.json* ./web/
RUN cd web && npm install --no-audit --no-fund
COPY . .
RUN cd web && npm run build

FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=4319
ENV BEACON_DB=/data/beacon.db
COPY --from=build /app /app
RUN mkdir -p /data
VOLUME ["/data"]
EXPOSE 4319

# Container health: the platform exposes GET /api/health.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:4319/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Serves web/dist + API + WS on PORT.
CMD ["npm", "run", "platform"]
