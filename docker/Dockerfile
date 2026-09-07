# syntax=docker/dockerfile:1
#
# P0-I-3 — production image. Three stages: install once (deps), compile the client (Vite) and
# server (tsc) against the full dependency tree (build), then a lean runtime stage that installs
# only the "No Bloat" runtime surface (express + ws) and copies in nothing but the compiled
# output. Built from the repo root as build context — `docker build -f docker/Dockerfile .` or
# `docker compose -f docker/docker-compose.yml up` (its `context: ..` does this for you).

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build --chown=node:node /app/dist ./dist
# P1-G-2: `server/routes/patterns.ts` reads these at startup from the repo-root `patterns/`
# directory (three levels up from `dist/server/routes/`, same relative depth as the uncompiled
# `src/server/routes/` — see that file's own `DEFAULT_PATTERNS_DIR` note), so the runtime image
# needs the directory itself, not just the compiled route that reads it.
COPY --from=build --chown=node:node /app/patterns ./patterns

# `data/` (ADR-002: "file-backed JSON on a mounted volume") — created and owned by `node` here so
# it's writable under `USER node` below whether or not a volume ends up mounted over it. Docker
# seeds a named volume's first mount from whatever the image already has at that path, so getting
# the ownership right in the image is what makes an *empty* named volume work too, not just a
# host bind mount that already has the right owner.
RUN mkdir -p /app/data/sessions && chown -R node:node /app/data

# node:22-alpine already ships a non-root `node` user (uid 1000) — no need to create one.
USER node

EXPOSE 8080

# No curl/wget in the image (that's an extra OS package for one healthcheck) — Node 22 has a
# built-in `fetch`, so the check costs nothing beyond the runtime we already ship.
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/api/health').then((r)=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

# Exec form, invoking node directly (not `npm start`) so SIGTERM from `docker stop` reaches our
# process — and its graceful-shutdown handling (P0-I-2) — directly as PID 1, not filtered through
# npm's own child-process wrapping.
CMD ["node", "dist/server/index.js"]
