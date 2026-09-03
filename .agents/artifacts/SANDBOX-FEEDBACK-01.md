# Sandbox feedback 01 — Cursor workspace vs remote dind

**Audience:** workspace / platform team (remediation), not a product change.
**Repo:** `fancy-gol` (cellular automata simulator). Branch at writing: `phase/0-foundation`.
**Date:** 2026-09-03.
**Recorded by:** agent session on host `5a45f4c2adb0` (user `abc`, uid 1000).

This note collects sandbox quirks hit while building Phase 0, with enough topology and
reproduction that you can decide what is fixable. The product compose files are ordinary;
the bind-mount failure is environmental.

---

## 1. What we need from you

The one item that currently **blocks a named acceptance criterion** is **§3
(P0-I-3 bind-mount HMR)**. Everything else is friction, a false localhost, or a
footgun. If you only fix one thing, make the agent workspace visible to `sandbox-dind`
at the same absolute path the agent uses (`/workspace/...`).

---

## 2. Topology (as observed)

Two containers, two filesystems, one Docker API:

```
┌─ code-box host ─────────────────────────────────────────────────┐
│  /opt/docker/directStack/code-box/data/workspace  (ext4)        │
│       │ bind                                                       │
│       ▼                                                            │
│  ┌─ agent container (this shell) ─────────────────────────────┐ │
│  │  hostname 5a45f4c2adb0                                     │ │
│  │  /workspace/github/fancy-gol   ← the git worktree          │ │
│  │  Node v24.19.0, npm 11.17.0                                │ │
│  │  docker CLI 29.7.2                                         │ │
│  │  DOCKER_HOST=tcp://sandbox-dind:2376                       │ │
│  │  DOCKER_TLS_VERIFY=1  DOCKER_CERT_PATH=/certs/client       │ │
│  └────────────────────────────┬───────────────────────────────┘ │
│                               │ TLS Docker API                    │
│                               ▼                                   │
│  ┌─ sandbox-dind (Alpine 3.24, Docker 29.7.1, overlayfs) ─────┐ │
│  │  172.25.1.3                                                │ │
│  │  8 CPUs, ~63 GiB                                           │ │
│  │  volumes resolved HERE, not in the agent                   │ │
│  │  published ports listen HERE, not on the agent's lo        │ │
│  └────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

Confirmed facts:

| Item | Value |
|---|---|
| Agent is a container | `/.dockerenv` present |
| Agent workspace bind | host `/opt/docker/directStack/code-box/data/workspace` → `/workspace` |
| Docker context | `default` → `tcp://sandbox-dind:2376` |
| `getent hosts sandbox-dind` | `172.25.1.3` |
| Agent loopback | `127.0.0.1` is the **agent**, not dind |
| `gh` | authenticated as `zjgordon` (ssh + PAT) |
| Display | `DISPLAY=:1.0` (Playwright MCP can drive a real Chromium) |

Volume mounts on `docker run -v` / Compose `volumes:` are evaluated on **dind**.
A path that exists in the agent does not exist on dind unless you also mounted it
there.

---

## 3. Blocker — P0-I-3 bind-mount HMR

### Criterion

`docker compose -f docker/docker-compose.dev.yml up` must give working HMR **against
mounted sources**. Compose does the usual thing:

```yaml
volumes:
  - ../:/app                          # repo root → /app
  - node_modules:/app/node_modules    # keep the image's Linux modules
```

That file is `docker/docker-compose.dev.yml`. `../` resolves on the **client** to
`/workspace/github/fancy-gol`.

### What happens

1. Compose asks dind to bind-mount `/workspace/github/fancy-gol` into the container at `/app`.
2. That path does **not** contain the repo on dind. Docker creates an empty directory
   (as root) on dind's own filesystem and mounts it.
3. The empty mount **hides** the image's `COPY`'d `/app` (including `package.json`).
4. `CMD` (`npm run dev`) exits `ENOENT` on `/app/package.json`.

Reproduced 2026-09-03 after the production compose path was already green:

```text
$ docker run --rm -v /workspace/github/fancy-gol:/probe alpine:3.20 \
    sh -c 'ls /probe; test -f /probe/package.json && echo HAS || echo NO'
# → empty aside from leftover node_modules (see §3.4); NO package.json
```

The host-side path the agent itself is mounted from is also invisible to dind:

```text
$ docker run --rm -v /opt/docker/directStack/code-box/data/workspace/github/fancy-gol:/probe \
    alpine:3.20 sh -c 'test -f /probe/package.json && echo HAS || echo NO'
# → NO
```

dind's `/` **does** contain a `/workspace` and an
`/opt/docker/directStack/code-box/data/workspace`, but they are **dind-local
directories**, not the agent's worktree. After the failed compose run they look like:

```text
/workspace/github/fancy-gol/          # created by Docker for the missing bind
  node_modules/                       # empty leftover
```

This is not a defect in `docker-compose.dev.yml`. The same file is the correct
pattern on a machine where the daemon and the sources share a filesystem (a laptop,
GitHub-hosted `ubuntu-latest`, a VM with `/workspace` bind-mounted into dind).

### What we could still prove (labelled substitute)

`Dockerfile.dev` **without** the bind mount works:

- `docker run -p 5173:5173 -p 8080:8080` the dev image.
- Vite + Express come up.
- Playwright against `http://sandbox-dind:5173/` sees the Gosper gun.
- Editing `/app/src/client/index.html` **inside the container** triggered Vite
  `page reload index.html`; Playwright saw the new HUD label without a manual
  navigation.

That is in-container HMR, not “HMR against mounted sources.” P0-I-3 stays `[!]`
for that one box.

Production compose (`docker/docker-compose.yml`) has **no** source bind and is
green: image 241 MB, `uid=1000(node)`, `Health=healthy`, gun on `:8080`.

### Suggested remediations (in preference order)

1. **Share the worktree with dind at the same absolute path.** Bind the code-box
   host directory
   `/opt/docker/directStack/code-box/data/workspace`
   into `sandbox-dind` at `/workspace` (or bind that host path into both the agent
   and dind). Then Compose's resolved `../` → `/workspace/github/fancy-gol` is a
   real directory on the daemon and the named `node_modules` volume still does its
   job.
2. **Same path, different mechanism:** a named volume or virtiofs/NFS that both
   the agent and dind mount at `/workspace`.
3. **Daemon in the agent** (Docker socket of a daemon that already has `/workspace`),
   so `-v /workspace/...:/app` is local. Sibling dind-over-TCP is the whole problem.
4. If (1)–(3) are out of scope: **document the limitation** in the sandbox README
   and accept that `*:dev.yml` bind-mount ACs cannot be signed off here. Agents will
   keep proving images with `docker run` and no volumes. Please also **garbage-collect**
   the leftover `/workspace/github` tree Docker created on dind as root (§3.4).

A workaround we did **not** take, and should not have to: rewrite
`docker-compose.dev.yml` to skip the bind mount in this sandbox. That would make
the file lie about the product.

### Side effect of the failed bind

Docker created dind-local directories as root when the source path was missing.
They are still there (`/workspace/github/fancy-gol/node_modules` on dind, empty).
Harmless until someone later *does* share `/workspace` into dind and finds a
root-owned empty `node_modules` shadowing the repo. Worth cleaning when you
touch this.

---

## 4. Published ports land on dind, not the agent

`ports: ['8080:8080']` publishes on **sandbox-dind**. From the agent:

```text
curl http://127.0.0.1:8080/api/health   # connection refused (agent loopback)
curl http://sandbox-dind:8080/api/health  # works while the container is up
```

Playwright MCP in this workspace **can** navigate to `http://sandbox-dind:8080/`
and `http://sandbox-dind:5173/`. That is how P0-I-1 / P0-I-3 browser checks were
done.

**Ask:** either publish (or proxy) those ports onto the agent’s `127.0.0.1` as
well, or document “use `http://sandbox-dind:<port>`” next to the Docker docs.
Agents and humans both try localhost first. The CI `docker` job on
`ubuntu-latest` is unaffected (daemon and curl share a VM).

Related product fix already in-repo (not a sandbox bug, but **discovered
here**): Vite 8 403s any `Host` other than `localhost` / `127.0.0.1`. Hitting
the published port as `Host: sandbox-dind:5173` returned 403 until
`vite.config.ts` set `server.allowedHosts: true` (paired with existing
`server.host: true`). Local `npm run dev` via localhost never saw this.

---

## 5. Docker daemon was dark on the first P0-I-3 pass

The first implementation of P0-I-3 (commit `acc0ff2`) could not build or pull
**any** image. All three ACs were recorded `[!]` as “sandbox Docker daemon
unable to build or pull.” After a workspace restart the same
`DOCKER_HOST=tcp://sandbox-dind:2376` + TLS certs worked: compose build, compose
up, healthcheck, Playwright.

**Ask:** treat first-boot / post-restart dind readiness as a sandbox bug, not an
application one. A health probe the agent can see (`docker info` succeeding
before the first `docker build`) would have saved a false “blocked on 3/3.”

---

## 6. Other quirks (not P0-I-3, still worth fixing)

### 6.1 Node 24 here, Node 22 in `.nvmrc`, CI on 20 + 22

The agent runtime is **Node v24.19.0**. The repo pins `.nvmrc` to `22`. GitHub
Actions (P0-I-5) runs `verify` on **20 and 22**. Bench baseline
(`bench-baseline.json`) was recorded on this Node 24 host.

That is a silent skew: a sandbox-only pass of `npm run bench` / `npm run verify`
is not the CI matrix. Aligning the agent image to Node 22 (current LTS / `.nvmrc`)
would make local gates match CI.

### 6.2 `npm warn Unknown env config "devdir"`

Every `npm` invocation prints:

```text
npm warn Unknown env config "devdir". This will stop working in the next major version of npm.
```

The agent environment sets

```text
npm_config_devdir=/tmp/cursor-sandbox-cache/<hash>/node-gyp
NPM_CONFIG_CACHE=/tmp/cursor-sandbox-cache/<hash>/npm
```

npm 11 does not accept `devdir` as a config key via `npm_config_*`. Noise in
every `verify` log; will become a hard error on a future npm.

**Ask:** set node-gyp’s prefix in a way npm 11 documents, or drop the env var if
the cache path can be configured another way.

### 6.3 GitHub Actions cannot be watched from a branch push

`.github/workflows/ci.yml` runs on `push` to **`main` only**, plus `pull_request`.
Pushing `phase/0-foundation` does not start a workflow. The sandbox also has no
Actions UI. P0-I-5 therefore verified each job’s **commands** locally (including
the docker job against this dind) and labelled that GitHub-hosted orchestration
was not exercised.

`gh` auth works. Opening a PR would be enough to see the real workflow — if
that is intended, a one-liner in the sandbox notes would help. If the intent is
that agents must not open PRs, then “CI green” cannot be claimed from this
environment.

### 6.4 Compose project / image tag collision (not sandbox, recorded for completeness)

Both compose files live under `docker/`. Compose’s default project name was
`docker`, so both images tagged `docker-app:latest` and building the dev image
overwrote production. Fixed in-repo with explicit `name:` / `image:`
(`fancy-gol` / `fancy-gol-dev`, `fancy-gol:latest` / `fancy-gol:dev`). Mentioned
only because revalidation against this dind is how we caught it.

---

## 7. What already works (so you don’t over-fix)

- `docker compose -f docker/docker-compose.yml build && up` against this dind.
- Production image size, non-root, HEALTHCHECK.
- Playwright MCP → `http://sandbox-dind:<port>` (Chromium, `DISPLAY=:1.0`).
- `npm run verify`, `npm run bench`, in-process tests, `tsx` server spawn on
  agent `127.0.0.1` (those servers are **not** Docker).
- TLS to dind (`DOCKER_CERT_PATH=/certs/client`) once the daemon is up.
- `gh` + `git@github.com:zjgordon/fancy-gol.git`.

---

## 8. Impact on remaining work

| Work | Impact if §3 is not fixed |
|---|---|
| Close P0-I-3 | Stays `[!]` on bind-mount HMR. Phase 0 DoD “`docker compose up`” is already true for **prod** compose. |
| Phase 1 Playwright against `docker-compose.dev.yml` | Same empty `/app`. Will need the same labelled substitute or a real shared mount. |
| Agents rewriting compose to “work here” | Please don’t. Keep the product file honest. |

---

## 9. Reproduction checklist for the platform team

From an agent shell in this workspace:

```bash
echo "DOCKER_HOST=$DOCKER_HOST"          # expect tcp://sandbox-dind:2376
getent hosts sandbox-dind
docker info >/dev/null && echo daemon-up

# The smoking gun:
docker run --rm -v /workspace/github/fancy-gol:/probe alpine:3.20 \
  ls -la /probe
# Expect today: empty / leftover node_modules, no package.json.
# Success looks like: package.json, src/, docker/, …

# After a shared mount, this should also be identical to the agent worktree:
docker run --rm -v /workspace/github/fancy-gol:/probe alpine:3.20 \
  grep -m1 '"name"' /probe/package.json
```

Then:

```bash
docker compose -f docker/docker-compose.dev.yml up --build
# Success: Vite “Local:” in logs, curl http://sandbox-dind:5173/ returns index.html,
# edit src/client/index.html on the **agent** worktree, Vite reloads without rebuild.
```
