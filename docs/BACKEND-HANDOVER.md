# Backend Handover - Real Data (InfluxDB 3.x + MSSQL) for the Global Executive Dashboard

**Read this before touching `server/` or `packages/`.** This document is the
handover for whoever (human or AI) continues this work. `docs/DESIGN.md` is
still the authoritative business spec (hierarchy, formulas, shift model, open
decisions D-01…D-27) - this file is the *engineering* status on top of it:
what's built, what's verified, what's next, and what's blocked.

Last updated: 2026-08-26.

---

## 1. Where this fits in the project

Three phases, in order:

- **Phase 1 (done, committed)** - Vite/React/TS scaffold + a mock backend
  (`src/mocks/`) that implements the design doc's business rules against
  synthetic data, with a test suite (`src/mocks/contract.test.ts`) proving
  the rules are right. Commits: `cf6d515`, `8992b42`.
- **Phase 2 (done, not yet committed as of this writing)** - the full React
  frontend (`src/components`, `src/pages`, `src/domain`, `src/i18n`,
  `src/theme`, `src/state`) built against a fully-typed, zod-validated API
  contract, running against the mock adapter. Verified: `npm run verify`
  (typecheck/lint/29 tests/contrast/build) passes; a full click-through
  (Overview → expand ranking row → Plant detail) renders correctly with zero
  console errors.
- **Phase 3 (in progress - this document)** - replace the mock with a real
  backend querying **InfluxDB 3.x (IOx/DataFusion SQL)** and **MSSQL**.
  `src/api/httpAdapter.ts` - the real HTTP client the frontend will call - is
  **already fully implemented** and has been since Phase 2; it's simply never
  invoked while `public/config/runtime-config.json`'s `dataSource` is
  `"mock"`. Flipping that one field is the cutover (see §7).

## 2. Decisions already made - do not re-litigate these

- **Backend stack: Node.js + TypeScript.** Chosen specifically so the backend
  reuses the frontend's zod contract directly and ports the mock's reference
  business logic near-verbatim, instead of re-deriving it (and risking drift)
  in another language.
- **Repo shape: npm workspaces monorepo, in place.** The repo was green-field
  (2 commits, no remote) when this decision was made, so restructuring was
  low-risk. See §3.
- **Web framework: Fastify.**
- **InfluxDB client: plain HTTP to the SQL query endpoint**
  (`POST /api/v3/query_sql`), not the Arrow/Flight SQL client - no native/gRPC
  dependency, plain JSON rows, trivially mockable with fixtures.
  **Verified working against the real instance on 2026-08-25 - see §4.1.**
- **MSSQL client: `mssql` npm package**, scaffolded but **not wired into any
  route** - D-18 (whether defect data ships to the exec dashboard at all) is
  still open.
- **Milestone-1 scope: a narrow vertical slice.** `GET /meta` and
  `GET /global-overview` working against **real** InfluxDB data for
  **THS/ASI/STJ only** - the 3 of 9 companies with live telemetry today
  (DESIGN.md §11). The other 6 (SEH/VNS/ISE/SUS/IIS/SMX) must still appear
  correctly as `not_connected`, sourced from static config.
  `/companies/:code` and `/companies/:code/plants/:code` (company/plant
  drill-down) are a **later milestone**, out of scope for now.

## 3. Repo structure (as built)

```
package.json                 root - "workspaces": ["packages/*", "server"]
tsconfig.json                root solution file - references app/node/contract/domain-shared/server

src/                         the existing frontend (Phase 2, unchanged in shape)
  api/contract/index.ts      now a FACADE: `export * from '@dashboard/contract'`
  mocks/                     still the mock adapter - untouched, still the reference spec (see §5)
  ...

packages/
  contract/                  name: "@dashboard/contract" - the zod schemas (moved from src/api/contract/*.ts)
    src/{primitives,common,meta,globalOverview,companyDetail,plantDetail,index}.ts
  domain-shared/             name: "@dashboard/domain-shared" - ported pure logic, framework-agnostic
    src/tz.ts                IANA-zone math, verbatim port of src/mocks/tz.ts
    src/shift.ts             resolveShift() - parameterized on ShiftConfig, not the mock's CompanySeed
    src/tier.ts              deriveTier(), tierBounds()
    src/statusBucket.ts      BUCKET_OF map, isReporting()/isRankable()
    src/rollup.ts            rollupOa(), sumOrNull(), addCounts(), emptyCounts()
    src/invariants.ts        checkPartition(), checkGlobalOverview(), assertOrCollect()
    test/shift.test.ts       ported UNCHANGED from src/mocks/contract.test.ts's shift-resolution assertions
    test/rollup.test.ts      new - null-when-zero-weight, etc.

server/                      name: "@dashboard/server" - the new backend
  .env.example                template - copy to .env, fill in real values (gitignored)
  src/
    index.ts                 entrypoint: loadEnv() -> buildApp() -> listen(), graceful shutdown on SIGINT/SIGTERM
    app.ts                   buildApp(env): unbound Fastify instance (for .inject()-based tests), registers cors/auth/routes
    config/
      env.ts                 zod-parsed process.env - THROWS on boot if malformed (unlike the frontend's forgiving config)
      masterData.ts          ported from src/mocks/masterData.ts - 9 companies, lat/lng, timezone, shift_config,
                              PLUS machinesExpected (Q-08) and machineExclusions (empty, see §6 Q-02) per plant
      policy.ts               TARGET_OA/TIER_POLICY/FRESHNESS/OA_AGGREGATION/QTY_UNIT - ported from mock's POLICY_BLOCK,
                              except OA_AGGREGATION which is now simple_avg, not weighted_by_qty (D-20 closed, §4.6b)
    lib/
      logger.ts               pino instance for use outside request scope
      respondValidated.ts     validates every response against its contract schema before reply.send() (throws in dev)
      sourceHealth.ts         STUB - reports influxdb+mssql as "down/not yet connected" honestly. Phase 1 replaces this.
    domain/
      envelope.ts             builds { generated_at: fresh Date.now() every call, partial, sources, ... }
      counts.ts               Q-02 machine census per plant - TOTAL = RUNNING + STOP
      siteStatus.ts           readiness + last_seen -> online/stale/degraded/no_data, and the company roll-up
      oa.ts                   Q-03 %OA: oaFromPoGroup(), foldMachineOa(), averageOa(), oaWarnings() - see §4.6
    services/
      metaService.ts          buildMeta() - pure master-data + envelope, NO Influx/MSSQL call
    routes/
      health.ts                GET /healthz (unprefixed, liveness probe, not part of the DashboardApi contract)
      meta.ts                  GET /api/v1/meta
    plugins/
      auth.ts                  no-op (request.user = null always) - D-08/D-09 deferred, architecturally ready
  test/
    health.test.ts
    meta.test.ts               asserts zMeta.parse() succeeds, 9 companies, THS/ASI/STJ live, generated_at advances
```

Root scripts added: `npm run test:workspaces` runs tests in every workspace
(`packages/*` and `server`) - the existing `npm run test` still only runs the
frontend's own suite (unchanged, scoped by `vitest.config.ts`'s `include`).

## 4. What's actually done and verified (Phases 0 / 0.5 / 0.75)

Run these yourself to confirm before trusting this section:

```bash
npm install                 # wires the workspace symlinks (node_modules/@dashboard/*)
npm run typecheck           # tsc -b --noEmit across app/node/contract/domain-shared/server - must be clean
npm run lint                # must be clean
npm run test                # frontend's own 29 tests - must still pass unchanged
npm run build               # frontend production build - must still succeed unchanged
npm run test:workspaces     # domain-shared (11 tests) + server (3 tests) - must all pass
```

Manual end-to-end check that was run and passed:

```bash
cd server
CORS_ORIGIN=http://localhost:5173 PORT=4000 npx tsx src/index.ts &
curl -s http://localhost:4000/healthz
curl -s http://localhost:4000/api/v1/meta | python -m json.tool   # or any pretty-printer
```

`/api/v1/meta` returns, live: all 9 companies with correct `data_readiness`
(THS/ASI/STJ `live`, SEH `installing`, 5 `planned`), `target_oa: 95` with
`tier_policy: {good_at: 90, warn_at: 75}`, correct shift configs for THS
(2-shift) and STJ (3-shift, 22:15 boundary), and `meta.sources` honestly
reporting both `influxdb` and `mssql` as `down` / not yet connected (never
fabricating "ok").

**Not committed to git yet** - this is all sitting as uncommitted changes.
Confirm with the user before committing (they asked to be asked).

### 4.1 Phase 1 connectivity spike - InfluxDB VERIFIED WORKING (2026-08-25)

Run against the real instance. Influx connectivity is **no longer blocked**,
and §2's "plain HTTP to the SQL query endpoint" decision is confirmed correct
in practice - no Flight SQL, no native dependency, plain JSON rows.

| Setting | Value |
|---|---|
| Edition | InfluxDB 3.x self-hosted (Core/Enterprise) - port **8181** open; 80, 443, 8086 all closed |
| Endpoint | `POST {INFLUX_URL}/api/v3/query_sql` - works exactly as designed |
| Auth | `Authorization: Bearer {INFLUX_TOKEN}` - works |
| Request body | `{"db": ..., "q": ..., "format": "json"}` -> plain JSON row array |
| Database | `iot_data_global_test` - note the `_test` suffix, see §7 |

`INFLUX_URL` **must include `:8181`**; the host answers on nothing else.
`server/.env` is filled in and gitignored (only `.env.example` is committed).

Tables that actually exist (`information_schema.tables`, 10 total):

```
buffer_test          injection_molding        production_machine_io
check_systems_iot    preflight                production_machine_state
energy_consumption   production_alarm_logs    production_machine_status
test_metric
```

DESIGN.md §8.3 documents only three of these. `production_alarm_logs`,
`energy_consumption`, `injection_molding` and `check_systems_iot` appear
nowhere in the design doc - `production_alarm_logs` in particular changes a
decision (see 4.3e).

### 4.2 Two InfluxDB gotchas that will bite every query

**(1) DataFusion lower-cases unquoted identifiers.** Every camelCase or
PascalCase column - `codeCompany`, `codeCountry`, `mainGroup`, `Result`,
`StatusStartTime`, `ProductionOrder0..3`, `AlarmCount` - **must be
double-quoted**:

```sql
SELECT codeCompany   FROM production_machine_status   -- HTTP 500, EMPTY body
SELECT "codeCompany" FROM production_machine_status   -- OK
```

The failure mode is the worst possible one: **HTTP 500 with a zero-length
response body** and no error message anywhere in the response. The Influx
client written for this project should quote identifiers unconditionally
rather than rely on anyone remembering.

**(2) Queries spanning more than 3 days fail.** Measured on
`production_machine_status`:

| Window | Result |
|---|---|
| 1 day | OK - 36,594 rows |
| 2 days | OK - 73,663 rows (474 ms) |
| 3 days | OK - 110,492 rows (247 ms) |
| 4 / 5 / 7 / 14 / 30 days | **HTTP 500** |

The failures get *faster* as the window widens (14 days fails in 84 ms), so
this is **not** a timeout and not a volume limit - it fails before it scans.
Likely retention expiry or a schema conflict in older parquet files. The
response body is empty, so **the real error is only visible in the InfluxDB
server log** - someone with host access has to look.

**Consequence for Q-01:** Phase 2's planned "wide internal scan window
(e.g. 3 days)" sits exactly on the boundary. Use **71 hours, not 72**, until
the cause is understood.

### 4.3 Real-data findings that CONTRADICT this document and DESIGN.md

**(a) `codeCompany` is NULL on 98.6% of `production_machine_status` rows.**
Over a 1-day window: 36,079 rows NULL vs 515 rows with a value.

| codeCompany | plant | distinct machines | rows |
|---|---|---|---|
| `ASI` | 6051 | 20 | 420 |
| `THS` | 6332 | 25 | 95 |
| *(NULL)* | 6051 | 21 | 35,049 |
| *(NULL)* | 6332 | 26 | 965 |
| *(NULL)* | 6338 | 1 | 64 |

**This invalidates Phase 2's plan to filter `codeCompany IN ('THS','ASI','STJ')`**
- that predicate discards 98.6% of the telemetry. `plant` is populated on
every row and master data already maps plant -> company (6332/6337/6338/6321
-> THS, 6051 -> ASI), so **filter and group by `plant`, then derive the
company from config.** Confirm with the IoT owner why the tag is missing
before building on this - a pipeline fix upstream would be the better answer.

`production_machine_io` is tagged far better (ASI/6051: 40,293 rows over 1 day
*with* `codeCompany` set), so the gap is specific to the status pipeline.

**(b) STJ has no data at all** in either table over the full 3-day window,
despite DESIGN.md §11 and `masterData.ts` listing it as one of the three
`live` companies. This is **evidence that D-17's three datasource UIDs really
are separate instances**, with STJ on another one. `/meta` currently reports
STJ as `live` from static config; that claim is now unverified.

**(c) Machine counts disagree with `masterData.ts`:**

| plant | `machinesExpected` | distinct machines in Influx |
|---|---|---|
| THS 6332 | 10 | 25-26 |
| THS 6338 | 6 | 1 |
| THS 6337 | 8 | no data |
| THS 6321 | 2 | no data |
| ASI 6051 | 21 | 20-21 (matches) |

Q-02's "reconcile against `machinesExpected`, shortfall -> Offline/no_data"
step will produce nonsense for THS until these are reconciled. The Influx
`machine` tag list is also the input needed to finally fill in
`machineExclusions` (§6, still `[]` everywhere).

**(d) `production_machine_status` has far more columns than DESIGN.md §8.3
records.** Beyond the documented set, the real table carries: `AlarmCount`,
`AlarmMessage`, `MachineState`, `MachineStatus`, `Result1`, `SendTrigger`,
`StartTime`, `TotalEnergy_Diff`, `MotorEnergy_Diff`, `HeatingEnergy_Diff`,
`ProductionOrder0..3`, `icsno0..3`, `icsname0..3`, `vIcsName0..3`, `shift`,
`template`, and `branch_id` / `branch_name` (which appear nowhere in
DESIGN.md at all). Note `StatusStartTime` is `Float64`, not a timestamp, and
all tag columns are `Dictionary(Int32, Utf8)`.

**(e) `production_alarm_logs` exists and carries exactly the fields §7 said
were missing.** Columns: `alarm_id`, `alarm_class`, `severity`, `message`,
`is_standstill`, `machine`, `plant`, `zone`, `process`, `mainGroup`,
`branch_id`, `branch_name`, `time`.

§7's conclusion - "no field for stop reason, severity, category, or owner, so
ship `alerts: []`" - **was based on an incomplete schema reading and no longer
holds.** `severity` and `alarm_class` are real columns. Re-open the alerts
decision with the design-doc owner instead of defaulting to an empty array.
Not yet checked: whether these rows actually cover THS/ASI, and what the
distinct `severity` / `alarm_class` values are.

### 4.4 Phase 1 built and verified end-to-end (2026-08-25)

`GET /api/v1/global-overview` now serves **real liveness** from InfluxDB.
Counts are still zero and every KPI still null - that is Phase 2/3 - but
`status`, `last_seen` and `meta.sources` are measured, not configured.

New in `server/src/`:

```
influx/client.ts        HTTP client for /api/v3/query_sql. ident() quotes
                        identifiers; assertIdentifiersQuoted() REFUSES to send
                        a query carrying an unquoted mixed-case column, because
                        that failure is an empty-bodied 500 (§4.2).
influx/queries.ts       Q-07 plant-liveness SQL. Window capped at 71h in code.
influx/time.ts          Influx returns zone-less timestamps; parsing one with
                        new Date() reads it as LOCAL time, seven hours off.
services/liveSnapshot.ts  The 3 s background poller. Keeps the last good
                        `plants` map on failure rather than blanking it.
services/globalOverviewService.ts  Master data + snapshot -> GlobalOverview.
domain/siteStatus.ts    The freshness ladder and the company roll-up.
routes/globalOverview.ts  Route; runs checkGlobalOverview() on every response.
deps.ts                 { env, poller }, passed to routes via register().
```

**Why a backend-side poller rather than querying per request:** Influx load
becomes independent of how many screens are open. The interval must stay
BELOW the frontend's `refreshMs`, because the UI's freeze detector
(`FREEZE_THRESHOLD = 3`) calls the feed frozen after three identical payloads
- a poller slower than its clients raises a false alarm on a healthy system.
3 s backend / 5 s frontend holds that margin, and both files say so.

Verified against the live instance, not just in tests:

| Company | status | why |
|---|---|---|
| THS | `degraded` | 6332 online, 6338 stale (~7 min), 6337/6321 never seen |
| ASI | `online` | 6051 reporting continuously |
| STJ | `no_data` | master data says `live`, this instance holds none of its data (§4.3b) |
| SEH | `not_connected` | `installing` |
| VNS/ISE/SUS/IIS/SMX | `not_connected` | `planned` |

Browser check (Playwright, `localhost:5174` through the Vite dev proxy):
page renders with **zero console errors**, the header reads "Live · updated 0s
ago", the coverage tile reads "2 of 9 connected", every KPI reads "No data" /
"No plan" rather than a fabricated `0`, and two `/global-overview` requests
land in a 7-second window (the 5 s poll).

Two behaviour changes outside the new files, both deliberate:

- **`meta.sources` now lists only sources this deployment has.** MSSQL is
  omitted while `MSSQL_SERVER` is unset. `Envelope.partial` is
  `sources.some(s => s.status !== 'ok')`, so leaving an unwired source pinned
  to `down` marked every response partial and dimmed the whole dashboard
  permanently over a source no route reads. `test/meta.test.ts` was updated to
  match. Present-and-`down` now means "should be working and is not".
- **`public/config/runtime-config.json`: `dataSource` → `"http"`,
  `refreshMs` → `5000`.** `apiBaseUrl` deliberately stays `/api/v1`: a dev
  proxy in `vite.config.ts` forwards `/api` to `127.0.0.1:4000`, so the
  committed file stays deploy-correct instead of carrying a localhost URL.
  (127.0.0.1, not localhost - on Windows `localhost` resolves to `::1` first
  and Fastify's `0.0.0.0` bind is IPv4-only, which reads as a dead backend.)

`server/.env` is loaded automatically by `npm run dev` / `npm start` via
`--env-file-if-exists`; it was previously documented but never read.

### 4.5 Phase 2 - the machine census, and what the real data forced (2026-08-25)

**(a) The status enum in DESIGN.md §8.4 is incomplete.** Distinct `Result`
values actually emitted, over a 71h window:

| `Result` | rows | in the contract enum? |
|---|---|---|
| `Mass Pro` | 73,893 | yes |
| `Dandori` | 23,610 | yes |
| `Stop` | 11,420 | yes |
| `Order End` | 64 | yes |
| **`Pending`** | 62 | **no** |
| `4M Change` | 16 | yes |
| **`Alarm`** | 6 | **no** |
| **`Warning`** | 6 | **no** |
| `No Plan` | 3 | yes |
| `Offline` | 0 | yes - never emitted, exactly as §8.4 predicted |

`Pending`, `Alarm` and `Warning` were added to `zMachineStatus` and mapped to
the **`other`** bucket in `BUCKET_OF`. `other` exists for precisely this
(common.ts: "an undecided or newly-added status has somewhere truthful to go").
`Alarm` reads like a stop and may well belong in `stopped` - but moving it
there changes the STOP tile an executive escalates on, so it needs a decision,
not an assumption. **Open item.**

Anything the backend sees that is *still* outside the enum is excluded from the
census, logged, and named in `meta.warnings` - never folded into a bucket.

**(b) `Order End` is stored, not only derived.** DESIGN.md §8.4 says it is
"คำนวณ ไม่ใช่ค่าจาก DB". The database emits it directly (64 rows). Both
statements can be true - the writer may already apply the rule - but the doc's
claim that it never appears in the DB is wrong.

**(c) Neither Order-End derivation layer can be implemented against this
schema.**

> ### ⛔ SUPERSEDED 2026-08-27 - this subsection was wrong. See §4.8.
>
> Both layers are implemented and reconciled. Layer 2 lives in
> `server/src/domain/orderShift.ts`. The reasoning below failed because it was
> done without the panel source, which has since been recovered into
> **`docs/grafana/MACHINE-STATUS-V2.md`**. Kept verbatim because the *shape* of
> the mistake is worth seeing: every fact in it is correct and the conclusion
> drawn from them is not.
>
> - **Layer 1's `global_machine_seq` is not a column, it is a `ROW_NUMBER()`
>   alias** inside the old query (MACHINE-STATUS-V2.md §2.1). Checking
>   `information_schema` for it was looking for a derived value in a table.
> - **Layer 2's `"-"` rows are the SKIP condition, not a parse failure.** The
>   panel returns early unless the card has a real `ProductionOrder0`, so the
>   51% never reach the comparison. And it does not compare against a
>   `YYYY-MM-DD` string - it converts both sides to (production date, shift)
>   with `Intl`. Applied to live data it moves 2 machines of 15, not 15 of 15.
> - **Both timestamp formats parse**, differing only in separator.
> - **Layer 2 does not touch Running at all.** It blanks a card's figures, so
>   the machine leaves the %OA average and keeps its status. The fear that it
>   would "collapse Running to near zero" was about the wrong number.

This was believed to be the single biggest reason Phase 2's counts would not tie
out against the old Grafana panels:

- **Layer 1** keys on `global_machine_seq > 1`. That column exists in
  **neither** `production_machine_status` nor `production_machine_io`
  (`information_schema` checked directly). It is not a matter of finding the
  right query - the field is not there.
- **Layer 2** compares `vCreateDateTxt` against the shift's production date.
  Over a 2h window (5,735 io rows): the column is the literal string `"-"` on
  2,946 rows (51%), NULL on 1,749 (30%), and where it does hold a value it is a
  **full timestamp in two different formats** - `2026-08-25 02:14:25` and
  `2026/08/24 16:02:14`. The handover's own sketch compares it to a
  `YYYY-MM-DD` production date, which can never match, so a literal reading
  marks **every** machine `Order End` and collapses Running to near zero.
  There are also four PO slots (`vCreateDateTxt0..3`, all populated together)
  and nothing states which one the original JavaScript read.

Only the `Result` the database stores is used. Both gaps are recorded in
`meta.warnings` on every response, so a consumer who never reads this file can
still see that the counts are not Grafana-comparable yet. **Getting the
original Grafana JSON is now the highest-value unblock in the project.**

**(d) `machineExclusions` - a likely transcription error, deliberately not
acted on.** DESIGN.md §10 lists the hardcoded exclusions as
`'lA1','lA2','D2','D3','D4','P1l4'`. The real machine roster for THS 6332
contains `IA1`, `IA2`, `P1I1`, `P1I2`, `P1I5`, `P1I8` - and no machine anywhere
is named with a lowercase `l`. The list was almost certainly transcribed with
capital-I read as lowercase-l, making the real exclusions `IA1`, `IA2`, `P1I4`
plus `D2`/`D3`/`D4` (none of which currently report).

It is left `[]` anyway. The hypothesis is strong but unverified, and silently
dropping three reporting machines on a guess is exactly the class of error this
project exists to prevent. Confirm against the Grafana JSON, then fill it in.

**(e) The real machine roster** (2h window), against `machinesExpected`:

| plant | expected | observed | machines |
|---|---|---|---|
| ASI 6051 | 21 | 21 | `M-ID-01/02/06..10`, `M-IS-01..11`, `M-IS-24/29/30` |
| THS 6332 | 10 | 26-29 | `AF2`, `BP6`, `HC2`, `I1..I9`, `IA1/IA2`, `IB4`, `IC3..IC9`, `P1I1/P1I2/P1I5/P1I8`, `P2I1/P2I5` |
| THS 6338 | 6 | 1 | `I24` |
| THS 6337, 6321 | 8, 2 | 0 | - |

**(f) TOTAL = RUNNING + STOP.** Set by the design owner on 2026-08-25, to match
the machine-status board already in production where the three figures add up
on screen (29 = 22 + 7) and nobody has to reconcile them.

> ### ⛔ SUPERSEDED 2026-08-27 - see §4.8.
>
> **TOTAL is now everything except `Order End`, which is the rule the board
> actually applies** (`EXCLUDE_FROM_TOTAL` in its `afterRender`, recovered into
> MACHINE-STATUS-V2.md §4.2). The two rules agree whenever no machine sits in a
> third state, which is most of the time and was true of the 2026-08-25 snapshot
> this was set from - so it looked right without being right.
>
> The `machinesExpected` half of this decision **still stands**; it is
> independent of the TOTAL rule and is restated in `domain/counts.ts`.

This reverses two things Q-08 and `zCounts` were written to do, so the reasons
matter:

- **`machinesExpected` no longer feeds the census.** It could not carry that
  weight - it claims 10 machines at THS 6332 while 27-29 report (§4.3c), so
  every total built on it inherited a config error. TOTAL is now made only of
  machines InfluxDB confirms. The field stays in `masterData.ts` for D-06 and
  for `PlantDetail` (milestone 2), but nothing reads it.
- **Observed machines in any other state are left out of TOTAL** - `No Plan`,
  `Order End`, `4M Change`, `Pending`, `Alarm`, `Warning`. These are real
  machines on the floor, so this is a presentation choice, not a measurement.
  Each plant's count of them goes into `meta.warnings` on every response: the
  card stays clean, the payload never pretends they were not seen. Rare in
  practice - 145 of ~109,000 status rows over 71 h.

The frontend needed no change: `KpiStrip` already hid its third line when the
remainder was zero, which it now always is.

**Known consequence, accepted:** on a day when a plant has no production
scheduled, its machines sit in `No Plan` and TOTAL drops rather than showing
them as idle. `zCounts`' own comment calls `machines = run + stop` the Q-08
trap; that objection is on the record and was overruled with the config
evidence above.

**(g) Two thresholds, deliberately different - and the trap between them.**
The query window is 2h (so the quietest observed machine, ~1.8h, is not lost)
while `no_data_after_sec` is 15 min. A plant can therefore read `no_data` while
its machine rows are still inside the window. Counting those produced
"6338: no data · 1 running" on one row. A plant that is not reporting now
contributes no observations at all; its expected machines fall through to
`Offline`. `server/test/globalOverview.test.ts` pins both directions - a
`stale` plant still counts (its last numbers are real, T-11), a `no_data` one
does not.

**Verified live**, all nine companies, invariants clean on every response:

```
GLOBAL   total=33  running=24  stopped=9   (24 + 9 = 33)
THS      degraded  total=12  (6332 online 12 · 6337/6338/6321 no_data, contribute nothing)
ASI      online    total=21  (6051 online 21)
STJ      no_data   total=0   (non-reporting sites contribute nothing, at every level)
```

Browser check: `TOTAL MACHINE 33`, `RUNNING 24 (72.7%)`, `STOP 9 (27.3%)` -
the card's third line is gone because the remainder is now always zero -
`2 of 9 connected`, `%OA No data`, zero console errors, polling every 5 s.

### 4.6 Phase 3 - %OA and %Achievement, and what the production board settled (2026-08-25)

Q-03 is built and **reconciled against the live `One Stanley Narong-Pat
Machine Status V2.0` board** (plant 6332), read at ~11:45Z. That
reconciliation is the whole value of this section: two things the Phase 3 plan
above assumed turned out to be wrong, and only comparing against the screen
found them.

**(a) The per-machine formula in DESIGN.md §9.1 is correct, to the decimal.**

| | Board | `machineOaSql` + `oaFromPoGroup` |
|---|---|---|
| I5, order 110000962985 | `%OA 47.5%` · `OUTPUT ACTUAL 295` · `PLAN 400` · `%AR 73.8%` | `min_std_time` 31 · `sum_qty` 295 · `weighted_time` 19236.09 → **47.5%** |
| IC4, order 110000953255 | `ACTUAL 133` | 137 (same order still running, minutes later) |
| IA1, order 110000957098 | `ACTUAL 66` | 71 (ditto) |

No mode filter is applied, matching §9.1 as written. Worth knowing that `mode`
is not a shared enum: 6051/6332 emit `Auto`/`Manual`/`Warning` while 6338 emits
`AUTOMATIC`/`SEMI_AUTOMATIC`, so any future filter needs a per-plant mapping,
not a string compare.

**(b) "Avg %OA" is a plain mean over the machines that have an order loaded -
NOT the weighted roll-up this project had chosen.**

The board's header read `AVG %OA 69.8%` across `TOTAL 29 / RUNNING 12 /
STOP 17`. Only four cards carried an order; the other 25 printed `%OA 0.0%`
with `PROD.ORD.NO.: -`. Measured on the same rows at the same moment:

| Candidate | Result |
|---|---|
| **plain mean of the machines on an order** (48.9 + 47.5 + 89.9 + 93.0) / 4 | **69.8%** ← matches |
| plain mean over every machine seen, order-less counted as 0 | 12.1% |
| plain mean over `Mass Pro` machines only | 25.8% |
| **weighted by output qty** - what `OA_AGGREGATION` was set to under D-20 | **56.8%** |

So D-20 is closed as `simple_avg`. The weighted figure is defensible in
isolation and 13 points below the board on the shop-floor wall, computed from
identical rows - `I5` alone carries 295 of the 544 pieces at 47.5%, so
weighting hands it the answer. `oa_aggregation` still travels in the payload,
so the methodology panel names the rule instead of leaving the reader to guess.
Reverting is one line in `policy.ts` plus swapping `averageOa` for `rollupOa`.

**(c) %OA keys on the CURRENT order, not on a time window.** A machine whose
order finished has its slots back at `-` and drops out of the average entirely -
I2, I6 and I9 each ran an order earlier in the same 24 h (53.4%, 52.5%, 99.5%)
and the board showed all three as `-` / `0.0%`. `foldMachineOa` reproduces this
by keeping the group holding `MAX(time)`. **This makes the card an
instantaneous read of the machines currently on an order, not a shift
average** - a thing worth saying out loud about a tile labelled "เฉลี่ย".

The window (24 h) therefore only bounds how far back one order's rows are
summed. It is still unpinned: every order live at reconciliation time had
started inside the current day shift, so 24 h, "today" and "current shift" all
gave the same answer. Needs an order spanning two shifts to distinguish.

**(d) Two machine populations are excluded, both named on the envelope.**

- **`multi_po` (D-27). Revised 2026-08-26: this is NOT ASI-only, and it is now
  the largest single hole in the figure.** `std_time` is the SUM of the active
  PO slots while `cycle_time` is one physical cycle, so §9.1 inflates by the
  slot count. First measured at ASI 6051 - 110% at one slot, 279% at two,
  **419%** at three (M-ID-02: `min_std_time` 168 = 3 × 56, `sum_qty` 168,
  `weighted_time` 6737.22) - and including those put **213%** on the global
  card, green, since 213 clears `good_at` 90.

  The next day THS 6332 had **6 of its 14 order-loaded machines** running two
  orders at once (I4, I5, I6, IA1, IC4, P1I5), and machine **I4 produced the
  controlled experiment in its own rows**: order 110000958498 appears both
  alone and paired with 110000958497, same machine, same ~45.5 s cycle,
  `cavity` 1 throughout.

  | I4, order 110000958498 | slots | `std_time` | `qty` | %OA |
  |---|---|---|---|---|
  | alone | 1 | 26 | 1 | **57%** |
  | paired with …497 | 2 | 52 | 2 | **114%** |

  Nothing physical changed between those two rows. This kills the earlier note
  in this section that said THS never trips the case - it does, and it means
  the average on the exec card is currently built from 8 machines where 14 have
  an order.

  **That also makes it cheap to settle.** It no longer needs the ASI board: the
  THS `Machine Status V2.0` screen shows I4 right now, and whichever of 57% or
  114% it prints tells us whether the old dashboard inherits the defect or
  guards against it somewhere we have not transcribed. One screenshot.

- **`no_std_time`.** An order with `std_time = 0` makes the numerator 0, so the
  formula returns exactly 0% - absence dressed as a measurement (R2). A first
  pass that grouped on the concatenated order key did this to THS 6338's 313
  order-less pieces and pulled that company from 66.7% to 57.4%. Grouping per
  slot fixed it at the source (6338 now reads "no order loaded"); the guard
  stays as the backstop.

Values **above 100% are reported, not clamped** - THS itself has machines at
101.9% and 115.3%, which means a stale standard in the master data, and
clamping would hide the thing that needs fixing behind a number that looks
fine. Each one is named in a warning instead.

**(e) Coverage is thin, and that is the data, not the code.** Of 25 machines
reporting at 6332, 4 had an order; of 21 at ASI 6051, 3 did earlier in the
window and 0 at the time of writing. The rest emit `ProductionOrder0 = '-'`,
`qty = 0`, `std_time = 0` with `cycle_time` still ticking - including machines
sitting in `Mass Pro`. The board has exactly the same hole (`I3`, `I6`, `IC6`,
`IA2`, `IC7` all read `MASS PRO` with `-` and `0.0%`), so this is inherited,
not introduced. It does mean the tile speaks for a minority of the running
fleet - ask the IoT owner why a running machine reports no order.

**(f) Bonus reconciliation for §4.3c.** The board's `TOTAL 29` (= 12 + 17, with
`Order End: 1` shown outside the total) against `machinesExpected: 10` for 6332
in `masterData.ts` settles that open item: the real figure is ~29-30, and
**TOTAL = RUNNING + STOP with `Order End` outside it** is confirmed as what the
board does. Note the board's site name is "Narong-Pat" where master data says
"LAMP 2" for 6332 - worth confirming with whoever owns that config.

**(g) Q-04's plan column: `MAX`, never `SUM`, and the three things measured
to be sure.** DESIGN.md §9.2's formula needed no correction; the column it
reads did, and neither document said so.

1. **`plan_qty` is an attribute of the ORDER, repeated on every shot row.**
   Over a 24 h window at every plant, **not one** `(plant, machine, PO slots)`
   group had `COUNT(DISTINCT plan_qty0) > 1`. Reading "TotalPlan = plan_qty0 +
   … + plan_qty3" as a `SUM` over a 295-row group would have called I5's plan
   of 400 **118,000** and its achievement **0.25%** - a wrong number with a
   plausible shape, which is the worst failure mode this project has.
2. **The four plan slots align exactly with the four PO slots.**
   `plan_qtyN > 0` if and only if `ProductionOrderN` is set: 46,962 rows, zero
   exceptions, all three reporting plants. "An order with no plan" and "a plan
   with no order" do not occur today. Both are still guarded - `planFromSlots`
   reads only active slots, and `achievementWarnings` names any machine whose
   output has no plan behind it - because the guard is free and the assumption
   is upstream of us.
3. **No order is shared across machines**: 26 distinct orders in the window, 0
   on more than one machine. So §9.2's double-counting risk did not
   materialise - and is not disproven, only unobserved. The payload warning
   names it rather than claiming it cannot happen.

**(h) `%Achievement` survives the multi-order defect that kills %OA (D-27).**
Both halves of this ratio scale with the slot count; %OA's denominator does
not. ASI 6051 M-ID-02 on three orders carries plan `700 x 3 = 2,100` and takes
`qty` in at 6 pcs per shot - 2 per slot - for 1,512 pieces, so **72%** is a
statement about three real orders, while %OA on the identical rows reads 419%.

**ASI therefore reports `%Achievement` while its `%OA` stays `null`.** The two
KPI cards cover different machine sets on that plant. Real asymmetry in the
data, not an inconsistency in the board - and stated in `meta.warnings` per
plant rather than left for a reader to find by subtraction. (This also corrects
an earlier note in §6 that `plan_qty1..3` were 0 on every live row: they are
700 apiece on ASI's multi-slot machines, which is precisely why the
shared-order case is testable there and the multi-slot case is already tested.)

**(i) Note what the board calls it: `%AR (PROGRESS)`.** `plan_qty` is the **lot
size of the loaded order** - every ASI order is exactly 700, THS's are 400 /
309 / 220 / 816 - so the figure measures progress THROUGH an order, not
attainment against a shift or daily target. A machine an hour into an 816-piece
order honestly reads 12%. The operator board says "progress"; our exec card
says `%Achievement`, and an executive will hear "behind plan today". That is
D-19's shape applied to Q-04: **a naming/tooltip decision for the design-doc
owner, not a different number.** `ACHIEVEMENT_SCOPE_WARNING` ships on every
payload until it is made.

**(j) Scope: the order loaded NOW - the same rule as %OA and the board.** Both
alternatives measured on plant 6332 at the same moment:

| scope | machines | Σplan | Σactual | %Achievement |
|---|---|---|---|---|
| **current order (chosen)** | 4 | 1,745 | 701 | **40.2%** |
| every order in the 24 h window | 13 | 16,881 | 2,080 | 12.3% |

The second drags each finished order's whole plan in against only the output
that fell inside the window. The deciding argument is not statistical: the card
shows the plan, the output and the percentage together, so a reader who divides
the first two must get the third. `actual_qty` was already current-order-only
from Q-03, so a wider plan would have printed `Plan 16,881 / Actual 701` on one
card.

**What was built**

```
server/src/influx/queries.ts     machineOaSql() + MachineOaRow - PO slots returned RAW,
                                 because the count of non-empty slots is load-bearing (D-27)
server/src/domain/oa.ts          oaFromPoGroup / foldMachineOa / averageOa / oaWarnings
server/src/services/liveSnapshot.ts   %OA polled on its OWN slower clock (OA_REFRESH_MS,
                                 default 30 s): the aggregate measures 240-640 ms against
                                 ~40 ms for the status query and a 24 h mean does not move
                                 in 3 s. Promise.allSettled, so one query failing keeps the
                                 other's data. Safe for the freeze detector, which only
                                 compares meta.generated_at.
server/src/lib/sourceHealth.ts   status query live + %OA query failing = `degraded`, not `ok`
server/src/config/policy.ts      OA_AGGREGATION: 'weighted_by_qty' -> 'simple_avg'
server/test/oa.test.ts           17 tests, anchored on the board's own numbers
```

Verified end-to-end against the live instance: `GET /api/v1/global-overview`
returned `totals.oa_pct 69.7` / `oa_tier critical` / `actual_qty 650`,
`companies_needing_attention 1`, `influxdb=ok`, with the same four machines the
board had, and `achievement_pct 39.8` / `plan_qty 1745` / `actual_qty 695`
from the same order groups (Q-04). That 39.8% is output against the LOT SIZE
of each loaded order, not against a shift target - a machine two hours into a
fresh 816-piece order reads low by construction, which is why the payload
carries a warning saying so. Still `null`, openly: `downtime_sec` (needs
`StatusStartTime`, a Float64 of unknown epoch), `trend` (Q-05) and `alerts`
(Q-06).

---

### 4.7 Phase 4 - the hourly %OA trend (Q-05), and the denominator nobody was watching (2026-08-26)

**a. What was built.** `date_bin(INTERVAL '1 hour', "time")` over
`production_machine_io`, grouped by `(hour, plant, machine, PO slots)`, folded
into 24 clock-hourly points ending at the hour in progress. 910 rows and ~690 ms
against the live instance, on the same slow clock as the %OA query.

**b. Three rules, each measured rather than assumed.**

| Rule | Why |
|---|---|
| A machine's several orders inside one hour are combined as a **ratio of sums**, not a mean of percentages | The formula is defined per `Group_PO`, and a machine can finish one order and start another inside the hour. Measured: 11 of 287 machine-hours. Adding numerators and denominators keeps everything it produced and stops a 2-shot order weighing as much as a 200-shot one. |
| Across machines, the **plain mean** - the card's rule (D-20) | The same word has to mean the same thing on the chart as on the card above it. |
| An hour with nothing on an order is `null`, and still emitted | A 24-slot axis with a gap says "nothing ran"; 19 points across the same axis says the hours were shorter. R2. |

**c. The finding that mattered: the denominator swings 1 to 18.** Over the live
24 h the machine count behind each hourly point ran from **1 to 18** while
`site_count` - the only denominator the contract carried - stayed at 1 or 2. The
09:00 bucket read **158.3% over five machines** (three of them ASI machines
running two and three orders in one shot, D-27), the 18:00 bucket read **92.9%
over one**, and both were drawn as the same dot beside hours measured over
fourteen.

`zTrendPoint.machine_count` was added for this (optional, so older payloads
still validate). It is on the tooltip, in the table twin, and named in a
`meta.warnings` line whenever the swing is wide enough to move the mean.

**d. A pre-existing frontend bug the real data exposed.** TrendChart's coverage
warning interpolated `site_count` into **both** halves of "Coverage {reporting}
of {total} sites", so it could only ever print "Coverage 1 of 1 sites". It never
rendered against the mock, whose site count is constant across all 24 points and
therefore never trips `coverageChanged`. The live payload moves between 1 and 2,
and the warning appeared contradicting itself. `total` is now the widest coverage
any measured hour on the chart had.

**e. The card and the chart do not print the same number, by construction.** The
KPI strip is the **current** order over a rolling 24 h; the chart is **every**
order worked in each clock hour. Measured at 08:41: strip 81.8% over 17 machines,
08:00 bucket 81.0% over 13. The chart's own legend also prints a `%OA Avg`, which
is a mean of hourly means - a third reading of the same two words on one screen
(85.0% against the card's 79.0% in the same minute). Nothing is wrong with any of
the three; whether an executive board should show more than one is a label
question and is listed in §7.

**f. Not shift-relative (D-26, still open).** Clock hours in UTC, which is what
DESIGN.md §10 literally specifies and the only definition that survives one line
mixing THS/ASI (two shifts) with STJ (three, B ending 22:15). The frontend
already draws the axis in one named reference zone (D-04). Changing it later
means `machineHourOaSql` and `hourSlots`, nothing else.

**g. Files.**

```
packages/contract/src/common.ts     zTrendPoint.machine_count (optional)
server/src/influx/queries.ts        TREND_POINTS, machineHourOaSql()
server/src/domain/trend.ts          foldMachineHours, hourSlots, buildTrend, trendWarnings
server/src/services/liveSnapshot.ts trend/trendOk/trendError, third query in the
                                    same Promise.allSettled on the OA clock
server/src/services/globalOverviewService.ts
                                    filtered through the SAME gates as the KPI strip:
                                    region filter, company roll-up, per-plant liveness,
                                    machineExclusions
server/src/lib/sourceHealth.ts      trend query failing = `degraded`, not `ok`
src/components/charts/TrendChart.tsx  Machines column + tooltip line; coverage fix (d)
server/test/trend.test.ts           21 tests, anchored on the live 24 h
```

### 4.8 Phase 5 - reconciling with the production board (2026-08-27)

The trigger was the design owner reporting that THS did not match the board.
It did not, by a lot. Measured live, then re-measured after each fix:

```
                 board / expected      before        after
TOTAL (THS)                    29          19           29
RUNNING                        19           5           18*
STOP                            9          14           10*
Avg %OA                     81.0%       75.2%        80.9%
                                          * status changes between polls; TOTAL is stable
```

**The unblock was the panel source.** §4.5(c) ended "getting the original
Grafana JSON is now the highest-value unblock in the project" - that turned out
to be exactly right. The HTML template, the `afterRender` JavaScript and the SQL
are now transcribed and annotated in **`docs/grafana/MACHINE-STATUS-V2.md`**,
and three of the four fixes below are things that document simply *states*.
Read it before touching the census, the %OA scope, or `Order End` again.

**(a) The status window was 2 h; the board's is 24 h.** This was the biggest
single cause - it cost THS ten machines. The 2 h rested on two measurements in
§4.5 that no longer hold: *"a 2 h window returns the same machines as a 71 h
one"* (THS 6332: 20 at 2 h, 28 at 24 h) and *"at a tenth of the cost"*
(re-measured back to back: 513 ms vs 514 ms - the window is not what the query
costs). Machine staleness at THS: 6 under 15 min, 13 at 15-60 min, 2 at 1-2 h,
1 at 2-6 h, **7 at 6-24 h**, 1 over 24 h.

**(b) TOTAL was RUNNING + STOP; the board's is everything except `Order End`.**
See the superseded box in §4.5(f).

**(c) `Order End` layer 2 is implemented** - `server/src/domain/orderShift.ts`.
See the superseded box in §4.5(c) for why it was thought impossible. It is worth
being precise about what it does: it removes a machine from the **%OA average**
and touches no count. At THS it dropped `I5` and `IC5`, both on orders created
20:06 Bangkok the previous night shift, moving Avg %OA 75.2% → 81.0%.

**(d) A `process` filter was added and then REVERTED - do not re-add it.** The
board filters by `${process_var}`, so copying that looked obviously right. It
undercounts: THS 6332 has 26 `Injection` machines and 2 `Surface` (`BP6`,
`HC2`), so the filter reported THS as 27 where the plant floor has 29. An exec
board answers "how many machines does this company have"; the per-process board
it links to answers a different question. Recorded in `config/policy.ts` as a
standing "do not add one".

While removing it, a related bug surfaced: `filters_applied.process` defaulted
to `'Injection'` on every response while **no query had ever filtered by
process**. The payload was naming a scope it did not have. It now reports
`'all'`, and an explicit `?process=` that cannot be honoured is named in
`meta.warnings` instead of being echoed back as though it had been applied.

**(e) A plant's freshness label no longer zeroes its census.** §4.5(g) gated the
census on both the company AND the plant reporting, to avoid "no data · 1
running" on one row. With the window at 24 h that gap is hours wide: THS 6338's
freshest row was 310 min old, so the board showed its one machine and we showed
none. The census now follows the window and the label travels beside it. The
company-level gate stays, and is what keeps
`unconnected-site-contributes-nothing` true.

**Two divergences remain, deliberately, both named in `meta.warnings`:**

- **Stale machines keep their last known status** rather than becoming
  `Offline` - a machine silent for 8 h still reads `Mass Pro`. This is the board's
  own behaviour and the T-11 gap it never closed. Put to the design owner on
  2026-08-27 with the numbers for each option; they chose to match the board.
  Closing it later is a staleness cutoff in `domain/counts.ts` - the measured
  effect at THS is total 29 / running 6 / stop 14 / offline 7 at a 2 h cutoff.
- **An unreadable order-creation time keeps the machine in %OA**, where the
  board blanks it. Zero occurrences measured; dropping data because it could not
  be read is what rule R2 exists to forbid.

### 4.8b The instance this backend reads is NOT the one the wall board reads

**Confirmed by the plant IT owner, 2026-08-27.** D-17 is no longer a suspicion.

`server/.env` points at `db=iot_data_global_test` on `10.200.129.61:8181`. The
`Machine Status V2.0` board reads a different database, and it holds machines
this one does not:

| scope, plant 6332 | this instance | the board |
|---|---|---|
| `process = Injection` | 26 machines | **29** |
| `process = Surface` | `BP6`, `HC2` | `BP6`, `HC2`, **`P1TC1`** |

`P1TC1` is the unambiguous marker: `machine LIKE '%TC%'` returns **zero rows in
all ten tables** of this database (`production_machine_status`,
`production_machine_io`, `production_machine_state`, `production_alarm_logs`,
`injection_molding`, `energy_consumption`, `check_systems_iot`, `preflight`,
`buffer_test`, `test_metric`). It is not a window problem and not a filter
problem - the rows are not here.

**What this means for reconciliation.** Machine COUNTS cannot match while the
two point at different data, and no amount of query work will fix that - it is
one line of config. What CAN be verified across the two, and was, is every rule
that operates on a machine both instances have: see §4.8 for the per-machine
status comparison (14 of 14 identical) and the %OA agreement to the decimal.

**Next step, and it is not a code change:** get the datasource UID off the panel
(Grafana → panel → `e` → the datasource dropdown, or Inspect → Panel JSON →
`"datasource".uid`), look it up under Connections → Data sources, and put its URL
and database into `server/.env`. Then re-run the comparison in §4.8 - the counts
should close without touching a query.

A false trail worth recording so nobody walks it twice: an earlier check in
Grafana Explore returned 26 for `Injection`, which looked like proof of a shared
database and briefly reversed this conclusion. Explore was pointed at a
datasource chosen by hand, not at the one the panel uses. **Always read the
datasource off the panel, never off a picker.**

```
CHANGED
server/src/influx/queries.ts        HOT_WINDOW_HOURS 2 -> 24; vCreateDateTxt0..3 in machineOaSql
server/src/domain/counts.ts         TOTAL = all but `Order End`
server/src/domain/orderShift.ts     NEW - Order End layer 2
server/src/domain/oa.ts             MachineOa.createdRaw, splitByOrderShift, orderShiftWarnings
server/src/config/policy.ts         standing note: no process filter, and why
server/src/routes/globalOverview.ts process default 'Injection' -> 'all'
server/src/services/globalOverviewService.ts  shift split; per-plant liveness gate removed
server/test/orderShift.test.ts      NEW - 16 tests on live timestamps
```

---

## 5. The single most important thing to understand: the mock IS the spec

`src/mocks/generate.ts`, `src/mocks/tz.ts`, and `src/mocks/masterData.ts` are
**not** throwaway fixtures - they are a correct, tested reference
implementation of the design doc's business rules (shift/timezone
resolution, tier thresholds, weighted rollups, machine-status→bucket
mapping, the "not_connected contributes nothing" rule). `src/mocks/contract.test.ts`
proves it. **Do not reinvent this logic from the design doc prose** - port
from the code, and when in doubt, run the mock's tests and match its
behavior exactly. `packages/domain-shared` exists specifically to hold the
parts of this that are pure/reusable; anything still mock-only (random
number generation for demo data) stays in `src/mocks/` and is never imported
by `server/`.

## 6. What's NOT done yet - remaining phases

### Phase 1 - InfluxDB connectivity + liveness (DONE - see §4.1-4.4)

Built, tested and verified end-to-end against the live instance on
2026-08-25. `GET /api/v1/global-overview` serves real `status` / `last_seen` /
`meta.sources`; `server/test/` covers the freshness ladder, the company
roll-up, the identifier guard, the window cap and the UTC conversion
(37 server tests, `npm run verify` green).

Left over from this phase, deliberately:
- **MSSQL is still unconfigured** - `MSSQL_*` in `server/.env` are empty and
  it is therefore omitted from `meta.sources` entirely. Not chased: D-18
  (whether defect data ships at all) is open.
- **Three questions for the IoT owner** (§4.3): why `codeCompany` is NULL on
  nearly every status row, where STJ's data actually lives, and why queries
  beyond 3 days return an empty-bodied 500. None of them block Phase 2, but
  the first two change what Phase 2's numbers *mean*.
- **`machineExclusions` is still `[]`** everywhere. The real machine roster is
  now known (§4.5e) but the design doc's transcribed IDs cannot be matched to
  it with confidence - see §4.5d.

### Phase 2 - Real counts (Q-01, Q-02, Q-08) - DONE, with two known gaps (see §4.5)

Built and verified live on 2026-08-25. `GET /api/v1/global-overview` returns a
real machine census at plant, company and global level; `checkPartition` and
`checkGlobalOverview` run on every response and are clean.

- **Q-01** - `server/src/influx/queries.ts`, `latestMachineStatusSql()`.
  `ROW_NUMBER() OVER (PARTITION BY "plant", "machine" ORDER BY "time" DESC)`,
  2h window, every identifier quoted. It serves Q-07 as well: plant last-seen
  is the max over the machine rows, so there is one query, not two, and the
  two answers cannot disagree.
- **Q-02** - `server/src/domain/counts.ts`, `buildPlantCensus()`. Excludes
  `machineExclusions`, tallies `by_status` from the raw `Result`, derives every
  bucket through `BUCKET_OF`, then reconciles against `machinesExpected`.
- **Q-08** - superseded by the TOTAL = RUNNING + STOP rule (§4.5f).
  `machinesExpected` is no longer read by the census.

Where this deliberately departs from the plan above, with reasons in §4.5:

- **The status enum was extended**, not the data coerced. `Pending`, `Alarm`
  and `Warning` are real values the design doc never listed; they are in
  `zMachineStatus` now and bucket to `other`.
- **`Order End` is not derived at all.** Layer 1's field does not exist in the
  schema; layer 2's field is unparseable without the original Grafana JSON.
  Using `Result` as stored is the only non-fabricating option.
- **TOTAL = RUNNING + STOP** (§4.5f). `machinesExpected` no longer feeds the
  census; machines in any other state are excluded from TOTAL and counted in
  `meta.warnings` instead.
- **A non-reporting plant contributes no observations**, so its expected
  machines show as `Offline` rather than as live statuses under a `no_data`
  heading.

Still open after this phase:
- **Get the Grafana JSON exports.** They unblock Order-End (both layers) and
  confirm `machineExclusions`. Highest-value item in the project right now.
- **Decide where `Alarm` belongs.** `other` today; `stopped` is plausible and
  would move the STOP tile.
- **Reconcile `machinesExpected`** for THS 6332 (10 vs 26-29), 6338 (6 vs 1),
  6337 (8 vs 0) and 6321 (2 vs 0) with whoever owns the plant master data.
  **Partly answered (§4.6f):** the production board itself shows `TOTAL 29` for
  6332, so 10 is simply wrong there. The board also names that site
  "Narong-Pat" where master data says "LAMP 2", which is worth asking about at
  the same time.

### Phase 3 - Real KPI (Q-03 and Q-04 DONE)

Both ratios are built and reconciled against the production board - **§4.6 is
the section to read**, because the plan originally written here was wrong in
two specific ways and only comparing against the screen found them.

- **Q-03 - %OA.** Plain mean of the machines that have an order loaded, which
  is what the board's header does (§4.6b). D-20 closed.
- **Q-04 - %Achievement.** `Σplan` and `Σactual` over the same machine set and
  the same scope as %OA - the order each machine has loaded now - then
  `plan > 0 ? actual/plan*100 : null`. That `null` **intentionally overrides**
  DESIGN.md §9.2's literal "if TotalPlan = 0 → 0", because the contract's rule
  R2 (absence is never a fabricated zero) supersedes it, and the frontend
  already has a "no plan" state waiting.

  Board confirmation: card I5 read `OUTPUT ACTUAL 295 / OUTPUT PLAN 400` and
  `%AR (PROGRESS) 73.8%`; `295/400 = 73.75`. The plan is read with `MAX`, not
  `SUM` - it is an attribute of the order repeated on every shot row, and
  every `(plant, machine, slots)` group in a 24 h window had
  `COUNT(DISTINCT plan_qty0) = 1`. Summing it would have called I5's plan
  118,000 and its achievement 0.25%.

  DESIGN.md §9.2's warning about **an order shared across several machines**
  did not materialise and is not disproven: 26 distinct orders in the window, 0
  of them on more than one machine (§4.6g). The multi-slot case, by contrast, is
  live and tested - ASI's `plan_qty1..3` carry 700 apiece - and it is the case
  where `%Achievement` reports a number while `%OA` cannot (§4.6h).

### Phase 4 - Trend (Q-05 DONE), alerts decision, envelope polish

- **Q-05 - 24h trend. DONE - §4.7 is the section to read.** Hourly
  clock-bucketed via `date_bin(INTERVAL '1 hour', time)`, UTC, hour-aligned,
  deliberately NOT shift-relative (D-26, still open). The thing worth carrying
  forward is §4.7c: the machine count behind each point swings 1 to 18 over a
  live day, so `zTrendPoint.machine_count` now travels with every point and the
  chart shows it. Anyone building the CompanyDetail or PlantDetail trend reuses
  `buildTrend` with a narrower `hours` filter - the domain is already
  level-agnostic.
- **Q-06 - alerts: decision point, not purely a coding task.**
  `StatusStartTime`+duration is computable. **Revised 2026-08-25:** this item
  previously concluded that the InfluxDB schema had *no* field for stop
  reason, severity, category or owner, and recommended shipping
  `alerts: []`. That reading was wrong - `production_alarm_logs` exists with
  `alarm_id`, `alarm_class`, `severity`, `message` and `is_standstill`
  (§4.3e). What is still genuinely absent is an **owner/assignee** field,
  which `zAlert` requires.
  Next step is therefore a scoping question, not a refusal: profile
  `production_alarm_logs` (coverage per plant, distinct `severity` and
  `alarm_class` values, row volume), then agree with the design-doc owner how
  `zAlert.owner` is satisfied - dropped from the contract, derived from plant
  master data, or left null. Fabricating any of these would repeat the
  "invented number presented as real" defect (T-08) this project exists to
  eliminate; `alerts: []` remains the contract-legal interim.
- Background health interval for `sourceHealth.ts`; a `generated_at`-always-
  advances test against real (not stubbed) data.

### Phase 5 - Frontend integration acceptance

- Flip `public/config/runtime-config.json`: `dataSource` → `"http"`,
  `apiBaseUrl` → the real server's URL.
- Add CORS origin for the Vite dev server (`server/.env`'s `CORS_ORIGIN`).
- Manual smoke checklist (no Playwright/E2E harness in this repo yet, only
  vitest): map/KPI/ranking correctness for all 9 companies, live counts
  updating for THS/ASI/STJ, freeze-detector staying quiet over several poll
  cycles, `partial:true` banner behavior when a source is deliberately
  blocked.

## 7. Open items carried forward (not silently defaulted)

- **~~D-27 - the ASI multi-order %OA~~ - CLOSED 2026-08-26.** The production
  board computes it exactly the same way: its I5 card, marked
  `110000961179 (+1)`, printed **105.9%** and this code computed 105.9% from the
  same rows, with three single-order machines on the same screen matching too
  (I1 98.5 / I3 99.7 / I6 101.4). The backend reports the figure as computed and
  names the machines on the envelope. What 105.9% *means* to a reader is D-19,
  below.
- **How many things on one screen may be called "average %OA" (§4.7e).** The
  card is the current order over a rolling 24 h (79.0%), the chart's points are
  every order worked in each clock hour, and the chart's legend prints a mean of
  those hourly means (85.0%) - three defensible numbers, three different
  questions, two words. Each is labelled and none is wrong; whether an executive
  board should carry more than one is the design-doc owner's call. Related to
  D-19, and cheap to change (drop the legend average, or name it).
- **What `%Achievement` is called (§4.6i)** - the denominator is the loaded
  order's lot size, and the operator board labels the same figure
  `%AR (PROGRESS)`. Our exec card says `%Achievement`, which an executive will
  read as attainment against today's plan. Needs a label or tooltip decision
  from the design-doc owner; the number itself is confirmed correct against the
  board. If a shift/daily target is what the exec view should show, that is a
  **different source** - no column in `production_machine_io` carries one.
- **The %OA window (§4.6c)** - 24 h today, but the reconciliation could not
  distinguish it from "today" or "current shift" because every live order had
  started inside the current day shift. Revisit with an order that spans two
  shifts. Related: D-24 (breaks, holidays, OT in the time base).
- **Why a running machine reports no order (§4.6e)** - most machines emit
  `ProductionOrder0 = '-'`, `qty = 0`, `std_time = 0` with `cycle_time`
  ticking, including ones sitting in `Mass Pro`. The old board has the same
  hole, so the tile speaks for a minority of the running fleet. Question for
  the IoT owner.

- **D-17** - 3 InfluxDB datasource UIDs: one instance or three? **Partially
  answered 2026-08-25:** the instance we hold credentials for carries THS and
  ASI but **no STJ data at all** (§4.3b), which points to at least one other
  instance. Get the remaining UIDs' connection details.
- **Order-End layer 1 SQL** - unverifiable without the original Grafana JSON
  exports. Get them before trusting Phase 2's classification.
- **~~zAlert data source~~ - SUPERSEDED 2026-08-25.** `production_alarm_logs`
  does carry `severity`, `alarm_class`, `alarm_id`, `message` and
  `is_standstill` (§4.3e). Only `zAlert.owner` has no source. See Phase 4's
  revised Q-06.
- **`codeCompany` NULL on 98.6% of status rows** (§4.3a) - is this an upstream
  pipeline bug to be fixed at source, or is deriving company from `plant` the
  permanent answer? Affects Q-01/Q-02 directly.
- **Queries beyond 3 days return HTTP 500 with an empty body** (§4.2) - cause
  unknown, needs someone with InfluxDB host log access.
- **Database is named `iot_data_global_test`** - confirm whether a separate
  production database exists, and whether these findings transfer to it.
- **Machine counts disagree with `masterData.ts`** for THS 6332 (10 expected
  vs 25-26 present) and 6338 (6 vs 1); 6337 and 6321 have no data (§4.3c).
  Reconcile before Q-02's shortfall logic can mean anything.
- **D-18** (MSSQL defect data on the exec dashboard) - explicitly out of
  scope; `mssql` client to be scaffolded but unused by routes.
- **D-08/D-09** (auth/authz) - deferred via the no-op `server/src/plugins/auth.ts`,
  architecturally ready (`request.user`, CORS `credentials: true` already
  configured) but not implemented.
- ~~**`docs/global-executive-dashboard.html`'s company-level `grafana_url`
  pattern** (`/d/adz5fli?...`)~~ - **closed 2026-08-28.** `adz5fli` is the
  board this app replaces (DESIGN.md §1) and has no `Company_var`, so every
  such link opened a dashboard that ignored it. Both link sites - the ranking
  row's ↗ and the drawer's "Open in Grafana" - now point into the plant board
  `adz5fll` (`Machine Status V2.0`), built by `machineStatusUrl` in
  `packages/domain-shared/src/grafana.ts`. A company link resolves to one of
  its own plants (the first that is reporting; `null` for a site with no
  plants). Two things worth knowing:
    - The instance is `http://10.200.129.66:3000`, in
      `public/config/runtime-config.json` (`grafanaBaseUrl`, the value the
      browser prefixes) **and** `GRAFANA_BASE_URL` (what `/meta` advertises).
      They must name the same host.
    - `var-Zone_var` is sent explicitly, one parameter per zone the plant is
      actually reporting, because zone values are plant-specific: `6051` uses
      `A`-`F`, `6338` uses `A`, `6332` uses `2A-A`..`2B-B`. That is why Q-01
      now selects the `zone` column - nothing else on this board reads it.

## 8. For the next AI/engineer picking this up

1. Read `docs/DESIGN.md` first (the business spec), then this file.
2. Run the verification commands in §4 to confirm the starting state is what
   this document claims.
3. **Read §4.1-4.7 before writing a single Influx query.** InfluxDB
   credentials are in place and connectivity is proven, but the real data
   contradicts this document and DESIGN.md in five places (§4.3) and there are
   two query gotchas that fail silently (§4.2). Starting from the pre-spike
   plan will produce confidently wrong numbers.
4. **Reconcile against the production board, not against the formula.** §4.6 is
   the worked example: the per-machine formula in DESIGN.md §9.1 was correct,
   but the aggregation this project had chosen was 13 points off the screen on
   the shop floor, and a defect that inflates ASI to 419% is invisible from THS
   data alone. A screenshot of the board settled in minutes what the schema
   could not settle at all. Ask for one before building the next KPI.
5. **Ask what the denominator is doing, not only what the number is.** §4.7c is
   the worked example: an hourly average that read as a production story was
   partly a sample-size story, and the count that revealed it existed nowhere on
   the contract. Every ratio this project ships now travels with the count it was
   measured over - `oa_machine_count` on the KPI, `machine_count` on the trend.
6. Keep porting from `src/mocks/` rather than re-deriving from DESIGN.md
   prose (§5) - the mock's test suite is the executable ground truth.
7. Update this document's §4 (what's done) and §6 (what's left) as phases
   land, so it stays trustworthy for whoever reads it next.
