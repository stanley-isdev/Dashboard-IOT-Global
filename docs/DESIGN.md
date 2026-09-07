# One Stanley Narong-Pat Global Executive Dashboard
## Design Document & Project Log - IS Department (CHANGE MODEL 2026 Initiative)

| | |
|---|---|
| **Document version** | v3.1 |
| **Last updated** | 2026-08-04 |
| **Owner** | DXT-IS (Digital Transformation & Information Systems), Thai Stanley Electric PCL. |
| **Current artifact** | `global-executive-dashboard.html` (mockup / static data) |
| **Delivery decision** | **Standalone Web Application** (ไม่ทำใน Grafana) - ดูข้อ 7 |
| **Status** | Mockup approved-in-principle → schema จริงยืนยันแล้ว → รอปิด open decisions ที่เหลือในข้อ 12 |

### Changelog
- **v3.1** - เพิ่ม shift model แบบ n กะ รองรับ THS/ASI (2 กะ) และ STJ (3 กะ, B จบ 22:15 ไม่ตรงขอบชั่วโมง), เปิด D-23…D-26
- **v3.0** - เพิ่ม InfluxDB schema จริง, สูตร %OA/%AR ที่ใช้งานอยู่จริง, ลำดับชั้น Country→Company→Plant→Zone→Machine, status enum, shift/timezone จริง, แหล่งข้อมูล MSSQL (defect) และแก้ความเข้าใจผิดเรื่อง "9 โรงงาน"
- **v2.0** - ปิดประเด็น Grafana vs Web app, เพิ่ม technical debt list / data readiness matrix / data contract / open decisions
- **v1.0** - เอกสารออกแบบเริ่มต้น

---

## 1. Background

จุดเริ่มต้นคือ dashboard เดิมบน Grafana ที่แสดงสถานะเครื่องจักรแบบ grid รายเครื่อง (Running/Stop, %OA, %AR) - เหมาะกับ operator/engineer แต่ไม่ตอบโจทย์ผู้บริหารที่ต้องการภาพรวมเชิงกลยุทธ์

**Dashboard ที่มีอยู่จริงในปัจจุบัน (3 ตัว)**

| ชื่อ | UID | ระดับ | บทบาทหลังจากมี web app |
|---|---|---|---|
| One Stanley Narong-Pat Global V1.0 | `adz5fli` | Grid รายเครื่อง + exec summary bar (แต่กรองทีละ plant) | **ถูกแทนที่ด้วย web app** |
| Machine Status V2.0 | `adz5fll` | Grid รายเครื่องระดับ plant (operator view) | **คงไว้** - ปลายทาง drill-down |
| Production Insight Injection V1.1.0_t01 | `96799488-7d10-4db7-9b0e-508c5f1c0581` | รายเครื่อง / ราย PO + รายชั่วโมง | **คงไว้** - ปลายทาง drill-down ระดับลึกสุด |

> **ข้อค้นพบสำคัญ:** dashboard ที่ชื่อ "Global V1.0" **ยังไม่ global จริง** - query กรอง `plant = '${Lamp_var}'` ทีละโรงงานย่อย และ `Country_var` มีแค่ `TH, JP` แบบ hardcode ดังนั้น **ยังไม่มี query roll-up ระดับ global อยู่เลย** ทีมต้องเขียนใหม่ทั้งหมด (ดูข้อ 10)

---

## 2. Requirements

| หัวข้อ | รายละเอียด |
|---|---|
| กลุ่มผู้ใช้ | ผู้บริหาร (executive) - ภาพรวมสั้น กระชับ ไม่ใช่รายละเอียดรายเครื่อง |
| ตัวชี้วัดสำคัญ | KPI strip 6 การ์ด เห็นครบในหน้าเดียว |
| รูปแบบภาพรวม | world map + ตารางเปรียบเทียบ + กราฟแนวโน้ม + alert list ในหน้าเดียว |
| ข้อมูลต้นทาง | **InfluxDB 3.x (IOx)** + **MSSQL** (defect) - ดูข้อ 8 |
| Map engine | Leaflet.js + react-leaflet, เส้นขอบประเทศ Natural Earth (`public/geo/world-110m.geo.json`) เป็น base layer - **ไม่ใช้ raster tile** เพราะ CARTO เปลี่ยนนโยบาย ไทล์ที่ไม่มี API key ถูกประทับลายน้ำ "API KEY REQUIRED" ทุกใบ (ตอบ 200 OK จึงตรวจจับไม่ได้) และที่ซูมระดับ 9 หมุดบนแผนที่โลก เส้นขอบอ่านง่ายกว่าอยู่แล้ว |
| Theme | Light theme (`--bg:#F4F6FA`) |
| %OA Target | ค่าเริ่มต้น 95% ควบคุมผ่าน `TARGET_OA` จุดเดียว |
| ธงประเทศ | แสดงธงกำกับทุกฐานการผลิต ทั้งบนแผนที่และในตาราง |
| ขอบเขต process | Injection ก่อน (DB มี `Surface`, `Assembly` รออยู่แล้ว → ขยายได้ใน Phase 3) |

---

## 3. ลำดับชั้นข้อมูล (สำคัญมาก - เอกสาร v2.0 เข้าใจผิด)

โครงสร้างจริงมี **5 ระดับ** ไม่ใช่ "1 หมุด = 1 โรงงาน" ตามที่เคยเขียนไว้

```
codeCountry    (Country Code)  ── ประเทศ                  เช่น TH, JP
   └─ codeCompany (Company Code) ── ฐานการผลิต              เช่น THS, ASI, SEH
        └─ plant                  ── โรงงานย่อยภายในฐานฯ     เช่น 6332, 6337, 6338
             └─ zone              ── โซนภายในโรงงาน          เช่น 7 zones ที่ ASI
                  └─ machine      ── เครื่องจักร              เช่น I1, P2I1
```

**ตัวอย่างที่ทราบแล้ว**

| Country | Company | Plant | ชื่อเรียก |
|---|---|---|---|
| TH | THS | 6332 | LAMP 2 |
| TH | THS | 6337 | LAMP 7 |
| TH | THS | 6338 | LAMP 8 |
| TH | THS | 6321 | Auto Bulb |
| TH | ASI | 6051 | (รอยืนยันชื่อ) |

**ผลกระทบต่อการออกแบบ web app**
1. **หมุดบนแผนที่ = ระดับ `codeCompany` (ฐานการผลิต)** ไม่ใช่ plant - เพราะ plant ย่อยอยู่ในพื้นที่เดียวกัน ปักหมุดซ้อนกันไม่มีประโยชน์
2. KPI ต้อง **roll-up หลายชั้น**: machine → plant → company → country → global
3. ตาราง ranking ควรเป็น **expandable** - แถวระดับ company กดขยายเห็น plant ย่อย
4. `TARGET_OA` อาจต้องตั้งได้ต่อ plant ไม่ใช่ค่าเดียวทั้งโลก (D-07)
5. คำว่า "9 โรงงาน" ในเอกสารเก่า **ที่ถูกต้องคือ "9 ฐานการผลิต (companies) ใน 7 ประเทศ"** จำนวน plant รวมทั้งหมดยังไม่ทราบ (D-06)

---

## 4. Master Data ฐานการผลิต (Company level)

รวม **9 ฐานการผลิต ใน 7 ประเทศ**

| Company Code | ชื่อเต็ม | Country Code | Lat | Long | Timezone (IANA) |
|---|---|---|---|---|---|
| THS | Thai Stanley Electric Public Co., Ltd. | TH | 14.006904532327685 | 100.56213418111764 | Asia/Bangkok |
| ASI | Asian Stanley International Co., Ltd. | TH | 14.045689204453973 | 100.43391089831499 | Asia/Bangkok |
| VNS | Vietnam Stanley Electric Co., Ltd. | VN | 21.0078991790763 | 105.96337126776004 | Asia/Ho_Chi_Minh |
| ISE | PT. Indonesia Stanley Electric | ID | -6.2555455142982845 | 106.49968179637503 | Asia/Jakarta |
| STJ | Stanley Electric Co., Ltd. (Japan) | JP | 35.38815535277727 | 139.2082217038006 | Asia/Tokyo |
| SUS | Stanley Electric U.S. Co., Ltd. (Ohio) | US | 39.92641143817483 | -83.41551660704249 | America/New_York |
| IIS | I I Stanley Co., Inc. (Michigan) | US | 42.3364642871659 | -85.2757240901681 | America/Detroit |
| SMX | Stanley Electric Manufacturing Mexico | MX | 21.39244045633582 | -101.87831543037854 | America/Mexico_City |
| SEH | Stanley Electric Hungary Kft. | HU | 47.75733069569861 | 19.953289541127084 | Europe/Budapest |

> คอลัมน์ Timezone เป็นค่าที่ **เสนอ** ให้เก็บเป็น master data (ไม่คำนวณจาก lat/long ตอน runtime) - ดู D-04 และข้อ 9.6

**Country code ที่ระบบรองรับอยู่จริงตอนนี้:** `TH`, `JP` เท่านั้น (hardcode ใน `Country_var`) - อีก 5 ประเทศยังไม่มีข้อมูลเข้าระบบ

---

## 5. โครงสร้างหน้าจอ (ตรงกับ HTML ปัจจุบัน)

```
┌─────────────────────────────────────────────────────────────┐
│  Topbar: โลโก้ One Stanley Narong-Pat (เต็มรูป), ชื่อ dashboard, │
│          filter chips (Region / Process / Range), live badge  │
├─────────────────────────────────────────────────────────────┤
│  KPI Strip (6 การ์ด):                                         │
│  Total Machines | Running | Stopped | Global %OA Avg |        │
│  Global Achievement | Plants Needing Attention                │
├───────────────────────────────┬───────────────────────────────┤
│  World Map (Leaflet 1.9.4)     │  Ranking Table                │
│  grid 1.5fr                    │  grid 1fr                     │
│  - หมุด = ระดับ company         │  - เรียงจาก %OA ต่ำสุดก่อน      │
│  - %OA + ธง + run/total        │  - ขยายดู plant ย่อยได้         │
├───────────────────────────────┼───────────────────────────────┤
│  Global %OA Trend (24h line)  │  Longest Active Stops (top 10) │
└───────────────────────────────┴───────────────────────────────┘
Responsive: < 1100px → KPI 3 คอลัมน์, main/bottom เป็น 1 คอลัมน์
```

### หลักการออกแบบสำคัญ
- KPI คำนวณจากข้อมูลที่ backend ส่งมา ไม่ hardcode
- `TARGET_OA` คุม legend, สี tier และเส้น target บนกราฟ
- **Tier logic (web app):** `oa >= TARGET_OA-5` → เขียว · `oa >= TARGET_OA-20` → เหลือง · ต่ำกว่า → แดง
- ⚠️ **Grafana เดิมใช้เกณฑ์คนละชุด** (`>=95` เขียว / `>=80` เหลือง / `<80` แดง) - ต้องเลือกใช้ชุดเดียวกัน ไม่งั้นสีบน exec dashboard กับ operator dashboard จะไม่ตรงกัน (D-16)

### Technical debt ใน mockup ที่ต้องแก้
| # | ปัญหา | ความสำคัญ |
|---|---|---|
| T-01 | ~~KPI "Global Achievement" ยัง hardcode `Plan 14,200 / Actual 11,590`~~ | ✅ แก้แล้ว - backend ส่ง `plan_qty`/`actual_qty`/`achievement_pct` จริงจาก Influx (Q-04, §9.2) เหลือแค่ตัดสินใจเรื่อง label |
| T-02 | Static fallback `9 plants · 6 countries` → ต้องเป็น `9 bases · 7 countries` | ต่ำ |
| T-03 | ~~`<span>` ไม่ปิด tag ใน topbar~~ | ✅ แก้แล้ว |
| T-04 | Trend chart ใช้สี hardcode `#2FD9B3`, `#F0A93C` (เหลือจาก dark theme) | กลาง |
| T-05 | Trend data เป็น mock `Math.sin() + Math.random()` | สูง |
| T-06 | ซ่อน map attribution (`attributionControl:false`) - **ผิด license CARTO/OSM** | สูง (legal) |
| T-07 | `zoomControl:false` - จอ TV / touch ซูมไม่ได้ | กลาง |
| T-08 | ชื่อบุคคลใน alert (`Contact: Pi Surapoj`) hardcode | กลาง |
| T-09 | Filter chips ยังไม่ทำงาน | สูง |
| T-10 | `sev-dot` สีแดงตายตัว ไม่มี severity mapping | ต่ำ |
| T-11 | ไม่มี stale-data handling → ไซต์ที่ขาดการเชื่อมต่อจะดูเหมือน "Stop" | **สูงมาก** |
| T-12 | Leaflet + Google Fonts โหลดจาก public CDN - เครือข่ายโรงงานที่ปิด internet จะพัง | สูง |
| T-13 | ไม่มี per-plant last-updated timestamp | สูง |
| T-14 | หมุด/ตารางออกแบบเป็น flat 9 รายการ ยังไม่รองรับลำดับชั้น company→plant | สูง |

---

## 6. ไฟล์ที่เกี่ยวข้อง

| ไฟล์ | คำอธิบาย |
|---|---|
| `global-executive-dashboard.html` | Mockup ล่าสุด - Leaflet.js, โลโก้ฝัง base64, static/mock data |
| `Readme.md` | เอกสารฉบับนี้ |
| Grafana JSON × 3 | `adz5fli`, `adz5fll`, `96799488-…` - ใช้เป็น reference schema |

**External dependencies ที่ต้องเปลี่ยนเป็น self-host (T-12):** `unpkg.com/leaflet@1.9.4`, `fonts.googleapis.com`, `basemaps.cartocdn.com`

---

## 7. Delivery Decision - ทำเป็น Web Application (ปิดแล้ว)

> **ยกเลิกแนวทาง Grafana panel - พัฒนาเป็น standalone web application**

**เหตุผล**
1. `marcusolsson-dynamictext-panel` มีปัญหา plugin/renderMode และการ re-initialize Leaflet ทุกครั้งที่ refresh
2. Layout ที่ออกแบบต้องการ control ระดับ DOM และการคำนวณข้าม panel ซึ่ง Grafana ให้ไม่ได้
3. ต้องการ custom interaction (filter, drill-down, TH/EN, kiosk mode)
4. **เหตุผลใหม่จากการอ่าน JSON:** business logic ปัจจุบันกระจายอยู่ 3 ที่ - SQL, Handlebars template และ `afterRender` JavaScript (~400 บรรทัด) ทำให้แก้และทดสอบยากมาก ย้ายมา web app จะรวม logic ไว้ที่ backend ที่เดียว

**สิ่งที่ยังใช้ Grafana ต่อ:** `Machine Status V2.0` และ `Production Insight Injection` คงไว้เป็นปลายทาง drill-down (reuse ไม่ต้องสร้างใหม่)

**Architecture ที่เสนอ (รอ approve - D-01)**
```
[แต่ละไซต์]  Machine → PLC/Gateway → Node-RED → Telegraf (inject site tags)
                                                      │
                                    ┌─────────────────┴─────────────────┐
                                    ▼                                   ▼
                          InfluxDB 3.x (IOx)                    MSSQL (SAP backflush)
                          production_machine_*                  View_Prodresult_log
                                    │                                   │
                                    └─────────────┬─────────────────────┘
                                                  ▼
                                   Backend API (Node.js / FastAPI)
                                   - roll-up KPI, คำนวณ %OA/%AR/defect
                                   - cache 30–60s
                                   - เก็บ credential ฝั่ง server
                                                  │  HTTPS / JSON
                                                  ▼
                                   Executive Web App (Leaflet + JS)
```
**ข้อห้าม:** ห้ามให้ browser ยิงตรงไป InfluxDB / MSSQL - credential จะหลุดใน front-end

---

## 8. InfluxDB / MSSQL Schema จริง (สกัดจาก Grafana JSON)

### 8.1 Datasources

| ประเภท | UID | หมายเหตุ |
|---|---|---|
| InfluxDB | `cfu50cyl65atcf` | ใช้มากที่สุด |
| InfluxDB | `effjyro3t75dse` | ใช้ในบาง panel ของ Machine Status V2.0 |
| InfluxDB | `efsxuxdu4ei9se` | ใช้ใน variable query บางตัว |
| MSSQL | `bffvnqq5fz3lsf` | database `BackflushHana_PRD` |

> ⚠️ **มี InfluxDB datasource UID ต่างกัน 3 ตัวปนกันอยู่ในหน้าเดียว** ต้องยืนยันว่าเป็น instance เดียวกันหรือคนละตัว (D-17) - ถ้าคนละตัวจะเป็นสาเหตุให้ตัวเลขไม่ตรงกันได้

### 8.2 Query language - **ปิด D-03 แล้ว**
`"dataset": "iox"` + syntax `date_bin()`, `date_part()`, `ROW_NUMBER() OVER`, `::FLOAT`, `INTERVAL '1 days'`
→ เป็น **InfluxDB 3.x (IOx) SQL / FlightSQL บน DataFusion** ไม่ใช่ Flux และไม่ใช่ InfluxQL

**ข้อจำกัดที่เจอมาแล้ว:** DataFusion **ไม่รองรับ `Integer * Interval`** ต้องฝังตัวเลขใน string literal (`INTERVAL '${TzOffsetHours:raw} hours'`) - ข้อจำกัดนี้จะหายไปเมื่อย้ายมาคำนวณที่ backend

### 8.3 Measurements

**`production_machine_io`** - ข้อมูลการผลิตหลัก (1 row ≈ 1 shot)

| กลุ่ม | Columns |
|---|---|
| Hierarchy (tags) | `codeCountry`, `codeCompany`, `plant`, `zone`, `machine`, `process`, `mainGroup` |
| Context | `mode` (`Auto`/`Manual`), `shift` (`dayShift`/`nightShift`), `template` (`01`/`03`) |
| Production Order ×4 | `ProductionOrder0..3` |
| Part info ×4 | `icsno0..3`, `icsname0..3`, `vIcsName0..3` |
| Plan ×4 | `plan_qty0..3` |
| PO create date ×4 | `vCreateDateTxt0..3` |
| Metrics | `qty` (pcs/shot), `cavity` (ใช้นับ shot), `std_time`, `cycle_time`, `avr_cycle_time` |
| Timing detail | `time_mold_opening`, `time_mold_end`, `time_injection` |

**`production_machine_status`** - สถานะ realtime ต่อเครื่อง

| Columns |
|---|
| `codeCountry`, `codeCompany`, `plant`, `zone`, `machine`, `process` |
| `Result` (สถานะ), `StatusStartTime`, `time` |

**`production_machine_state`** - สถานะระดับ step ในรอบการฉีด

| Columns | ค่าที่พบใน `step_name` |
|---|---|
| `plant`, `machine`, `step_name`, `time` | `Injection`, `Manual Step`, `MoldClose`, `MoldOpen`, `Mold_Being_Open`, `Mold_Open_End`, `Stop` |

**`BackflushHana_PRD.dbo.View_Prodresult_log`** (MSSQL) - ข้อมูลของเสียจาก SAP

| Columns ที่ใช้ | หมายเหตุ |
|---|---|
| `ProductionOrder`, `trans_type`, `trans_qty`, `end_date`, `remark` | `trans_type='DEFECT'` · `remark='WFA'` แยกเป็นเศษวัสดุ (Kg) |

> ⚠️ **แหล่งข้อมูลนี้ไม่มีในเอกสาร v2.0 เลย** และเป็น MSSQL คนละระบบกับ Influx - ต้องรวมเข้า data contract และตัดสินใจว่าจะเอา defect ขึ้น exec dashboard หรือไม่ (D-18)

### 8.4 Status enum (`production_machine_status.Result`)

| ค่า | ความหมาย | นับเป็น | ที่มา |
|---|---|---|---|
| `Mass Pro` | ผลิตปกติ (mode=Auto) | Running | จาก DB |
| `Dandori` | เปลี่ยนรุ่น / setup (mode≠Auto) | Running | จาก DB |
| `Stop` | หยุด | Stopped | จาก DB |
| `4M Change` | เปลี่ยน 4M | ❓ ยังไม่กำหนด (D-21) | จาก DB |
| `No Plan` | ไม่มีแผนผลิต | ไม่นับ | จาก DB |
| `Order End` | PO จบแล้ว | ไม่นับ | **คำนวณ ไม่ใช่ค่าจาก DB** |
| `Offline` | เครื่องออฟไลน์ | ไม่นับ | **มีใน CSS/legend แต่ยังไม่มี logic สร้างค่านี้** |

> **`Order End` เป็น derived status 2 ชั้น:**
> 1. SQL ตั้งเป็น `Order End` เมื่อ `global_machine_seq > 1`
> 2. JavaScript `afterRender` เปลี่ยนเป็น `Order End` เพิ่มอีก ถ้า `vCreateDateTxt` ไม่ตรงกะปัจจุบัน
>
> **web app ต้อง reimplement logic นี้ที่ backend ให้ครบทั้ง 2 ชั้น** ไม่งั้นจำนวน Running/Stopped จะไม่ตรงกับ Grafana

> **`Offline` คือช่องว่างที่ตรงกับ T-11 เป๊ะ** - ไม่มีโค้ดส่วนใดสร้างสถานะนี้ ดังนั้นเครื่องที่ telemetry หลุดจะค้างสถานะเดิมไว้ตลอด ไม่ได้ขึ้น Offline

### 8.5 การนับ Shot vs Pieces
- **Shot** = `COUNT("cavity")` (จำนวนรอบฉีด)
- **Pieces** = `SUM("qty")` (จำนวนชิ้น)

ต้องระวังไม่สลับกัน - dashboard รายชั่วโมงมีทั้ง 2 แถวคู่กัน (หน่วย `(Shot)` และ `(Pcs)`)

---

## 9. สูตรคำนวณจริง - **ปิด D-02 แล้ว**

### 9.1 %OA
คำนวณด้วย SQL ระดับ **(Group_PO × machine)** โดย `Group_PO` = `PO0_PO1_PO2_PO3` ต่อกันด้วย `_`

```sql
OA_percent =
  ( MIN(std_time) * SUM(qty) )
  / NULLIF( SUM( CASE WHEN cycle_time > (std_time + 100)
                      THEN std_time  * qty
                      ELSE cycle_time * qty END ), 0 )
  * 100
```

**สิ่งที่ต้องรู้ก่อนเอาไปแสดงให้ผู้บริหาร**
1. **เงื่อนไข `cycle_time > std_time + 100` ทำให้รอบที่ยาวผิดปกติถูกตัดทิ้ง** (แทนด้วย `std_time`) → **การหยุดเครื่องนานๆ ไม่ถูกนับเป็นการสูญเสียใน %OA** ตัวเลขนี้จึงใกล้ "cycle efficiency" มากกว่า OEE-availability ตามตำรา
2. **ผู้บริหารอาจตีความ %OA ผิด** ถ้าเข้าใจว่าเป็น availability จริง - ควรตั้งชื่อ / ใส่ tooltip ให้ชัด (D-19)
3. **threshold ไม่สอดคล้องกันในโค้ดเดียว** - `SumCycle` ใช้ `std_time + 20` แต่ `OA_percent` ใช้ `std_time + 100` ต้องยืนยันว่าตั้งใจหรือเป็น bug (D-22)
4. `MIN(std_time)` ใช้ในตัวตั้ง แต่ `MAX(std_time)` ใช้ในคอลัมน์ `STD_Time` - ถ้า `std_time` เปลี่ยนกลาง PO ผลจะเพี้ยน
5. ค่านี้เป็น **%OA ต่อ (PO × machine)** → การหา **"Global %OA Avg" ต้องตัดสินใจวิธี aggregate** (D-20): simple average ต่อเครื่อง (แบบที่ exec bar ทำอยู่) หรือ weighted ด้วยจำนวนชิ้น/เวลา - สองวิธีให้ตัวเลขต่างกันมาก

### 9.2 %AR (Achievement Rate)
```sql
TotalPlan    = MAX(plan_qty0) + MAX(plan_qty1) + MAX(plan_qty2) + MAX(plan_qty3)
OutputActual = SUM(qty)                       -- ต่อ Group_PO × machine
AR_percent   = (OutputActual / TotalPlan) * 100   -- ถ้า TotalPlan = 0 → null (ไม่ใช่ 0)
```
Progress bar แสดงสูงสุด 100% แต่ข้อความแสดงค่าจริงที่เกิน 100% ได้

**แก้ตามข้อมูลจริง (2026-08-25) - ยืนยันกับ InfluxDB จริงแล้ว:**
1. **`plan_qty` ต้องใช้ `MAX` ห้าม `SUM`** - มันเป็น attribute ของ **order** ที่ถูก repeat ทุกแถว shot ไม่ใช่ยอดต่อ shot วัดแล้วทุก group `(plant, machine, PO slots)` ทุก plant ในหน้าต่าง 24 ชม. มี `COUNT(DISTINCT plan_qty0) = 1` ไม่มีข้อยกเว้น → ถ้า SUM: plan ของ I5 (400) จะกลายเป็น 400 × 295 แถว = **118,000** และ %AR = 0.25%
2. **`TotalPlan = 0` → `null` ไม่ใช่ `0`** - override ข้อความเดิมในหัวข้อนี้ ตาม rule R2 ของ data contract (ไม่มีข้อมูล ≠ ศูนย์) THS 6338 ส่ง `plan_qty = 0` ทุกแถว → การ์ดต้องขึ้น "ไม่มีแผน" ไม่ใช่ 0%
3. **slot ของ plan ตรงกับ slot ของ PO เป๊ะ** - `plan_qtyN > 0` เมื่อและเมื่อ `ProductionOrderN` มีค่า (46,962 แถว 0 ข้อยกเว้น)
4. **`plan_qty` = lot size ของ order ไม่ใช่เป้าของกะ/วัน** - ASI ทุก order = 700 เท่ากันหมด, THS = 400/309/220/816 ตามใบสั่งจริง บอร์ด operator เรียกตัวเลขนี้ว่า **`%AR (PROGRESS)`** ซึ่งตรงกว่า: มันคือ "เดินไปถึงไหนของ order ที่โหลดอยู่" เครื่องที่เพิ่งเริ่ม order 816 ชิ้นอ่านได้ 12% อย่างถูกต้อง แต่ผู้บริหารอ่าน "%ความสำเร็จตามแผน" แล้วจะเข้าใจว่า "ไม่ทันแผนวันนี้" → **ต้องตัดสินใจเรื่อง label/tooltip** (ดีเฟกต์รูปเดียวกับ D-19 ของ %OA) ถ้าต้องการเป้าต่อกะจริง **ไม่มีคอลัมน์ไหนใน `production_machine_io` เก็บไว้** ต้องหาแหล่งใหม่
5. **scope = order ที่โหลดอยู่เดี๋ยวนี้** (group ที่ถือ `MAX(time)` ต่อเครื่อง) เหมือน %OA และเหมือนบอร์ด - วัดเทียบกันบน 6332 ช่วงเดียวกัน: current order = 4 เครื่อง Σplan 1,745 / Σactual 701 → **40.2%** · ทุก order ใน 24 ชม. = 13 เครื่อง Σplan 16,881 / Σactual 2,080 → 12.3% เหตุผลที่เลือกแบบแรกไม่ใช่เรื่องสถิติ: การ์ดแสดง plan, actual และ % พร้อมกัน คนอ่านที่เอาสองตัวแรกมาหารต้องได้ตัวที่สาม
6. **เครื่องที่รันหลาย order พร้อมกัน - ยืนยันกับบอร์ดแล้ว (2026-08-26)** ทั้ง %OA และ %AR รายงานตามสูตรตรงตัว ไม่กันออกและไม่หารด้วยจำนวน slot · เครื่อง I5 ที่ 6332 รัน 2 ใบสั่ง บอร์ดขึ้น %OA 105.9% / %AR 33.9% (plan 502+502 = 1,004) เราคำนวณได้ตรงกันทั้งคู่ · บอร์ดเดิมทำเครื่องหมาย `(+1)` ต่อท้ายเลขใบสั่งเพื่อบอกว่ามีใบที่ 2 (D-27 ปิดแล้ว)

### 9.3 Output per Hour
```sql
OutputperHr = SUM( CASE WHEN date_bin(INTERVAL '1 hour', time + interval '7 hours')
                         = date_bin(INTERVAL '1 hour', now() + interval '7 hours')
                        THEN qty ELSE 0 END )
```

### 9.4 Defect / Defect Rate (MSSQL)
```sql
Defect      = SUM(trans_qty) WHERE trans_type='DEFECT' AND remark != 'WFA'   -- Pcs
WFA         = SUM(trans_qty) WHERE trans_type='DEFECT' AND remark  = 'WFA'   -- Kg
Defect Rate = Defect / OutputActual(mode='Auto') * 100
```
กรอง `ProductionOrder IN (PO0..PO3)` และ `end_date >= วันนี้ - 10 วัน`

### 9.5 Shift - **จำนวนกะไม่เท่ากันในแต่ละ Company** (ประเด็นใหญ่)

> **แก้ความเข้าใจผิดในเอกสาร v1/v2 สองชั้น:**
> 1. ไทยไม่ใช่ 3 กะ A/B/C - เป็น **2 กะ**
> 2. แต่ก็ไม่ใช่ 2 กะทั้งกลุ่ม - **STJ ใช้ 3 กะ** ดังนั้นระบบต้องรองรับ **จำนวนกะที่ต่างกันต่อ company** ไม่ใช่ค่าคงที่ทั้งระบบ

**รูปแบบกะที่ยืนยันแล้ว**

| Company | จำนวนกะ | รหัส | เวลา | ข้ามเที่ยงคืน |
|---|---|---|---|---|
| THS | 2 | `D` | 08:00 – 20:00 | - |
| THS | 2 | `N` | 20:00 – 08:00 | ✅ |
| ASI | 2 | `D` | 08:00 – 20:00 | - |
| ASI | 2 | `N` | 20:00 – 08:00 | ✅ |
| STJ | 3 | `A` | 06:00 – 14:00 | - |
| STJ | 3 | `B` | 14:00 – **22:15** | - |
| STJ | 3 | `C` | **22:15** – 06:00 | ✅ |
| VNS, ISE, SUS, IIS, SMX, SEH | ❓ | - | รอยืนยัน | - |

#### ผลกระทบทางเทคนิค (สำคัญมาก - อ่านก่อนเริ่มเขียนโค้ด)

**① `22:15` ทำให้ logic รายชั่วโมงเดิมใช้ไม่ได้**
Dashboard รายชั่วโมงปัจจุบันใช้ `date_part('hour', time + interval '7 hours') = 8, 9, 10 …` คือแบ่งเป็น **ช่องชั่วโมงเต็ม 12 ช่อง** ซึ่งสมมติว่ากะเริ่ม-จบตรงขอบชั่วโมงเสมอ
→ กะ B ของ STJ จบ 22:15 ทำให้ **ชั่วโมง 22:00–23:00 คาบเกี่ยว 2 กะ** logic เดิมจะนับผิดทันที
→ **ต้องเปลี่ยนวิธี bucket** เป็นอย่างใดอย่างหนึ่ง:
- ใช้ **shift-relative bucket** (ชั่วโมงที่ 1, 2, 3 … ของกะนั้น) แทนเวลานาฬิกาจริง - แนะนำวิธีนี้ เพราะเทียบข้ามไซต์ได้ตรงกว่า
- หรือ bucket ตามเวลาจริงแต่คำนวณด้วย **timestamp ระดับนาที** ไม่ใช่ `date_part('hour')`

**② จำนวนคอลัมน์ในหน้าจอต้องยืดหยุ่น**
2 กะ → 12 ช่อง/กะ · 3 กะ → 8 ช่อง (A), 8 ช่อง 15 นาที (B), 7 ช่อง 45 นาที (C) ไม่เท่ากัน
→ UI ที่ hardcode `08:00 - 09:00` … 12 คอลัมน์ ใช้ซ้ำกับ STJ ไม่ได้ ต้อง generate จาก config

**③ tag `shift` ใน InfluxDB มีแค่ 2 ค่า**
ปัจจุบัน DB เก็บ `dayShift` / `nightShift` เท่านั้น → **ถ้าจะรับข้อมูล STJ ต้องขยาย enum เป็น `A`/`B`/`C` ด้วย** ซึ่งเป็นการแก้ที่ **Node-RED / gateway ฝั่งไซต์** ไม่ใช่แก้แค่ dashboard
→ ทางเลือก: เปลี่ยนไปใช้ `shift_code` เป็นค่ากลาง (`D`,`N`,`A`,`B`,`C`) หรือให้ gateway ไม่ต้องคำนวณกะเลย แล้วให้ backend derive จาก timestamp + shift config (แนะนำวิธีหลัง - แก้ที่เดียว ไม่ต้องไปแตะ gateway ทุกไซต์)

**④ Production date rule ต้องเป็นค่า config ไม่ใช่ hardcode**
เดิม hardcode ว่า "ก่อน 08:00 = วันก่อนหน้า" ซึ่งผูกกับกะไทยเท่านั้น
→ STJ กะ C เริ่ม 22:15 ข้ามเที่ยงคืน ต้องกำหนดว่ากะนั้นเป็นวันผลิตของ**วันที่เริ่มกะ** (anchor = start) หรือวันที่จบ

#### Shift configuration model ที่เสนอ (master data)

```json
{
  "shift_configs": [
    {
      "company": "THS",
      "effective_from": "2026-01-01",
      "timezone": "Asia/Bangkok",
      "production_date_anchor": "shift_start",
      "shifts": [
        { "code": "D", "label": "Day",   "start": "08:00", "end": "20:00" },
        { "code": "N", "label": "Night", "start": "20:00", "end": "08:00" }
      ]
    },
    {
      "company": "STJ",
      "effective_from": "2026-01-01",
      "timezone": "Asia/Tokyo",
      "production_date_anchor": "shift_start",
      "shifts": [
        { "code": "A", "label": "A Shift", "start": "06:00", "end": "14:00" },
        { "code": "B", "label": "B Shift", "start": "14:00", "end": "22:15" },
        { "code": "C", "label": "C Shift", "start": "22:15", "end": "06:00" }
      ]
    }
  ]
}
```

**ข้อกำหนดของ model นี้**
- รองรับ **n กะ** (2, 3, หรือมากกว่า) ไม่ fix จำนวน
- รองรับเวลาที่ **ไม่ตรงขอบชั่วโมง** (ระดับนาที)
- กะที่ `end <= start` ถือว่าข้ามเที่ยงคืนโดยอัตโนมัติ
- `effective_from` ทำให้เปลี่ยนรูปแบบกะในอนาคตได้โดยไม่ทำลายข้อมูลย้อนหลัง (เช่น ไซต์เปลี่ยนจาก 2 กะเป็น 3 กะช่วง peak)
- ถ้าไซต์ใดมี plant ย่อยที่กะไม่เหมือนกัน ต้องรองรับ override ระดับ plant ด้วย (D-23)
- **ยังต้องเก็บเพิ่ม:** เวลาพักเบรก/พักกลางกะ, รูปแบบวันหยุด/วันเสาร์, และ OT ต่อท้ายกะ - สิ่งเหล่านี้กระทบการคำนวณ %OA ถ้านับเวลาที่ควรเดินเครื่อง (D-24)

#### สิ่งที่ต้องแสดงบน exec dashboard
เมื่อกะแต่ละไซต์ไม่ตรงกัน คำว่า "กะนี้" ไม่มีความหมายเดียวทั้งหน้าจอ
→ **ตาราง ranking ต้องแสดง shift code + local time ของแต่ละไซต์กำกับ** เช่น `STJ · B Shift · 15:42 JST` ไม่งั้นผู้บริหารจะเทียบตัวเลขข้ามไซต์แบบเข้าใจผิด (ผูกกับ D-04)

### 9.6 Timezone - **ปิด D-04 (บางส่วน) แต่มีปัญหาต้องแก้**

**สถานะปัจจุบัน: มี 3 วิธีปนกันอยู่ในระบบเดียว**

| วิธี | ที่ใช้ | ปัญหา |
|---|---|---|
| Hardcode `+ interval '7 hours'` | SQL หลายที่ใน dashboard รายชั่วโมง | ล็อกไว้ที่ไทยตายตัว ใช้กับไซต์อื่นไม่ได้ |
| Variable `TzOffsetHours` (7, 0, -5, -4, 9) | บาง panel | **เป็น fixed offset ไม่รองรับ DST** → US/HU/MX เพี้ยนปีละ 2 ครั้ง และยังขาด VN(+7), ID(+7), HU(+1/+2), MX(-6) |
| `Intl.DateTimeFormat` + `${__timezone}` | `afterRender` ของ Machine Status V2.0 | ✅ **วิธีที่ถูกต้อง** รองรับ DST |

**Dashboard timezone setting ก็ไม่ตรงกัน:** `adz5fli` และ `adz5fll` = `Asia/Bangkok` ส่วน `96799488-…` = `browser`

**ข้อสรุปสำหรับ web app**
- ข้อมูลใน Influx เก็บเป็น **UTC** (ยืนยันจาก comment ในโค้ด V2.0)
- เก็บ **IANA timezone name เป็น master data ต่อ company** (ตามข้อ 4) - **ห้ามใช้ fixed offset**
- คำนวณ shift / production-date ที่ **backend** ด้วย IANA tz ของไซต์นั้น
- **ยังต้องตัดสินใจ (D-04):** exec dashboard แสดง "วันนี้/กะนี้" ตามเวลาท้องถิ่นแต่ละไซต์ หรือ normalize เป็นเวลาไทยทั้งหมด
  → *คำแนะนำ:* คำนวณตามเวลาท้องถิ่น (สะท้อนความจริงหน้างาน) แต่แสดง local time กำกับในตารางเพื่อไม่ให้ผู้บริหารสับสน

---

## 10. Query ที่ทีมต้องเขียนใหม่ (ไม่มีของเดิมให้ copy)

Dashboard เดิมทุกตัวกรองทีละ plant → **ไม่มี roll-up query ระดับ global เลย** สิ่งที่ต้องสร้าง:

| # | Query | หมายเหตุ |
|---|---|---|
| Q-01 | สถานะล่าสุดต่อเครื่อง **ทุก company** ในครั้งเดียว | `ROW_NUMBER() OVER (PARTITION BY codeCompany, plant, machine ORDER BY time DESC)` |
| Q-02 | นับ Running / Stopped / No Plan / Order End roll-up ตามลำดับชั้น | ต้อง reimplement logic `Order End` ทั้ง 2 ชั้น |
| Q-03 | %OA เฉลี่ยต่อ plant → company → global | ✅ **ทำแล้ว** - `server/src/domain/oa.ts` (ปิด D-20 แล้ว) |
| Q-04 | %Achievement roll-up (Σplan / Σactual) | ✅ **ทำแล้ว** - `achievementFrom()` · plan อ่านด้วย `MAX` ไม่ใช่ `SUM` (เป็น attribute ของ PO ซ้ำทุกแถว) · ยืนยันกับบอร์ด I5: 295/400 = 73.8% · **PO เดียวหลายเครื่อง: วัดแล้วไม่พบ** (26 orders, 0 เคสใช้ร่วม) - ยังไม่ถูก disprove แค่ยังไม่เกิด · เครื่องหลาย slot ใช้งานจริงและทดสอบแล้ว (ASI `plan_qty1..3` = 700 ต่อ slot) |
| Q-05 | Trend %OA 24 ชม. แบ่ง bucket 1 ชม. | ✅ **ทำแล้ว** - `server/src/domain/trend.ts` · `date_bin(INTERVAL '1 hour', time)` bucket ตามนาฬิกา UTC 24 จุด จุดสุดท้ายคือชั่วโมงที่กำลังเดินอยู่ · **ในเครื่องเดียวกันชั่วโมงเดียวกัน ถ้ามีหลายใบสั่ง บวกตัวตั้ง/ตัวหารก่อนแล้วค่อยหาร** (11 จาก 287 machine-hour) · **ข้ามเครื่องใช้ค่าเฉลี่ยอย่างง่ายเหมือนการ์ด** (D-20) · ชั่วโมงที่ไม่มีเครื่องไหนโหลดใบสั่งส่ง `null` ไม่ใช่ 0 · ทุกจุดพก `machine_count` ไปด้วย เพราะวัดจริงแล้วแกว่ง **1 ถึง 18 เครื่อง** ใน 24 ชม. ขณะที่ `site_count` อยู่แค่ 1-2 |
| Q-06 | Top-10 longest active stop ข้ามทุกไซต์ | จาก `StatusStartTime` ของ `Result='Stop'` |
| Q-07 | **Last-seen ต่อ plant** (สำหรับสถานะ `no_data`) | ของใหม่ทั้งหมด ไม่มีในระบบเดิม |
| Q-08 | Master list ของ machine ที่ควรมี (สำหรับ Total Machines) | ปัจจุบัน derive จาก run+stop ซึ่งพลาดเครื่องที่ offline |

**ข้อควรระวังที่เจอในโค้ดเดิม**
- **มี machine ถูก exclude แบบ hardcode ใน SQL:** `machine != 'lA1','lA2','D2','D3','D4','P1l4'` → ต้องย้ายไปเป็น master data / config ไม่ใช่ฝังใน query
- **Time window hardcode:** `now() - INTERVAL '1 days'` และ `'72 hours'` กระจายอยู่หลายที่
- ใช้ `FULL JOIN` ระหว่าง status กับ io เพราะเครื่องอาจมีข้อมูลฝั่งเดียว - web app ต้องรองรับกรณีนี้
- `mainGroup` ถูกส่งใน drill-down URL แต่ **ไม่มีใน SELECT** ของ query → ค่าจะว่างเสมอ (bug เดิม)
- Drill-down URL ปัจจุบันส่ง parameter ~40 ตัว รวมชื่อ part และ plan qty ผ่าน query string → **web app ควรส่งแค่ key (company, plant, machine, PO) แล้วให้ dashboard ปลายทาง query เอง**

---

## 11. Data Readiness ต่อฐานการผลิต (ความเสี่ยงอันดับ 1)

| Company | Country code ในระบบ | IoT gateway | Plant ย่อยที่ทราบ | ส่งเข้า Influx กลาง | เจ้าภาพฝั่งไซต์ | Phase |
|---|---|---|---|---|---|---|
| THS | ✅ TH | ✅ | 6332, 6337, 6338, 6321 | ✅ | DXT-IS | 1 |
| ASI | ✅ TH | ✅ | 6051 (+?) | ? | ? | 1 |
| STJ | ✅ JP | ? | ? | ? | ? | 2 |
| SEH | ❌ | 🔄 กำลังติดตั้ง (16 เครื่อง) | ? | ยังไม่ | ? | 2 |
| VNS | ❌ | ❓ | ? | ? | ? | ? |
| ISE | ❌ | ❓ | ? | ? | ? | ? |
| SUS | ❌ | ❓ | ? | ? | ? | ? |
| IIS | ❌ | ❓ | ? | ? | ? | ? |
| SMX | ❌ | ❓ | ? | ? | ? | ? |

**ผลที่ตามมาถ้าไม่ปิดช่องนี้:** ผู้บริหารเห็นแผนที่มี 9 หมุด แล้วเข้าใจว่าข้อมูลครบ ทั้งที่ระบบรองรับแค่ `TH` และ `JP` → **ต้องมีสถานะ `no_data` / `not_connected` ที่ชัดเจน แยกจาก `Stopped` เด็ดขาด** (T-11 + Q-07)

---

## 12. Open Decisions

| ID | ประเด็น | สถานะ |
|---|---|---|
| D-01 | Architecture / tech stack ของ backend | ⬜ |
| D-02 | **สูตร %OA / %AR** | ✅ **ปิดแล้ว** - ข้อ 9 · ยืนยันกับบอร์ดจริงแล้ว (เครื่อง I5: 47.5% / 295 pcs ตรงทศนิยม) เหลือ D-19, D-22 |
| D-03 | **Query language** | ✅ **ปิดแล้ว** - InfluxDB 3.x SQL (IOx / DataFusion) |
| D-04 | Timezone policy: ท้องถิ่นแต่ละไซต์ vs เวลาไทย | 🟡 รู้ข้อจำกัดเทคนิคแล้ว รอ decision เชิงนโยบาย |
| D-05 | รูปแบบ shift ต่อ company | 🟡 THS/ASI = 2 กะ · STJ = 3 กะ (A/B/C, B จบ 22:15) ยืนยันแล้ว · อีก 6 ไซต์รอยืนยัน - ดูข้อ 9.5 |
| D-06 | จำนวน plant และจำนวนเครื่องจริงต่อ plant | ⬜ ผูกกับ Q-08 |
| D-07 | Target %OA - ค่าเดียวทั้งโลก vs ต่อ plant | ⬜ |
| D-08 | Authentication (AD/SSO / local / kiosk) | ⬜ |
| D-09 | Authorization scope (global vs เห็นเฉพาะไซต์ตัวเอง) | ⬜ |
| D-10 | Hosting (on-prem / cloud / container) | ⬜ |
| D-11 | Network reachability จากไซต์ต่างประเทศ | ⬜ |
| D-12 | Target display (desktop / TV 4K / tablet) | ⬜ |
| D-13 | ภาษา (EN only / TH-EN toggle) | ⬜ |
| D-14 | Refresh interval - Grafana เดิมใช้ 5s (สูงมากสำหรับ exec view) | ⬜ แนะนำ 30–60s |
| D-15 | Data governance - ส่ง production data ข้ามประเทศเข้าไทย | ⬜ |
| D-16 | **Threshold สีให้ตรงกัน** - web app (`TARGET−5/−20`) vs Grafana (`95/80`) | ⬜ **ใหม่** |
| D-17 | InfluxDB datasource 3 UID เป็น instance เดียวกันหรือไม่ | ⬜ **ใหม่** |
| D-18 | เอา Defect / Defect Rate (MSSQL) ขึ้น exec dashboard ด้วยหรือไม่ | ⬜ **ใหม่** |
| D-19 | **ชื่อ / คำอธิบาย %OA** - สูตรปัจจุบันตัด downtime ออก ต้องสื่อสารให้ตรง | ⬜ **ใหม่** |
| D-20 | **วิธี aggregate Global %OA** - simple average vs weighted | ✅ **ปิดแล้ว 2026-08-25** - **simple average เฉพาะเครื่องที่มี PO โหลดอยู่** เพราะ reproduce `AVG %OA 69.8%` บนบอร์ดจริงได้ตรงตัว (weighted by qty = 56.8% ต่างกัน 13 จุด บนข้อมูลชุดเดียวกัน) |
| D-21 | `4M Change` นับเป็น Running หรือ Stopped ใน KPI | ⬜ **ใหม่** |
| D-22 | Threshold `std_time+20` vs `std_time+100` ตั้งใจหรือ bug | ⬜ **วัดผลกระทบแล้ว** - ที่ 6332 มี 18 แถวจาก 1,680 เกิน `+100` แต่ 1,114 แถวเกิน `+20` · backend ใช้ `+100` ตาม §9.1 |
| D-23 | กะกำหนดที่ระดับ company หรือต้อง override ระดับ plant ได้ | ⬜ **ใหม่** |
| D-24 | เวลาพักเบรก / วันหยุด / OT - นับรวมในฐานเวลาของ %OA หรือไม่ | ⬜ **ใหม่** |
| D-25 | **ใครคำนวณกะ** - gateway/Node-RED ส่ง tag `shift` มา (ต้องแก้ทุกไซต์) หรือ backend derive จาก timestamp + config (แก้ที่เดียว) | ⬜ **ใหม่** · แนะนำ backend |
| D-26 | Bucket รายชั่วโมง - shift-relative (ชม.ที่ 1,2,3 ของกะ) หรือ clock-time ระดับนาที | ⬜ **ยังเปิด** · Q-05 ทำด้วย **clock-time UTC** ไปก่อน ตามที่ §10 เขียนไว้ตรงตัว และเพราะกราฟรวม THS/ASI (2 กะ) กับ STJ (3 กะ B จบ 22:15) ไว้เส้นเดียว - shift-relative จะไม่มีแกนร่วม · เปลี่ยนทีหลังได้ที่ `machineHourOaSql` + `hourSlots` |
| D-27 | **%OA ของเครื่องที่รันหลาย PO ในช็อตเดียว** - `std_time` เป็นผลรวมของ PO slot ที่เปิดอยู่ แต่ `cycle_time` เป็นรอบฉีดเดียว สูตร §9.1 จึงพองตามจำนวน slot (I4: 57% เดี่ยว vs 114% คู่) | ✅ **ปิดแล้ว 2026-08-26** - **บอร์ดเดิมคำนวณแบบเดียวกัน ไม่ได้หารด้วยจำนวน slot และไม่ได้กันเครื่องออก** · เครื่อง I5 รัน 2 ใบสั่ง (บอร์ดเขียน `110000961179 (+1)`) บอร์ดขึ้น **105.9%** เราคำนวณได้ **105.9%** ตรงกัน · ตรวจพร้อมกัน 4 เครื่อง I1 98.5 / I3 99.7 / I5 105.9 / I6 101.4 ตรงทุกตัว · **backend รายงานตามสูตรตรงตัว ถูกต้องแล้ว** · คำถามที่ว่าเลขเกิน 100% "แปลว่าอะไร" ไปอยู่ที่ D-19 |

---

## 13. Data Contract (ร่าง v2 - ปรับตามลำดับชั้นจริง)

`GET /api/v1/global-overview?range=24h&process=Injection`

```json
{
  "generated_at": "2026-08-04T10:15:00+07:00",
  "target_oa": 95,
  "oa_aggregation": "weighted_by_qty",
  "totals": {
    "machines_total": 0, "machines_running": 0, "machines_stopped": 0,
    "machines_no_plan": 0, "machines_order_end": 0, "machines_no_data": 0,
    "oa_pct": 0.0, "achievement_pct": 0.0,
    "plan_qty": 0, "actual_qty": 0,
    "companies_needing_attention": 0
  },
  "companies": [
    {
      "code": "THS",
      "name": "Thai Stanley Electric PCL.",
      "country_code": "TH",
      "lat": 14.006904, "lng": 100.562134,
      "timezone": "Asia/Bangkok",
      "local_time": "2026-08-04T10:15:00+07:00",
      "shift": {
        "code": "D",
        "label": "Day",
        "index": 1, "of": 2,
        "start_local": "2026-08-04T08:00:00+07:00",
        "end_local": "2026-08-04T20:00:00+07:00",
        "production_date": "2026-08-04"
      },
      "status": "online",
      "last_seen": "2026-08-04T10:14:52+07:00",
      "oa_pct": 83.0,
      "achievement_pct": 88.2,
      "machines_total": 26, "machines_running": 22,
      "machines_stopped": 4, "machines_no_data": 0,
      "plants": [
        {
          "code": "6332", "label": "LAMP 2",
          "status": "online", "last_seen": "2026-08-04T10:14:52+07:00",
          "machines_total": 10, "machines_running": 9, "machines_stopped": 1,
          "oa_pct": 85.4, "achievement_pct": 91.0,
          "plan_qty": 5200, "actual_qty": 4732,
          "grafana_url": "/d/adz5fll?var-Lamp_var=6332&var-process_var=Injection"
        }
      ]
    }
  ],
  "trend": [ { "ts": "2026-08-04T02:00:00Z", "oa_pct": 81.4 } ],
  "alerts": [
    {
      "company": "THS", "plant": "6332", "zone": "Z1", "machine": "I1",
      "reason": "Stop", "severity": "critical", "category": "hardware",
      "started_at": "2026-08-04T03:08:48Z", "duration_sec": 25572,
      "production_order": "110000770055", "part_name": "640A HMSL HSG"
    }
  ]
}
```

**หลักการ**
- Front-end **ไม่คำนวณ business logic** - %OA / %AR / shift / production-date คำนวณที่ backend ทั้งหมด
- ทุกระดับต้องมี `status` + `last_seen` เพื่อรองรับ no-data
- `grafana_url` ส่งมาจาก backend เพื่อไม่ต้อง hardcode UID ใน front-end

---

## 14. Non-Functional Requirements (ร่าง)

| ด้าน | เกณฑ์ที่เสนอ |
|---|---|
| Performance | first paint < 3s, API response < 1.5s |
| Data freshness | ≤ 1 นาที (status), ≤ 5 นาที (trend) - ไม่ต้อง 5s เหมือน Grafana เดิม |
| Concurrent users | ~30 |
| Availability | 08:00–20:00 ICT ต้องพร้อมใช้ |
| Browser support | Chrome / Edge เวอร์ชันปัจจุบัน (รอยืนยัน corporate standard) |
| Failure behavior | backend ล่ม → banner + timestamp ล่าสุด **ห้ามแสดง 0 หรือค่าเก่าเงียบๆ** |
| Accessibility | ห้ามใช้สีเดียวสื่อความหมาย ต้องมี icon / ตัวเลขกำกับ |
| Security | ไม่มี secret ใน front-end, HTTPS only, CORS จำกัด origin |

---

## 15. Timeline การตัดสินใจที่ผ่านมา

1. เห็น dashboard เดิม → ตัดสินใจออกแบบใหม่แบบ global executive view
2. เลือกรูปแบบผสม (map + table + chart)
3. hub-and-spoke → เปลี่ยนเป็น world map จริง
4. เพิ่ม %OA บนแผนที่ + แก้หมุดซ้อน (offset pins, ภายหลังเลิกใช้)
5. dark theme → light theme
6. รับ master data + `TARGET_OA = 95` ปรับได้
7. เพิ่มธงประเทศ
8. พยายามทำเป็น Grafana Business Text panel → เจอปัญหา plugin/renderMode
9. เปลี่ยน map engine เป็น Leaflet.js + เพิ่ม SMX → ครบ 9 ฐานการผลิต 7 ประเทศ
10. ปิดประเด็น platform → **ทำเป็น standalone web app**
11. เปลี่ยนโลโก้ header เป็น "One Stanley Narong-Pat - The Ultimate Target Solution" (ฝัง base64)
12. **(v3.0)** วิเคราะห์ Grafana JSON 3 ตัว → ได้ schema จริง, สูตร %OA/%AR, ลำดับชั้น 5 ระดับ, shift/timezone จริง, แหล่ง MSSQL เพิ่ม → ปิด D-02/D-03 และเปิด D-16…D-22
13. **(ล่าสุด, v3.1)** ได้ข้อมูลกะจริง → **จำนวนกะไม่เท่ากันต่อ company** (THS/ASI 2 กะ, STJ 3 กะ) และกะ B ของ STJ จบ 22:15 ไม่ตรงขอบชั่วโมง → ออกแบบ shift config model แบบ n กะ, เปิด D-23…D-26

---

## 16. Definition of Done (Phase 1)

- [ ] Decision D-01…D-22 ปิดครบและบันทึกในเอกสารนี้
- [ ] Technical debt T-01…T-14 แก้ครบ
- [ ] Query Q-01…Q-08 เขียนและ review แล้ว
  - ✅ Q-01, Q-03, Q-04, Q-05, Q-07 ทำแล้วและมี test
  - ⬜ Q-02 รอ `Order End` · Q-06 รอตัดสินใจเรื่อง `zAlert.owner` · Q-08 ใช้รูปแบบย่อ (นับระดับ plant)
- [ ] **ตัวเลข %OA / %AR / จำนวน Running-Stopped ของอย่างน้อย 2 plant ตรงกับ Grafana เดิม** (reconcile ผ่าน รวมถึง logic `Order End` ทั้ง 2 ชั้น)
  - ✅ **6332 ผ่านแล้ว 2026-08-26** - %OA ตรง 4 เครื่อง (I1 98.5 / I3 99.7 / I5 105.9 / I6 101.4) รวมเครื่องที่รัน 2 ใบสั่ง · %AR ตรง (I5: 340/1,004 = 33.9%)
  - ⬜ plant ที่ 2 ยังไม่ได้ทำ - ASI 6051 ยังไม่มีภาพบอร์ดมาเทียบ
  - ⬜ `Order End` ยังไม่ derive จึงยังเทียบจำนวน Running-Stopped ไม่ได้
- [ ] แสดงสถานะ `no_data` ถูกต้องเมื่อจำลองการตัดการเชื่อมต่อของไซต์
- [ ] Shift / production-date คำนวณถูกต้องเมื่อทดสอบข้ามเที่ยงคืนและข้าม DST
- [ ] **ทดสอบกะ 3 แบบผ่าน:** 2 กะ (THS/ASI), 3 กะที่จบไม่ตรงขอบชั่วโมง (STJ, B จบ 22:15), และกะที่ข้ามเที่ยงคืน (STJ กะ C)
- [ ] เพิ่ม company ใหม่ที่มีจำนวนกะต่างจากเดิมได้โดย **แก้ config เท่านั้น ไม่แก้โค้ด**
- [ ] Attribution ของ CARTO/OSM แสดงบนแผนที่
- [ ] ทำงานได้บนเครือข่ายที่ไม่มี public internet (self-hosted assets)
- [ ] Drill-down จาก web app ไป Grafana ทำงานถูกต้องทุกระดับ
- [ ] UAT กับผู้บริหารอย่างน้อย 2 ท่าน ผ่าน
- [ ] มี runbook + handover doc
- [ ] Source code อยู่ใน Git repository พร้อม README การ deploy
