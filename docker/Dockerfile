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
