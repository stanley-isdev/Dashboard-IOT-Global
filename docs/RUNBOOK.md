# Deployment runbook - Windows Server (IIS + NSSM)

The dashboard is two pieces that must end up on **one origin**:

| Piece | What it is | Who serves it |
| --- | --- | --- |
| Frontend | Vite SPA built to `dist/` | IIS, as a plain static site |
| Backend | Fastify (`server/`), listening on `127.0.0.1:4000` | Windows Service via NSSM |

`public/config/runtime-config.json` ships `apiBaseUrl: "/api/v1"`, so the
browser only ever calls its own origin and IIS reverse-proxies `/api` to the
service. That is why the backend's `CORS_ORIGIN` is never exercised in a normal
deploy - keep it correct anyway, it is the only thing standing between you and a
silent failure the day someone splits the two.

Two things a fresh `git clone` does **not** give you, both gitignored on
purpose: `dist/` (build it) and `server/.env` (it holds real InfluxDB
credentials). Neither is a mistake to fix by committing them.

---

## 0. Prerequisites on the server

Check each one before touching anything. Run PowerShell **as Administrator**.

```powershell
node -v      # must be >= 20.19 (package.json engines)
npm -v
```

If Node is missing, install the current **LTS x64 MSI** from nodejs.org. The
installer puts `node.exe` on the machine PATH, which is what the service needs -
a per-user install (nvm, a zip unpacked into a profile folder) is invisible to
`LocalSystem`, and the service then fails to start with a path error that says
nothing about why.

IIS features (Server Manager, Add Roles and Features, or):

```powershell
Enable-WindowsOptionalFeature -Online -All -FeatureName `
  IIS-WebServerRole, IIS-WebServer, IIS-StaticContent, IIS-DefaultDocument, `
  IIS-HttpErrors, IIS-HttpLogging, IIS-RequestFiltering
```

Then two **separate downloads** from microsoft.com - neither ships with IIS, and
`web.config` needs both:

1. **URL Rewrite 2.1**
2. **Application Request Routing 3.0** (ARR)

And **NSSM** from https://nssm.cc/download - unzip `win64\nssm.exe` into
`C:\tools\nssm\`. It is a single exe with no dependencies.

> **Path with spaces.** Everything below works either way, but a checkout under
> a space-free path (`C:\apps\Dashboard-IOT-Global`) avoids a class of quoting
> bug in NSSM and in scheduled tasks. Worth moving the clone now if it currently
> sits somewhere like `C:\Users\...\My Documents\`.

---

## 1. Install dependencies

From the checkout root:

```powershell
npm ci
```

**Not `npm ci --omit=dev`.** The service runs the TypeScript sources through
`tsx`, which is a devDependency, and the two workspace packages
(`@dashboard/contract`, `@dashboard/domain-shared`) are consumed as raw TS via
their `main: ./src/index.ts`. Omitting dev dependencies produces a tree that
installs cleanly and then cannot boot.

---

## 2. Create `server/.env`

```powershell
Copy-Item server\.env.example server\.env
notepad server\.env
```

Fill in at minimum:

| Key | Value | Why |
| --- | --- | --- |
| `PORT` | `4000` | Must match the proxy target in `public/web.config`. Change one, change both. |
| `CORS_ORIGIN` | `http://<server-hostname>` | The origin IIS serves the dashboard on, not `localhost:5173`. |
| `INFLUX_URL` | `http://<host>:8181` | **The port is mandatory** - InfluxDB 3 answers on 8181 and nothing else. No trailing slash. |
| `INFLUX_DATABASE`, `INFLUX_TOKEN` | from the InfluxDB instance | Leave blank and the app still boots: `/meta` and `/healthz` answer, the poller idles, and every source honestly reports `down`. Useful as a first smoke test. |

`server/src/config/env.ts` validates this with zod and **refuses to boot** on
malformed values, rather than starting up pointed at the wrong instance. If the
service will not start, `logs\api-err.log` names the offending key.

---

## 3. Build the frontend

```powershell
npm run build
```

Output lands in `dist/`, including `web.config` (copied from `public/`).

Optional but recommended before a first deploy - `verify` is the full gate, and
`check:offline` is the one that proves nothing in `dist/` reaches a public CDN,
which the plant network has no route to:

```powershell
npm run verify
npm run check:offline
```

### Site-specific config

`dist/config/runtime-config.json` is the one file meant to be edited per site -
but **edit `public/config/runtime-config.json` and rebuild** instead, otherwise
the next `npm run build` throws the change away. Per-site values:

- `apiBaseUrl` - leave at `/api/v1` for this topology.
- `grafanaBaseUrl` - the Grafana instance the drill-down links open.
- `defaultLang`, `defaultTheme`, `kioskDefault`, `refreshMs`.
- `referenceTimezone` **must** match `REFERENCE_TIMEZONE` in `server/.env`
  (default `Asia/Bangkok` on both). A mismatch shifts every calendar-day window
  by the offset, quietly.
- `refreshMs` (5000) must stay **above** `SNAPSHOT_INTERVAL_MS` (2000). The UI
  calls the feed frozen after three identical payloads, so a client outrunning
  the poller false-alarms on a healthy system.

`web.config` serves this file `no-cache`. That is load-bearing: a cached
`runtime-config.json` means editing `apiBaseUrl` does nothing and the dashboard
keeps calling the old address.

---

## 4. Install the backend as a Windows Service

```powershell
.\scripts\install-service.ps1 -Nssm C:\tools\nssm\nssm.exe
```

Idempotent - re-run it after a `git pull` or an `.env` change. It checks Node's
version, that `npm ci` has run, and that `server/.env` exists before registering
anything, then configures auto-start, restart-on-crash, and rotating logs under
`logs\`.

Verify:

```powershell
Get-Service DashboardIotApi
Invoke-RestMethod http://127.0.0.1:4000/healthz      # -> status = ok
Invoke-RestMethod http://127.0.0.1:4000/api/v1/meta  # -> sources, each with its real state
```

`/api/v1/meta` is the honest one: it reports each source's actual state, so a
`down` InfluxDB shows up here rather than as an empty dashboard later.

Day to day:

```powershell
nssm restart DashboardIotApi
nssm stop DashboardIotApi
Get-Content logs\api-err.log -Tail 50 -Wait
```

---

## 5. Point IIS at `dist/`

In IIS Manager:

1. **Sites, Add Website**
   - Site name: `Dashboard-IOT-Global`
   - Physical path: `<checkout>\dist`
   - Binding: http, port 80 (or your port), hostname optional.
2. **Enable the ARR proxy** - select the **server** node (not the site),
   *Application Request Routing Cache*, *Server Proxy Settings*, tick
   **Enable proxy**, Apply.

   Skip this and the rewrite rule in `web.config` returns **404.0** on every
   `/api` call. The dashboard renders, the board stays empty, and nothing in the
   IIS log says "the proxy is off". It is the most common failure here.
3. If the checkout sits outside `C:\inetpub`, grant the app pool identity
   (`IIS AppPool\Dashboard-IOT-Global`) read + execute on `dist\`.

Firewall, if clients are on other machines:

```powershell
New-NetFirewallRule -DisplayName "Dashboard IoT Global (HTTP)" `
  -Direction Inbound -Protocol TCP -LocalPort 80 -Action Allow
```

Do **not** open 4000. The API is meant to be reachable only through IIS - it has
no authentication yet (`server/src/plugins/auth.ts` is a documented no-op
placeholder for D-08/D-09), so anything that can reach 4000 directly reads the
whole fleet.

---

## 6. Verify end to end

From the server:

```powershell
Invoke-WebRequest http://localhost/                 # 200, index.html
Invoke-RestMethod  http://localhost/healthz         # proxied -> status ok
Invoke-RestMethod  http://localhost/api/v1/meta     # proxied -> sources
(Invoke-WebRequest http://localhost/config/runtime-config.json).Headers['Cache-Control']
#   ^ must say no-cache
```

From a client machine, browse to `http://<server>/`, then confirm a deep link
survives a refresh (e.g. `http://<server>/companies/<code>`). That exercises the
SPA fallback rule - the other thing that only ever breaks on reload.

---

## Redeploying after a code change

```powershell
git pull
npm ci
npm run build
nssm restart DashboardIotApi
```

IIS needs no restart; it serves `dist/` off disk. Only the backend is a process.
If `scripts/install-service.ps1` itself changed, re-run it instead of
`nssm restart`.

---

## Troubleshooting

| Symptom | Cause |
| --- | --- |
| Board renders, every tile empty, `/api/v1/...` 404s from IIS | ARR proxy not enabled (step 5.2). |
| `/api` returns the dashboard's own HTML | Rewrite rule order broken - the API rule must precede the SPA fallback in `web.config`. |
| 502 or connection refused on `/api` | Service not running, or `PORT` in `server/.env` no longer matches `web.config`. Check `Get-Service DashboardIotApi`. |
| Service starts then stops immediately | zod rejected `server/.env`. `logs\api-err.log` names the key. |
| Service will not start, no log at all | `node.exe` not on the machine PATH (per-user Node install). |
| Deep links 404 on refresh but work when clicked | URL Rewrite module not installed. |
| Changed `apiBaseUrl`, nothing happened | `runtime-config.json` served from cache, or edited in `dist/` and then overwritten by a rebuild. |
| Every source `down` in `/api/v1/meta` | `INFLUX_URL` missing its `:8181` port, or credentials blank. |
| 500.19 at site start | A `mimeMap` in `web.config` duplicates one IIS already defines - drop that remove/add pair. |
