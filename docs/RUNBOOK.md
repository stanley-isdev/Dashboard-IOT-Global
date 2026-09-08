# Deployment runbook - Windows Server

The dashboard deploys as **one process on one port**: the Fastify server in
`server/` answers `/api/v1` and also serves the built frontend from `dist/`.
NSSM makes it a Windows Service. There is no IIS, no reverse proxy, and nothing
to keep in step between two systems.

That shape is not a shortcut, it is what the frontend already assumes.
`public/config/runtime-config.json` ships `apiBaseUrl: "/api/v1"` - a
same-origin path - so the page and the API have to share an origin. Serving both
from one process is the way to do that with no second system to install. It is
also what the Grafana on the same host does: one binary, its own UI and its own
API, its own port, registered as a service through NSSM.

> **The other topology.** `docs/deploy/web.config` is a complete IIS
> configuration - reverse proxy, SPA fallback, cache rules - for putting IIS in
> front instead. Reach for it when you need Windows Authentication or a TLS
> certificate, which IIS provides without application code. Its header says how
> to switch. Nothing reads it today.

Two things a fresh `git clone` does **not** give you, both gitignored on
purpose: `dist/` (build it) and `server/.env` (it holds real InfluxDB
credentials). Neither is a mistake to fix by committing them.

---

## The worked example

The commands below use the current deployment's values. Substitute your own.

| | |
| --- | --- |
| Checkout | `C:\dev\Dashboard_IOT_Global\Dashboard-IOT-Global` |
| Dashboard URL | `http://10.200.129.66:8080` |
| Service name | `DashboardIotApi` |
| Grafana on the same host (do not touch) | `http://10.200.129.66:3000` |

---

## 0. Prerequisites

Run PowerShell **as Administrator**.

```powershell
node -v      # must be >= 20.19 (package.json engines)
npm -v
```

If Node is missing, install the current **LTS x64 MSI** from nodejs.org. The
installer puts `node.exe` on the machine PATH, which is what the service needs -
a per-user install (nvm, a zip unpacked into a profile folder) is invisible to
`LocalSystem`, and the service then fails to start with a path error that says
nothing about why.

**NSSM** from <https://nssm.cc/download> - unzip `win64\nssm.exe` into
`C:\tools\nssm\`:

```powershell
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
New-Item -ItemType Directory -Force C:\tools\nssm | Out-Null
Invoke-WebRequest https://nssm.cc/release/nssm-2.24.zip -OutFile $env:TEMP\nssm.zip -UseBasicParsing
Expand-Archive $env:TEMP\nssm.zip -DestinationPath $env:TEMP\nssm -Force
Copy-Item $env:TEMP\nssm\nssm-2.24\win64\nssm.exe C:\tools\nssm\ -Force
C:\tools\nssm\nssm.exe version
```

> Grafana's Windows installer ships its own copy of NSSM, and you will find it
> at `C:\Program Files\GrafanaLabs\svc-<version>\nssm.exe`. **Do not point the
> service at that one.** The version is in the path, so the next Grafana upgrade
> moves it and takes this dashboard down - a failure whose cause is nowhere near
> its symptom.

---

## 1. Install dependencies

From the checkout root:

```powershell
git pull
npm ci
```

**In that order, and not `npm install`.** Code first, then the dependencies that
match it. `npm install` may rewrite `package-lock.json`, which both drifts the
server off the tree that was tested and leaves a modified file that blocks the
next `git pull`.

**Not `npm ci --omit=dev`** either. The service runs the TypeScript sources
through `tsx`, a devDependency, and the two workspace packages
(`@dashboard/contract`, `@dashboard/domain-shared`) are consumed as raw TS via
their `main: ./src/index.ts`. Omitting dev dependencies produces a tree that
installs cleanly and then cannot boot.

If `npm ci` fails with `EPERM ... unlink ... esbuild.exe`, something is holding
a file it needs to delete. On a server that already has the service installed,
that something is almost always the service itself - stop it first, and see
Redeploying below, which is written around exactly this. Before the first
install it is usually a server left running in a terminal. Either way, find it
and stop only what belongs to this project; other things on this host run node
too:

```powershell
Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Select-Object ProcessId, CommandLine | Format-List
```

---

## 2. Fill in `server/.env`

```powershell
Copy-Item server\.env.example server\.env
notepad server\.env
```

| Key | Value for the worked example | Why |
| --- | --- | --- |
| `PORT` | `8080` | The port the whole dashboard answers on - page and API together. This is the port people type. |
| `STATIC_DIR` | `C:\dev\Dashboard_IOT_Global\Dashboard-IOT-Global\dist` | **Absolute path.** The service runs with `server\` as its working directory, so a relative path resolves somewhere you did not mean. Blank means API-only, and every page 404s. |
| `CORS_ORIGIN` | `http://10.200.129.66:8080` | Never exercised in this topology - the browser is same-origin - but it must name **one** origin. `*` is not a wider setting, it is a broken one: the server registers CORS with `credentials: true`, and browsers reject `Allow-Origin: *` paired with credentials. |
| `INFLUX_URL` | `http://10.200.129.61:8181` | **The port is mandatory** - InfluxDB 3 answers on 8181 and nothing else. No trailing slash. |
| `INFLUX_DATABASE`, `INFLUX_TOKEN` | from the InfluxDB instance | Leave every InfluxDB key blank and the server still boots: `/healthz` and `/api/v1/meta` answer, the poller idles, and every source reports `down`. That is a useful first smoke test. |

`server/src/config/env.ts` validates this with zod and **refuses to boot** on
malformed values rather than starting up pointed at the wrong instance. If the
service will not start, `logs\api-err.log` names the offending key.

---

## 3. Build the frontend

```powershell
npm run build
```

Output lands in `dist/` - the folder `STATIC_DIR` points at. Confirm:

```powershell
Test-Path dist\index.html
Test-Path dist\config\runtime-config.json
```

Recommended before a first deploy. `verify` is the full gate; `check:offline`
proves nothing in `dist/` reaches a public CDN, which the plant network has no
route to:

```powershell
npm run verify
npm run check:offline
```

### Site-specific config

`dist/config/runtime-config.json` is the one file meant to be edited per site -
but **edit `public/config/runtime-config.json` and rebuild** instead, otherwise
the next `npm run build` throws the change away. Per-site values:

- `apiBaseUrl` - leave at `/api/v1`. It is what makes the same-origin topology work.
- `grafanaBaseUrl` - the Grafana instance the drill-down links open.
- `defaultLang`, `defaultTheme`, `kioskDefault`.
- `referenceTimezone` **must** match `REFERENCE_TIMEZONE` in `server/.env`
  (default `Asia/Bangkok` on both). A mismatch shifts every calendar-day window
  by the offset, quietly.
- `refreshMs` (5000) must stay **above** `SNAPSHOT_INTERVAL_MS` (2000). The UI
  calls the feed frozen after three identical payloads, so a client outrunning
  the poller false-alarms on a healthy system.

The server sends this file `no-cache` (`server/src/plugins/staticSite.ts`). That
is load-bearing: cached, editing `apiBaseUrl` does nothing and the kiosk keeps
calling the old address.

---

## 4. Install the Windows Service

```powershell
.\scripts\install-service.ps1 -Nssm C:\tools\nssm\nssm.exe
```

Idempotent - re-run it after a `git pull` or an `.env` change. It checks Node's
version, that `npm ci` has run, that `server/.env` exists, and that `STATIC_DIR`
names a folder that has actually been built, before registering anything. Then
it configures auto-start, restart-on-crash, and rotating logs under `logs\`.

Verify - after giving it a few seconds, for the reason under Redeploying:

```powershell
Start-Sleep -Seconds 10
Get-Service DashboardIotApi
Invoke-RestMethod http://127.0.0.1:8080/healthz      # -> status = ok
Invoke-RestMethod http://127.0.0.1:8080/api/v1/meta  # -> sources, each with its real state
```

`/api/v1/meta` is the honest one: it reports each source's actual state, so a
`down` InfluxDB shows up here rather than as an empty dashboard later.

Day to day:

```powershell
C:\tools\nssm\nssm.exe restart DashboardIotApi
C:\tools\nssm\nssm.exe stop DashboardIotApi
Get-Content logs\api-err.log -Tail 50 -Wait
```

---

## 5. Open the firewall

Only if clients are on other machines:

```powershell
New-NetFirewallRule -DisplayName "Dashboard IoT Global" `
  -Direction Inbound -Protocol TCP -LocalPort 8080 -Action Allow
```

One port, because there is only one process. Note there is **no authentication**
on this yet - `server/src/plugins/auth.ts` is a documented no-op placeholder for
D-08/D-09 - so anything that can reach the port reads the whole fleet. Keep the
rule scoped to the plant network.

---

## 6. Verify end to end

From the server:

```powershell
Invoke-WebRequest http://localhost:8080/            # 200, index.html
Invoke-RestMethod  http://localhost:8080/api/v1/meta
(Invoke-WebRequest http://localhost:8080/config/runtime-config.json).Headers['Cache-Control']
#   ^ must say no-cache
```

From a client machine, browse to `http://10.200.129.66:8080/`, then confirm a
deep link survives a refresh (e.g. `/companies/<code>`). That exercises the SPA
fallback - the thing that only ever breaks on reload.

---

## Redeploying after a code change

**Stop the service first.** It is not optional and it is not about a clean
shutdown: the service runs the TypeScript through `tsx`, `tsx` is built on
esbuild, and the running process therefore holds
`node_modules\@esbuild\win32-x64\esbuild.exe` open for as long as it lives.
`npm ci` begins by deleting `node_modules`, so with the service up it fails
`EPERM ... unlink ... esbuild.exe` **after** it has already removed part of the
tree - which is worse than not starting, because the next command then fails
with `'tsc' is not recognized` and the checkout needs a second `npm ci` to
become whole again.

```powershell
C:\tools\nssm\nssm.exe stop DashboardIotApi
git pull
npm ci
npm run build
C:\tools\nssm\nssm.exe start DashboardIotApi
```

**`start` returns before the port answers**, so do not verify with a bare
request - it will refuse the connection and look like a failed deploy.
`tsx` transpiles the server on every boot, and `buildApp` awaits the first
InfluxDB snapshot before it binds. Measured 2-4 s with no credentials
configured; longer against a live instance, where the first poll runs the real
queries. Wait for it instead:

```powershell
$deadline = (Get-Date).AddSeconds(60)
do {
  Start-Sleep -Seconds 2
  $up = try { (Invoke-RestMethod http://127.0.0.1:8080/healthz -TimeoutSec 3).status -eq 'ok' } catch { $false }
} until ($up -or (Get-Date) -gt $deadline)
if ($up) { 'up' } else { 'not answering - read logs\api-out.log, then logs\api-err.log' }
```

The dashboard is down between the stop and the start - about a minute. There is
no way around that with one process, and a wall of screens shows its own
reconnect state while it lasts.

`nssm` by its full path because `C:\tools\nssm` is not on PATH. Put it there if
you would rather type `nssm` (a new shell picks it up, the current one does
not):

```powershell
[Environment]::SetEnvironmentVariable('Path', $env:Path + ';C:\tools\nssm', 'Machine')
```

If only `public/`, `src/` or another frontend file changed, `npm ci` has nothing
to do and the whole dance is unnecessary - `git pull; npm run build` is enough,
and the new files are live on the next request without a restart. The stop is
for `npm ci` specifically. If `scripts/install-service.ps1` or `server/.env`
changed, re-run the install script instead of starting by hand.

---

## Troubleshooting

| Symptom | Cause |
| --- | --- |
| Every page 404s, but `/api/v1/meta` answers | `STATIC_DIR` blank in `server/.env`. |
| Service will not start, `logs\api-err.log` names a key | zod rejected `server/.env`. Blank optional keys are fine; a malformed one is not. |
| Service will not start, no log at all | `node.exe` not on the machine PATH (per-user Node install). |
| Service will not start, error names `dist` | `STATIC_DIR` points somewhere that does not exist. Run `npm run build`. |
| Deep links 404 on refresh but work when clicked | Should not happen in this topology - it is what `staticSite.ts` exists for. Check the service is the thing answering, not something else on the port. |
| A hashed asset 404s and the page is blank | `index.html` and `assets/` went out of step. Rebuild; do not copy `dist/` folders between machines. |
| Changed `apiBaseUrl`, nothing happened | Edited in `dist/` and then overwritten by a rebuild. Edit `public/config/runtime-config.json`. |
| Every source `down` in `/api/v1/meta` | `INFLUX_URL` missing its `:8181` port, or credentials blank. |
| `npm ci` fails `EPERM ... esbuild.exe` | The service is running and holds esbuild.exe through tsx. Stop it and re-run. |
| `'tsc' is not recognized` right after that | The failed `npm ci` had already deleted part of node_modules. Stop the service, run `npm ci` again, and it completes. |
| `nssm` is not recognized | It is at `C:\tools\nssm\nssm.exe` and that folder is not on PATH. See Redeploying. |
| Connection refused right after `nssm start` | Too early. The port binds a few seconds after the service starts. Poll `/healthz` rather than asking once; `logs\api-out.log` ends with a "Server listening" line when it is genuinely up. |
| Dashboard died right after a Grafana upgrade | The service was pointed at Grafana's bundled `nssm.exe`. Re-run the install script with `C:\tools\nssm\nssm.exe`. |
