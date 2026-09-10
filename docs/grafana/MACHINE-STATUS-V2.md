# Machine Status V2.0 - ถอดรหัส Panel เดิมบน Grafana

| | |
|---|---|
| **Dashboard** | One Stanley Narong-Pat Machine Status V2.0 |
| **UID** | `adz5fll` |
| **Panel type** | Business Text (Handlebars template + `afterRender` JavaScript) |
| **Datasource** | InfluxDB 3.x (IOx / DataFusion SQL) |
| **Dashboard timezone** | `Asia/Bangkok` |
| **บทบาทหลังมี web app** | **คงไว้** - เป็นปลายทาง drill-down ระดับ operator (DESIGN.md §1) |
| **เอกสารนี้บันทึกเมื่อ** | 2026-08-27 |

> **เอกสารนี้คืออะไร:** เก็บ *source ต้นฉบับ* ของ panel นี้ (SQL + HTML template + JavaScript)
> ไว้ในที่เดียว พร้อมคำอธิบายว่าแต่ละส่วนทำอะไร และอะไรที่ต้อง reimplement ที่ backend
> เมื่อย้ายมาเป็น web app
>
> `docs/DESIGN.md` ยังเป็น spec ธุรกิจตัวจริง (§8 schema · §9 สูตร · §12 open decisions)
> ส่วนไฟล์นี้คือ **หลักฐานว่าบอร์ดเดิมคำนวณอย่างไรจริงๆ** ใช้อ้างอิงเวลาตัวเลขของ web app
> ไม่ตรงกับบอร์ด

---

## 0. อัปเดต 2026-09-10 - panel ขึ้น v4 แล้ว, `Order End` ชั้นที่ 2 (เทียบกะ) ถูกถอดออกจริง

> ยืนยันจาก SQL + `afterRender` JS ที่ดึงจาก panel สดวันนี้ (ผู้ใช้ส่งมาให้ตรง ๆ ระหว่างคุยเคส
> plant 6051) เทียบกับต้นฉบับที่บันทึกไว้ใน §2-4 ด้านล่าง (จับภาพ 2026-08-27)

**สิ่งที่หายไปทั้งหมด**: บล็อก `// 0. ตรวจสอบกะ (Shift Logic)` ในสคริปต์เก่า (`getProductionShiftInfo`,
`isCurrentShift`, การ clone การ์ดเป็น `Order End` เมื่อ `vCreateDateTxt` ไม่ตรงกะปัจจุบัน) **ไม่มีอยู่ใน
SQL หรือ JS เวอร์ชันปัจจุบันเลยสักบรรทัด** ไม่ใช่แค่ JS - ตรวจ SQL แล้วก็ไม่มี `now()` เทียบกับ
`vCreateDateTxt` ที่ไหนเช่นกัน `Order End` **ชั้นที่ 2 แบบเทียบกะไม่เคยมีอยู่ในระบบที่ใช้งานจริง ณ วันนี้**

**สิ่งที่แทนที่มันคือกลไกใหม่ทั้งหมด - "Pending" ที่คนกดเอง:**

```sql
CASE
    WHEN P.global_machine_seq > 1 AND SP."Result" = 'Pending' THEN 'Pending'
    WHEN P.global_machine_seq > 1 THEN 'Order End'
    ELSE R."RealTimeStatus"
END AS "MachineStatusRealTime"
```

- `Order End` ชั้นที่ 1 (`global_machine_seq > 1`) เหมือนเดิมทุกประการ - เครื่องมีกลุ่ม PO ใหม่กว่าคุมอยู่แล้วจริง ๆ
- ของใหม่คือ `production_machine_status.Result` เอง **เขียนโดย Node-RED ตอนมีคนกดปุ่มบน widget**
  (คอมเมนต์ในคิวรี่บอกตรง ๆ) ค่าที่เป็นไปได้อย่างน้อยคือ `'Pending'` / `'Order End'` / `'Mass Pro'` -
  นี่คือสถานะที่ **operator เป็นคนตั้งเอง** ไม่ใช่การเดาจากเวลา ตรงกับที่ฝ่าย IOT ยืนยัน (ASI ไม่ auto-cut
  ตามกะ ต้องรอคนไปกดตัดจริง)
- `Pending` เป็นสถานะที่ **ค้างได้ยาว** (คนพักงานไว้) ต่างจาก `Order End` ที่เกิดจากมีออเดอร์ใหม่มาแทนจริง

**ผลต่อ Avg %OA และ Total ในเวอร์ชันนี้ (จาก JS v4, `EXCLUDE_FROM_TOTAL` / ตัวแปรเดียวกันใน `buildSummaryBar`):**

```js
var EXCLUDE_FROM_TOTAL = ['Order End', 'Pending'];
var EXCLUDE_FROM_OA    = ['Order End', 'Pending', 'Offline', 'No Plan'];
```

เครื่องที่สถานะปัจจุบันเป็น `Pending` (ถูกพักงานไว้) **ถูกตัดออกจากทั้ง Total และ Avg %OA ของบอร์ด** แม้ว่า
การ์ดนั้นจะยังมี `%OA` คำนวณได้จาก shot ล่าสุดก็ตาม - เดิมใน v3 exclude list มีแค่ `Order End` / `Offline` /
`No Plan`, `Pending` เป็นของใหม่ที่เพิ่มเข้ามาพร้อม feature นี้

**HTML template ก็เปลี่ยน**: `href` ปลายทาง drill-down จาก 4 สาขา (`t01`/`t02`/`t03`/`{{else}}`, suffix
`0581t01..t03`) เหลือ 2 สาขา (`t01` กับ `{{else}}` ทั้งคู่ชี้ suffix ใหม่ `0581t200`) และเพิ่ม badge
`{{#if CheckSheetWarningFlag}}...No Checksheet...{{/if}}` ที่ไม่เคยมีมาก่อน

**นัยต่อ backend (`server/`) ตอนนี้:**

1. **`server/src/domain/orderShift.ts` ทั้งไฟล์พอร์ตมาจาก layer ที่ตายไปแล้ว.** ฟังก์ชันไม่ได้พังอะไร (ตาม
   กฎ 2026-09-08 มันแค่รายงาน ไม่ตัดเครื่องออกจาก %OA อยู่แล้ว) แต่ **ข้อความใน `orderShiftWarnings`
   ("the production board blanks these") เป็นเท็จ** ต้องแก้ - ดูหมายเหตุในไฟล์นั้น
2. **`SUBSTANTIVE_STATUSES` ใน `server/src/influx/queries.ts` ยังจัด `Pending` เป็น "flag ที่กระพริบ"
   เหมือน `Warning`/`Alarm`** - ข้อสรุปนั้นวัดไว้ก่อนที่ widget ของ v4 จะมีจริง (2026-08-27, ตอนที่
   `Pending` ยังไม่ใช่ค่าที่คนตั้งค้างไว้ได้) ต้องวัดใหม่ว่าเครื่องที่ operator กด Pending ค้างไว้จริง จะ
   ยังโผล่เป็น `Mass Pro`/สถานะเก่าในเซตของเราไหม
3. **นี่คือผู้ต้องสงสัยที่น่าเชื่อที่สุดตอนนี้สำหรับช่องว่าง plant 6051 (51.2% ของเรา vs 50.9% ของ Grafana):**
   `server/src/domain/oa.ts` ไม่รู้จักสถานะ `Pending`/`Offline` เลย - มันคำนวณจาก
   `production_machine_io` (PO/qty/cycle) ล้วน ๆ ไม่ join กับ `production_machine_status.Result` ที่ไหน
   เลย ถ้าเครื่องไหนที่ 6051 ถูกกด `Pending` ค้างไว้ตอนนี้ แต่ shot ล่าสุดยังคำนวณ %OA ได้ - **ฝั่งเรานับ
   เข้าค่าเฉลี่ย ฝั่ง Grafana ไม่นับ** สูตร %OA ต่อเครื่องเหมือนกันเป๊ะทั้งสองฝั่ง (§9.1) ต่างกันแค่ "เซตของ
   เครื่องที่เข้าตัวหาร"

ดู §6 ตารางข้อค้นพบ - แถว **F-13** ปิดเป็น "ล้าสมัย" และเพิ่มแถวใหม่ **F-18** สำหรับข้อ 3 ด้านบน

**อัปเดต 2026-09-10 ต่อ - ยืนยันแล้วว่า `TotalOutput_Per_PO` (ตัวคำนวณ `OA_percent`) อ่าน
`now() - INTERVAL '3 days'` จริง ไม่ใช่ `'1 days'` เหมือน v3** และพี่ IOT ยืนยันกฎธุรกิจตรง ๆ:
เครื่องของ ASI ที่ออเดอร์ปัจจุบันรันมาเกิน 24 ชม. ให้คิด %OA จากหน้าต่าง 3 วัน ไม่ใช่ 1 วัน

พิสูจน์ด้วยข้อมูลสดที่ plant 6051 (Explore, datasource `iot_data_master`, 2026-09-10):
`M-ID-02` และ `M-ID-06` มีออเดอร์อายุเท่ากัน (~26.8 ชม.) แต่ %OA ต่างกันคนละขนาด -

| เครื่อง | 24h (คำนวณแบบเราตอนนั้น) | 3d (คำนวณแบบ v4) | Grafana จริง |
|---|---|---|---|
| M-ID-02 | 49.1% | 46.4% | 46.3-46.4% ✅ |
| M-ID-06 | 112% | 111% | 111.5% |

เลข 3d ตรงกับ Grafana เป๊ะ ยืนยันว่าหน้าต่าง 24h เดิมของเราผิด **`server/src/influx/queries.ts`'s
`OA_WINDOW_HOURS` แก้จาก `24` เป็น `71` แล้ว** (71 ไม่ใช่ 72 เพราะ `MAX_WINDOW_HOURS` เป็นเพดาน
scan ไฟล์จริงของ InfluxDB ต่อ 1 query - ดูคอมเมนต์ของค่านั้น) ผลข้างเคียงที่ต้องแก้ตามคือ
`server/src/services/windowedSnapshot.ts`'s fast-path (`isDefault`) เคยผูกกับ
`OA_WINDOW_HOURS` โดยบังเอิญ (ทั้งคู่เคยเป็น 24) ต้องแยกออกมาเป็นการเทียบ `request.range === '24h'`
ตรง ๆ ไม่งั้นทุก request ปกติ (ที่ front end ส่ง `range=24h` เป็นค่า default) จะพลาด fast path
และคำนวณ %OA ใหม่ด้วยหน้าต่างแคบกว่าที่ poller ถืออยู่ ทำให้การแก้ครั้งนี้ไม่มีผลกับ request ส่วนใหญ่

---

## 1. ภาพรวม pipeline

```
InfluxDB 3.x (IOx SQL)
  ├── production_machine_io       ← ข้อมูลการผลิต 1 row ≈ 1 shot
  └── production_machine_status   ← สถานะ realtime ต่อเครื่อง
        │
        ▼  SQL เดียว (5 CTE + FULL JOIN) - กรองทีละ plant เท่านั้น
   ตาราง 1 row = 1 การ์ด
        │
        ▼  Handlebars {{#each data}}
   การ์ด <a class="card-link"> → <div class="card-box"> พร้อม data-* attribute
        │
        ▼  afterRender JavaScript (8 ขั้น)
   0.  ตัดสิน Order End "ชั้นที่ 2" ด้วยการเทียบกะ  ← สร้างการ์ดเพิ่ม!
   1-3 format ตัวเลข / %OA / ตัดข้อความ
   4   progress bar ผ่าน generated <style>
   5   นับใบสั่งเพิ่ม (+n)
   6   จัดคอลัมน์ตามเครื่อง
   6.5-6.6 exec summary bar + filter ตามสถานะ
   7   live timer (setInterval 1 วิ)
```

**จุดสำคัญที่สุด:** ตรรกะธุรกิจ **ไม่ได้อยู่ที่เดียว** - กระจายอยู่ทั้งใน SQL และใน JavaScript
ที่รันบนเบราว์เซอร์ ถ้า web app ย้ายมาเฉพาะ SQL ตัวเลข Running / Stopped / Avg %OA
**จะไม่ตรงกับบอร์ดเดิม** (ตรงกับที่ DESIGN.md §8.4 เตือนไว้เรื่อง `Order End` 2 ชั้น)

---

## 2. SQL Query

Grafana variable ที่ใช้: `${Lamp_var}` (plant), `${process_var}`, `${Zone_var:singlequote}`,
`$__timeFrom`, `$__timeTo`

### 2.1 ต้นฉบับ

```sql
WITH
All_IO_Ranked AS (
    SELECT
        COALESCE("ProductionOrder0", '') AS "productionOrderNo0",
        COALESCE("ProductionOrder1", '') AS "productionOrderNo1",
        COALESCE("ProductionOrder2", '') AS "productionOrderNo2",
        COALESCE("ProductionOrder3", '') AS "productionOrderNo3",

        TRIM(COALESCE("ProductionOrder0", '')) || '_' ||
        TRIM(COALESCE("ProductionOrder1", '')) || '_' ||
        TRIM(COALESCE("ProductionOrder2", '')) || '_' ||
        TRIM(COALESCE("ProductionOrder3", '')) AS "Group_PO",

        "machine", "plant", "zone", "time", "mode",
        COALESCE("icsno0", '') AS "icsno0", COALESCE("icsno1", '') AS "icsno1", COALESCE("icsno2", '') AS "icsno2", COALESCE("icsno3", '') AS "icsno3",
        COALESCE("vIcsName0", '') AS "vIcsName0", COALESCE("vIcsName1", '') AS "vIcsName1", COALESCE("vIcsName2", '') AS "vIcsName2", COALESCE("vIcsName3", '') AS "vIcsName3",
        COALESCE("plan_qty0", 0) AS "plan_qty0", COALESCE("plan_qty1", 0) AS "plan_qty1", COALESCE("plan_qty2", 0) AS "plan_qty2", COALESCE("plan_qty3", 0) AS "plan_qty3",
        COALESCE("icsname0", '') AS "icsname0", COALESCE("icsname1", '') AS "icsname1", COALESCE("icsname2", '') AS "icsname2", COALESCE("icsname3", '') AS "icsname3",
        COALESCE("vCreateDateTxt0", '') AS "vCreateDateTxt0_Raw",
        COALESCE("vCreateDateTxt1", '') AS "vCreateDateTxt1_Raw",
        COALESCE("vCreateDateTxt2", '') AS "vCreateDateTxt2_Raw",
        COALESCE("vCreateDateTxt3", '') AS "vCreateDateTxt3_Raw",
        "qty", "std_time", "cycle_time",
        "template",

        ROW_NUMBER() OVER (PARTITION BY
            TRIM(COALESCE("ProductionOrder0", '')) || '_' ||
            TRIM(COALESCE("ProductionOrder1", '')) || '_' ||
            TRIM(COALESCE("ProductionOrder2", '')) || '_' ||
            TRIM(COALESCE("ProductionOrder3", '')),
            "machine"
            ORDER BY time DESC
        ) as rn_per_po
    FROM "production_machine_io"
    WHERE "plant" = '${Lamp_var}'
      AND "process" = '${process_var}'
      AND "zone" IN (${Zone_var:singlequote})
      AND "time" >= now() - INTERVAL '1 days'
),

Latest_Per_PO AS (
    SELECT *, ROW_NUMBER() OVER (PARTITION BY "machine" ORDER BY "time" DESC) as global_machine_seq
    FROM All_IO_Ranked
    WHERE rn_per_po = 1
),

POs_To_Show AS (
    SELECT *
    FROM Latest_Per_PO
    WHERE global_machine_seq = 1 OR ("time" >= $__timeFrom AND "time" <= $__timeTo)
),

TotalOutput_Per_PO AS (
    SELECT
        TRIM(COALESCE("ProductionOrder0", '')) || '_' ||
        TRIM(COALESCE("ProductionOrder1", '')) || '_' ||
        TRIM(COALESCE("ProductionOrder2", '')) || '_' ||
        TRIM(COALESCE("ProductionOrder3", '')) AS "Group_PO_Sum",
        "machine",
        SUM("qty") AS "OutputActual",
        SUM(CASE WHEN date_bin(INTERVAL '1 hour', time) = date_bin(INTERVAL '1 hour', now()) THEN "qty" ELSE 0 END) AS "OutputperHr",
        MAX("std_time") AS "STD_Time",
        SUM(CASE WHEN "cycle_time" > ("std_time" + 20) THEN "std_time" ELSE "cycle_time" END) AS "SumCycle",
        ((MIN("std_time") * SUM("qty")) / NULLIF(SUM(CASE WHEN "cycle_time" > ("std_time" + 100) THEN "std_time" * "qty" ELSE "cycle_time" * "qty" END), 0)) * 100 AS "OA_percent"
    FROM "production_machine_io"
    WHERE "plant" = '${Lamp_var}'
      AND "process" = '${process_var}'
      AND "zone" IN (${Zone_var:singlequote})
      AND "ProductionOrder0" IS NOT NULL AND "ProductionOrder0" != '' AND "ProductionOrder0" != '-'
      AND "time" >= now() - INTERVAL '1 days'
    GROUP BY
        TRIM(COALESCE("ProductionOrder0", '')) || '_' ||
        TRIM(COALESCE("ProductionOrder1", '')) || '_' ||
        TRIM(COALESCE("ProductionOrder2", '')) || '_' ||
        TRIM(COALESCE("ProductionOrder3", '')),
        "machine"
),

RealtimeStatus_Latest AS (
    SELECT
        "machine", "plant", "zone", "Result" AS "RealTimeStatus", "StatusStartTime", "time",
        ROW_NUMBER() OVER (PARTITION BY "machine" ORDER BY "time" DESC) as rn_stat
    FROM "production_machine_status"
    WHERE "plant" = '${Lamp_var}'
      AND "process" = '${process_var}'
      AND "zone" IN (${Zone_var:singlequote})
      AND "time" >= now() - INTERVAL '1 days'
)

SELECT
    COALESCE(R."machine", P."machine") AS "machine",
    COALESCE(R."plant", P."plant") AS "plant",
    COALESCE(P."zone", R."zone") AS "zone",          -- ✅ เพิ่ม zone
    CASE WHEN P.global_machine_seq > 1 THEN 'Order End' ELSE R."RealTimeStatus" END AS "MachineStatusRealTime",
    CASE WHEN R."StatusStartTime" IS NOT NULL THEN CAST(R."StatusStartTime" AS VARCHAR) ELSE CAST(R."time" AS VARCHAR) END AS "StatusStartTime",
    P."productionOrderNo0", P."productionOrderNo1", P."productionOrderNo2", P."productionOrderNo3",
    CASE WHEN P."mode" = 'Auto' THEN 'Mass Pro' ELSE 'Dandori' END AS "ModeStatus",
    P."icsno0", P."icsno1", P."icsno2", P."icsno3",
    P."vIcsName0", P."vIcsName1", P."vIcsName2", P."vIcsName3",
    P."plan_qty0", P."plan_qty1", P."plan_qty2", P."plan_qty3",
    P."icsname0", P."icsname1", P."icsname2", P."icsname3",
    REPLACE(P."vCreateDateTxt0_Raw", ' ', '%20') AS "vCreateDateTxt0",
    REPLACE(P."vCreateDateTxt1_Raw", ' ', '%20') AS "vCreateDateTxt1",
    REPLACE(P."vCreateDateTxt2_Raw", ' ', '%20') AS "vCreateDateTxt2",
    REPLACE(P."vCreateDateTxt3_Raw", ' ', '%20') AS "vCreateDateTxt3",
    COALESCE(T."OutputperHr", 0) AS "OutputperHr",
    COALESCE(T."OutputActual", 0) AS "OutputActual",
    T."STD_Time", T."SumCycle", T."OA_percent",
    CASE WHEN P.global_machine_seq > 1 THEN 1 ELSE 0 END AS "_sort_weight",
    COALESCE(P."time", R."time") AS "_sort_time",
    (COALESCE(P."plan_qty0", 0) + COALESCE(P."plan_qty1", 0) + COALESCE(P."plan_qty2", 0) + COALESCE(P."plan_qty3", 0)) AS "TotalPlan",
    P."template",
    CASE
        WHEN (COALESCE(P."plan_qty0", 0) + COALESCE(P."plan_qty1", 0) + COALESCE(P."plan_qty2", 0) + COALESCE(P."plan_qty3", 0)) > 0
        THEN (COALESCE(T."OutputActual", 0) / (COALESCE(P."plan_qty0", 0) + COALESCE(P."plan_qty1", 0) + COALESCE(P."plan_qty2", 0) + COALESCE(P."plan_qty3", 0))::FLOAT) * 100
        ELSE 0
    END AS "AR_percent"

FROM (SELECT * FROM RealtimeStatus_Latest WHERE rn_stat = 1) AS R
FULL JOIN POs_To_Show AS P ON R."machine" = P."machine"
LEFT JOIN TotalOutput_Per_PO AS T ON P."Group_PO" = T."Group_PO_Sum" AND P."machine" = T."machine"

WHERE P."productionOrderNo0" IS NULL OR P.global_machine_seq = 1 OR (P.global_machine_seq > 1 AND P."productionOrderNo0" != '-')
ORDER BY "zone" ASC, "_sort_weight" ASC, "machine" ASC, "_sort_time" DESC  -- ✅ เรียงตาม zone ก่อน
```

### 2.2 อ่าน CTE ทีละชั้น

| CTE | ทำอะไร | ผลลัพธ์ |
|---|---|---|
| `All_IO_Ranked` | ดึง IO 24 ชม. ของ plant/process/zone ที่เลือก · สร้าง `Group_PO` = `PO0_PO1_PO2_PO3` · จัดอันดับแถวภายใน (Group_PO × machine) ตามเวลา | ทุก shot พร้อม `rn_per_po` |
| `Latest_Per_PO` | เก็บเฉพาะ `rn_per_po = 1` (แถวล่าสุดของแต่ละกลุ่ม PO) แล้วจัดอันดับ **กลุ่ม PO ต่อเครื่อง** → `global_machine_seq` | 1 แถว = 1 กลุ่ม PO ที่เครื่องเคยรัน · `seq = 1` คือใบสั่งที่โหลดอยู่ล่าสุด |
| `POs_To_Show` | เก็บ `seq = 1` เสมอ **หรือ** กลุ่มที่แถวล่าสุดตกในช่วง time picker | ใบสั่งปัจจุบัน + ใบสั่งเก่าที่จะกลายเป็นการ์ด `Order End` |
| `TotalOutput_Per_PO` | aggregate ต่อ (Group_PO × machine): `OutputActual`, `OutputperHr`, `STD_Time`, `SumCycle`, `OA_percent` | ตัวเลขผลผลิต - **ไม่ผูกกับ time picker ใช้ 24 ชม. ตายตัว** |
| `RealtimeStatus_Latest` | สถานะล่าสุดต่อเครื่องจาก `production_machine_status` | `Result`, `StatusStartTime` |

**การ join ชั้นสุดท้าย**

- `FULL JOIN` ระหว่างสถานะ (`R`) กับใบสั่ง (`P`) **ด้วย `machine` อย่างเดียว** - รองรับเครื่องที่มีข้อมูลฝั่งเดียว
- `LEFT JOIN` ตัวเลขผลผลิต (`T`) ด้วย `(Group_PO, machine)`
- `WHERE` ท้ายสุด: เก็บแถวที่ไม่มีใบสั่งเลย (join miss → `IS NULL`) · เก็บใบสั่งปัจจุบันเสมอ · ใบสั่งเก่าเก็บเฉพาะที่เลข PO ไม่ใช่ `'-'`
- `Order End` **ชั้นที่ 1** เกิดตรงนี้: `global_machine_seq > 1 → 'Order End'`

### 2.3 สูตรที่ SQL คำนวณ

```sql
-- %OA  (ต่อ Group_PO × machine)  → DESIGN.md §9.1
OA_percent = ( MIN(std_time) * SUM(qty) )
           / NULLIF( SUM(CASE WHEN cycle_time > std_time + 100
                              THEN std_time  * qty
                              ELSE cycle_time * qty END), 0 ) * 100

-- %AR  (ต่อการ์ด)  → DESIGN.md §9.2
TotalPlan  = plan_qty0 + plan_qty1 + plan_qty2 + plan_qty3     -- จากแถวล่าสุด "แถวเดียว"
AR_percent = TotalPlan > 0 ? OutputActual / TotalPlan * 100 : 0

-- Output/Hr
OutputperHr = SUM(qty) WHERE date_bin('1 hour', time) = date_bin('1 hour', now())
```

> ✅ **`TotalPlan` ที่นี่ถูกต้อง** - มันบวก `plan_qty0..3` ของ **แถวเดียว** (แถวล่าสุดของกลุ่ม PO)
> ไม่ใช่ `SUM()` ข้ามแถว จึงไม่ตกหลุม "plan × จำนวน shot" ที่ DESIGN.md §9.2 ข้อ 1 เตือนไว้
> - ฝั่ง `server/` ที่ต้อง `GROUP BY` จริงจึงต้องใช้ `MAX()` เพื่อให้ได้ผลเทียบเท่า

> ℹ️ **`date_bin` ที่นี่ไม่บวก `+ interval '7 hours'`** ต่างจาก DESIGN.md §9.3 - แต่ผลเท่ากัน
> เพราะ bucket ขนาด 1 ชั่วโมงมีขอบตรงกันในทุก timezone ที่ offset เป็นชั่วโมงเต็ม
> (จะต่างก็ต่อเมื่อเจอไซต์ที่ offset ลงท้าย :30 / :45 ซึ่งกลุ่มนี้ยังไม่มี)

### 2.4 คอลัมน์ที่ส่งออก → ถูกใช้ที่ไหน

| คอลัมน์ | ใน template | ใน JS | หมายเหตุ |
|---|---|---|---|
| `machine` | ✅ ชื่อการ์ด · `data-uid` · href | ✅ จัดคอลัมน์ | |
| `plant`, `zone` | ✅ href | - | |
| `MachineStatusRealTime` | ✅ `data-status` + badge | ✅ เกือบทุกขั้น | |
| `StatusStartTime` | ✅ `data-start` | ✅ live timer | cast เป็น VARCHAR → ดู **F-05** |
| `productionOrderNo0..3` | ✅ | ✅ นับ `(+n)` | |
| `icsno0`, `icsname0` | ✅ | ✅ ตัดข้อความ | slot 1..3 ส่งไป href เท่านั้น |
| `vIcsName0..3` | ✅ href | - | |
| `vCreateDateTxt0..3` | ✅ `.hidden-dates` | ✅ **ตัดสิน Order End** | SQL แทน space ด้วย `%20` |
| `plan_qty0..3` | ✅ href | - | |
| `OutputperHr`, `OutputActual` | ✅ | ✅ format | |
| `OA_percent` | ✅ | ✅ format + สี + avg | |
| `TotalPlan`, `AR_percent` | ✅ `data-plan`, `data-ar` | ✅ progress bar | |
| `template` | ✅ เลือก t01/t02/t03 | - | |
| `ModeStatus` | ❌ | ❌ | **dead column** |
| `STD_Time`, `SumCycle` | ❌ | ❌ | **dead column** |
| `_sort_weight`, `_sort_time` | ❌ | ❌ | ใช้ใน `ORDER BY` เท่านั้น |

---

## 3. HTML Template (Handlebars)

### 3.1 โครงสร้าง

```
.machine-status-container#machineStatusContainer
  #exec-summary-bar                    ← ว่างเปล่า JS เติมทีหลัง
  .status-grid
    {{#each data}}
      a.card-link[href=drill-down]      ← เลือก t01/t02/t03 ตาม {{template}}
        .card-box[data-status]
          .hidden-dates (display:none)  ← .cd0 .cd1 .cd2 .cd3 = vCreateDateTxt
          .card-header
            h2.machine-name
            .status-badge[data-status]
            h3.timer.live-duration[data-status][data-start]
          .rows
            .row.po   > .po-display[data-po0..3]
            .row.ics  / .row.desc > .desc-text[title]
            <hr>
            .row.hr   > .fmt-num.highlight-blue    ← Output/Hr
            .row.sh   > .fmt-num {{QtyColor}}      ← OUTPUT ACTUAL
            .row.plan > .fmt-num.sum-plan          ← OUTPUT Plan
            <hr>
            .row.oa   > .fmt-oa                    ← %OA
          .progress-wrapper
            .progress-header > .progress-label + .progress-text[data-uid]
            .progress-container[data-uid][data-ar][data-plan]
              .progress-fill[data-uid]
    {{/each}}
```

**`data-uid`** = `{{machine}}-{{PO0}}-{{PO1}}-{{PO2}}-{{PO3}}` - เป็นกุญแจที่ JS ใช้จับคู่
`.progress-fill` / `.progress-text` กับกฎ CSS ที่ generate ขึ้นมา

### 3.2 Drill-down URL

การ์ดลิงก์ไป **Production Insight Injection** (`96799488-7d10-4db7-9b0e-508c5f1c0581`)
โดยเลือก suffix ตาม `{{template}}`:

| `template` | ปลายทาง |
|---|---|
| `01` | `…0581t01` |
| `02` | `…0581t02` |
| `03` | `…0581t03` |
| อื่นๆ / ว่าง | `…0581t03` (default) |

**query string ทั้ง 4 สาขาเหมือนกันทุกตัวอักษร** ต่างแค่ suffix - ส่ง parameter ~40 ตัว:

```
var-TargetMachine, var-TargetLamp, var-TargetZone, var-TargetMainGroup,
var-TargetProcess, var-TargetShift, var-TargetMode, var-TargetStatus,
var-TargetCycleTime, var-TargetAvrCycleTime,
var-TargetTimeMoldOpening, var-TargetTimeMoldEnd, var-TargetTimeInjection,
var-TargetPO0..3, var-TargetICS0..3, var-TargetICSName0..3,
var-TargetvIcsName0..3, var-TargetCreateDate0..3, var-Targetplan_qty0..3,
var-TargetQty, var-TargetStdTime, var-TargetCavity
```

> ⚠️ **ในจำนวนนี้มี 11 ตัวที่ไม่มีอยู่ใน `SELECT` เลย → ส่งไปเป็นค่าว่างเสมอ** ดู **F-01**

### 3.3 ต้นฉบับเต็ม

<details>
<summary>คลิกเพื่อดู HTML ต้นฉบับ (ไม่ตัดทอน)</summary>

```handlebars
<div class="machine-status-container" id="machineStatusContainer">
    <div id="exec-summary-bar"></div>
    <div class="status-grid">
    {{#each data}}
    <a class="card-link" target="_blank"
        {{#if (eq template '01')}}
            href="/d/96799488-7d10-4db7-9b0e-508c5f1c0581t01?var-TargetMachine={{machine}}&var-TargetLamp={{plant}}&var-TargetZone={{zone}}&var-TargetMainGroup={{mainGroup}}&var-TargetProcess={{process}}&var-TargetShift={{shift}}&var-TargetMode={{mode}}&var-TargetStatus={{status}}&var-TargetCycleTime={{cycle_time}}&var-TargetAvrCycleTime={{avr_cycle_time}}&var-TargetTimeMoldOpening={{time_mold_opening}}&var-TargetTimeMoldEnd={{time_mold_end}}&var-TargetTimeInjection={{time_injection}}&var-TargetPO0={{productionOrderNo0}}&var-TargetICS0={{icsno0}}&var-TargetICSName0={{icsname0}}&var-TargetvIcsName0={{vIcsName0}}&var-TargetCreateDate0={{vCreateDateTxt0}}&var-Targetplan_qty0={{plan_qty0}}&var-TargetPO1={{productionOrderNo1}}&var-TargetICS1={{icsno1}}&var-TargetICSName1={{icsname1}}&var-TargetvIcsName1={{vIcsName1}}&var-TargetCreateDate1={{vCreateDateTxt1}}&var-Targetplan_qty1={{plan_qty1}}&var-TargetPO2={{productionOrderNo2}}&var-TargetICS2={{icsno2}}&var-TargetICSName2={{icsname2}}&var-TargetvIcsName2={{vIcsName2}}&var-TargetCreateDate2={{vCreateDateTxt2}}&var-Targetplan_qty2={{plan_qty2}}&var-TargetPO3={{productionOrderNo3}}&var-TargetICS3={{icsno3}}&var-TargetICSName3={{icsname3}}&var-TargetvIcsName3={{vIcsName3}}&var-TargetCreateDate3={{vCreateDateTxt3}}&var-Targetplan_qty3={{plan_qty3}}&var-TargetQty={{qty}}&var-TargetStdTime={{std_time}}&var-TargetCavity={{cavity}}"
        {{else if (eq template '02')}}
            href="/d/96799488-7d10-4db7-9b0e-508c5f1c0581t02?var-TargetMachine={{machine}}&var-TargetLamp={{plant}}&var-TargetZone={{zone}}&var-TargetMainGroup={{mainGroup}}&var-TargetProcess={{process}}&var-TargetShift={{shift}}&var-TargetMode={{mode}}&var-TargetStatus={{status}}&var-TargetCycleTime={{cycle_time}}&var-TargetAvrCycleTime={{avr_cycle_time}}&var-TargetTimeMoldOpening={{time_mold_opening}}&var-TargetTimeMoldEnd={{time_mold_end}}&var-TargetTimeInjection={{time_injection}}&var-TargetPO0={{productionOrderNo0}}&var-TargetICS0={{icsno0}}&var-TargetICSName0={{icsname0}}&var-TargetvIcsName0={{vIcsName0}}&var-TargetCreateDate0={{vCreateDateTxt0}}&var-Targetplan_qty0={{plan_qty0}}&var-TargetPO1={{productionOrderNo1}}&var-TargetICS1={{icsno1}}&var-TargetICSName1={{icsname1}}&var-TargetvIcsName1={{vIcsName1}}&var-TargetCreateDate1={{vCreateDateTxt1}}&var-Targetplan_qty1={{plan_qty1}}&var-TargetPO2={{productionOrderNo2}}&var-TargetICS2={{icsno2}}&var-TargetICSName2={{icsname2}}&var-TargetvIcsName2={{vIcsName2}}&var-TargetCreateDate2={{vCreateDateTxt2}}&var-Targetplan_qty2={{plan_qty2}}&var-TargetPO3={{productionOrderNo3}}&var-TargetICS3={{icsno3}}&var-TargetICSName3={{icsname3}}&var-TargetvIcsName3={{vIcsName3}}&var-TargetCreateDate3={{vCreateDateTxt3}}&var-Targetplan_qty3={{plan_qty3}}&var-TargetQty={{qty}}&var-TargetStdTime={{std_time}}&var-TargetCavity={{cavity}}"
        {{else if (eq template '03')}}
            href="/d/96799488-7d10-4db7-9b0e-508c5f1c0581t03?var-TargetMachine={{machine}}&…(เหมือนกันทุกตัวอักษรกับ t01)…&var-TargetCavity={{cavity}}"
        {{else}}
            href="/d/96799488-7d10-4db7-9b0e-508c5f1c0581t03?var-TargetMachine={{machine}}&…(เหมือนกันทุกตัวอักษรกับ t01)…&var-TargetCavity={{cavity}}"
        {{/if}}
    >

        <div class="card-box" data-status="{{MachineStatusRealTime}}">

            <div class="hidden-dates" style="display: none;">
                <span class="cd0">{{vCreateDateTxt0}}</span>
                <span class="cd1">{{vCreateDateTxt1}}</span>
                <span class="cd2">{{vCreateDateTxt2}}</span>
                <span class="cd3">{{vCreateDateTxt3}}</span>
            </div>

            <div class="card-header">
                <div class="header-left">
                    <h2 class="machine-name">{{#if machine}}{{machine}}{{else}}Unknown Machine{{/if}}</h2>
                </div>
                <div class="header-right">
                    <div class="status-badge" data-status="{{MachineStatusRealTime}}">{{#if MachineStatusRealTime}}{{MachineStatusRealTime}}{{else}}Unknown{{/if}}</div>
                    <div class="timer-container">
                        <span class="timer-icon">⏱️</span>
                        <h3 class="timer live-duration" data-status="{{MachineStatusRealTime}}"
                            data-start="{{StatusStartTime}}">--:--:--</h3>
                    </div>
                </div>
            </div>

            <div class="rows">
                <div class="row po"><b>Prod.Ord.No.:</b>
                    <span class="po-display" data-po0="{{productionOrderNo0}}" data-po1="{{productionOrderNo1}}"
                        data-po2="{{productionOrderNo2}}" data-po3="{{productionOrderNo3}}">
                        {{#if productionOrderNo0}}{{productionOrderNo0}}{{else}}<span class="no-data">No Data</span>{{/if}}
                    </span>
                </div>
                <div class="row ics"><b>ICS NO:</b> <span>{{#if icsno0}}{{icsno0}}{{else}}<span class="no-data">No Data</span>{{/if}}</span></div>
                <div class="row desc"><b>Desc:</b> <span class="desc-text" title="{{icsname0}}">{{#if icsname0}}{{icsname0}}{{else}}<span class="no-data">No Data</span>{{/if}}</span></div>

                <hr class="divider">

                <div class="row hr"><b>Output/Hr:</b> <span class="fmt-num highlight-blue">{{#if OutputperHr}}{{OutputperHr}}{{else}}0{{/if}}</span></div>
                <div class="row sh"><b>OUTPUT ACTUAL:</b> <span class="fmt-num {{QtyColor}}">{{#if OutputActual}}{{OutputActual}}{{else}}0{{/if}}</span></div>

                <div class="row plan"><b>OUTPUT Plan:</b> <span class="fmt-num sum-plan">{{#if TotalPlan}}{{TotalPlan}}{{else}}0{{/if}}</span></div>

                <hr class="divider">

                <div class="row oa"><b>%OA:</b> <span class="fmt-oa">{{#if OA_percent}}{{OA_percent}}{{else}}0{{/if}}</span></div>
            </div>

            <div class="progress-wrapper">
                <div class="progress-header">
                    <span class="progress-label">%AR (PROGRESS)</span>
                    <span class="progress-text" data-uid="{{machine}}-{{productionOrderNo0}}-{{productionOrderNo1}}-{{productionOrderNo2}}-{{productionOrderNo3}}"></span>
                </div>

                <div class="progress-container"
                    data-uid="{{machine}}-{{productionOrderNo0}}-{{productionOrderNo1}}-{{productionOrderNo2}}-{{productionOrderNo3}}"
                    data-ar="{{AR_percent}}"
                    data-plan="{{TotalPlan}}">

                    <div class="progress-fill" data-uid="{{machine}}-{{productionOrderNo0}}-{{productionOrderNo1}}-{{productionOrderNo2}}-{{productionOrderNo3}}"></div>
                </div>
            </div>

        </div>
    </a>
    {{/each}}
    </div>
</div>
```

> **หมายเหตุการเก็บ:** สาขา `t03` และ `{{else}}` ถูกย่อไว้ตรงกลาง เพราะ query string
> เหมือน `t01` ทุกตัวอักษร ต่างแค่ suffix ของ UID - ถ้าต้องการ byte-for-byte
> ให้ดึงจาก panel JSON ของ dashboard `adz5fll` โดยตรง

</details>

---

## 4. JavaScript (`afterRender`)

### 4.1 ต้นฉบับ

```javascript
try {
    // ============================================================
    // 0. ตรวจสอบกะ (Shift Logic) - อิงตาม Timezone ที่ตั้งไว้ใน Grafana Dashboard
    // ============================================================
    // Grafana จะแทนค่า ${__timezone} ด้วย 'browser' | 'utc' | ชื่อ IANA (เช่น 'Asia/Bangkok')
    // ตามที่ตั้งไว้ใน Dashboard Settings → General → Timezone
    let dashboardTzRaw = "${__timezone}";
    let GRAFANA_TZ;
    if (!dashboardTzRaw || dashboardTzRaw.indexOf('__timezone') !== -1) {
        // เผื่อ panel นี้ไม่รองรับการแทนค่าตัวแปรนี้ ให้ fallback เป็น timezone ของเบราว์เซอร์
        GRAFANA_TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;
    } else if (dashboardTzRaw === 'browser') {
        GRAFANA_TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;
    } else if (dashboardTzRaw === 'utc') {
        GRAFANA_TZ = 'UTC';
    } else {
        GRAFANA_TZ = dashboardTzRaw; // ชื่อ IANA ตรงๆ เช่น 'Asia/Bangkok'
    }

    // ดึงส่วนประกอบวันที่/เวลา ตาม timezone เป้าหมาย โดยใช้ Intl API (รองรับ DST ถูกต้อง)
    function getZonedParts(dateObj, timeZone) {
        const dtf = new Intl.DateTimeFormat('en-US', {
            timeZone,
            year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', hour12: false
        });
        const parts = dtf.formatToParts(dateObj).reduce((acc, p) => {
            acc[p.type] = p.value; return acc;
        }, {});
        let hour = parseInt(parts.hour, 10);
        if (hour === 24) hour = 0; // เผื่อบาง locale คืนค่า '24' แทนเที่ยงคืน
        return {
            year: parseInt(parts.year, 10),
            month: parseInt(parts.month, 10),
            day: parseInt(parts.day, 10),
            hour
        };
    }

    // dateObj ต้องเป็น UTC epoch ปกติ (new Date() หรือ parse จาก string UTC เท่านั้น)
    // ฟังก์ชันนี้จะแปลงให้ตรงกับ GRAFANA_TZ เองผ่าน Intl API - ไม่มีการบวก/ลบชั่วโมงเองอีกต่อไป
    function getProductionShiftInfo(dateObj, timeZone) {
        if (!dateObj || isNaN(dateObj.getTime())) return null;
        const { year, month, day, hour } = getZonedParts(dateObj, timeZone);
        let shiftName = (hour >= 8 && hour < 20) ? 'Morning' : 'Night';
        let y = year, m = month, d = day;
        if (shiftName === 'Night' && hour < 8) {
            // ถอยหลัง 1 วัน โดยผ่าน UTC date object เพื่อให้ overflow เดือน/ปีถูกต้องเสมอ
            const prev = new Date(Date.UTC(year, month - 1, day));
            prev.setUTCDate(prev.getUTCDate() - 1);
            y = prev.getUTCFullYear();
            m = prev.getUTCMonth() + 1;
            d = prev.getUTCDate();
        }
        const mm = String(m).padStart(2, '0');
        const dd = String(d).padStart(2, '0');
        return { dateString: `${y}-${mm}-${dd}`, shift: shiftName };
    }

    // "เวลาปัจจุบัน" ใช้ epoch ตรงๆ (UTC) แล้วให้ getProductionShiftInfo แปลงตาม GRAFANA_TZ เอง
    const currentShiftInfo = getProductionShiftInfo(new Date(), GRAFANA_TZ);

    document.querySelectorAll('.card-box').forEach(card => {
        const status = card.getAttribute('data-status');
        if (!['Mass Pro', 'Dandori', 'Stop'].includes(status)) return;

        const datesContainer = card.querySelector('.hidden-dates');
        if (!datesContainer) return;

        const poDisplay = card.querySelector('.po-display');
        const poVal = poDisplay ? (poDisplay.getAttribute('data-po0') || '').trim() : '';
        if (!poVal || poVal === '-' || poVal.toLowerCase() === 'no data' || poVal === '') return;

        const dateStrings = [
            datesContainer.querySelector('.cd0')?.innerText || '',
            datesContainer.querySelector('.cd1')?.innerText || '',
            datesContainer.querySelector('.cd2')?.innerText || '',
            datesContainer.querySelector('.cd3')?.innerText || ''
        ];

        let isCurrentShift = false;
        for (let rawDt of dateStrings) {
            if (!rawDt) continue;
            let dtStr = rawDt.replace(/["']/g, '').trim();
            if (dtStr && dtStr !== '-' && dtStr.toLowerCase() !== 'no data') {
                try {
                    try { dtStr = decodeURIComponent(dtStr); } catch(e) {}

                    // ⚙️ dtStr มาจาก InfluxDB ผ่าน Node-RED ซึ่งตอนนี้เป็น UTC ล้วนแล้ว
                    // บังคับตีความเป็น UTC แบบ explicit โดยแปลงเป็น ISO 8601 แล้วปิดท้ายด้วย 'Z'
                    let isoStr = dtStr.replace(' ', 'T');
                    if (!/[Zz]$/.test(isoStr) && !/[+-]\d{2}:?\d{2}$/.test(isoStr)) {
                        isoStr += 'Z';
                    }
                    let dtObj = new Date(isoStr);
                    if (isNaN(dtObj.getTime())) {
                        // fallback เผื่อ format ไม่ตรง ISO
                        dtObj = new Date(dtStr.replace(/-/g, '/').replace('T', ' ') + ' UTC');
                    }

                    // แปลงทั้งสองฝั่ง (order date และ now) ด้วย timezone เดียวกัน (GRAFANA_TZ) เพื่อเทียบกะอย่างยุติธรรม
                    let orderShiftInfo = getProductionShiftInfo(dtObj, GRAFANA_TZ);
                    if (orderShiftInfo && currentShiftInfo &&
                        orderShiftInfo.dateString === currentShiftInfo.dateString &&
                        orderShiftInfo.shift === currentShiftInfo.shift) {
                        isCurrentShift = true;
                        break;
                    }
                } catch (e) { console.warn("Date parse error:", e); }
            }
        }

        if (!isCurrentShift) {
            const cardLink = card.closest('a.card-link');
            let clonedLink = null;
            if (cardLink) {
                clonedLink = cardLink.cloneNode(true);
                const clonedCard = clonedLink.querySelector('.card-box');
                if (clonedCard) {
                    clonedCard.setAttribute('data-status', 'Order End');
                    const badge = clonedCard.querySelector('.status-badge');
                    if (badge) {
                        badge.setAttribute('data-status', 'Order End');
                        badge.innerText = 'Order End';
                    }
                    const timer = clonedCard.querySelector('.live-duration');
                    if (timer) {
                        timer.setAttribute('data-status', 'Order End');
                        timer.innerText = '--:--:--';
                    }
                    clonedCard.querySelectorAll('[data-uid]').forEach(el => {
                        el.setAttribute('data-uid', el.getAttribute('data-uid') + '-oe');
                    });
                }
            }

            let poDisplay = card.querySelector('.po-display');
            if (poDisplay) {
                poDisplay.innerHTML = '-';
                poDisplay.setAttribute('data-po0', '-');
                poDisplay.setAttribute('data-po1', '');
                poDisplay.setAttribute('data-po2', '');
                poDisplay.setAttribute('data-po3', '');
            }
            let icsDisplay = card.querySelector('.ics span');
            if (icsDisplay) icsDisplay.innerHTML = '-';
            let descDisplay = card.querySelector('.desc-text');
            if (descDisplay) descDisplay.innerHTML = '-';
            let hrDisplay = card.querySelector('.hr span');
            if (hrDisplay) hrDisplay.innerHTML = '0';
            let shDisplay = card.querySelector('.sh span');
            if (shDisplay) shDisplay.innerHTML = '0';
            let oaDisplay = card.querySelector('.oa span');
            if (oaDisplay) oaDisplay.innerHTML = '0';

            let sumPlan = card.querySelector('.sum-plan');
            if (sumPlan) sumPlan.innerHTML = '0';

            let progCont = card.querySelector('.progress-container');
            if (progCont) {
                progCont.setAttribute('data-ar', '0');
                progCont.setAttribute('data-plan', '0');
            }

            if (cardLink) {
                try {
                    const url = new URL(cardLink.href, window.location.origin);
                    const paramsToBlank = [
                        'var-TargetPO0', 'var-TargetPO1', 'var-TargetPO2', 'var-TargetPO3',
                        'var-TargetICS0', 'var-TargetICS1', 'var-TargetICS2', 'var-TargetICS3',
                        'var-TargetICSName0', 'var-TargetICSName1', 'var-TargetICSName2', 'var-TargetICSName3',
                        'var-TargetvIcsName0', 'var-TargetvIcsName1', 'var-TargetvIcsName2', 'var-TargetvIcsName3',
                        'var-TargetCreateDate0','var-TargetCreateDate1','var-TargetCreateDate2','var-TargetCreateDate3',
                        'var-Targetplan_qty0', 'var-Targetplan_qty1', 'var-Targetplan_qty2', 'var-Targetplan_qty3'
                    ];
                    paramsToBlank.forEach(param => url.searchParams.set(param, '-'));
                    cardLink.href = url.toString();
                } catch(e) { console.warn('href update error:', e); }
            }

            if (clonedLink && cardLink && cardLink.parentNode) {
                cardLink.parentNode.insertBefore(clonedLink, cardLink.nextSibling);
            }
        }
    });

    // 1. ฟอร์แมตตัวเลข (ใส่คอมม่าให้ทุกคลาส fmt-num รวมถึง sum-plan)
    document.querySelectorAll('.fmt-num').forEach(el => {
        const textVal = el.innerText.trim();
        if (textVal !== 'No Data' && textVal !== '-' && textVal !== '') {
            const numVal = parseFloat(textVal.replace(/,/g, ''));
            if (!isNaN(numVal)) el.innerText = numVal.toLocaleString('en-US');
        }
    });

    // 2. จัดการค่า OA และเปลี่ยนสีตามเงื่อนไข
    document.querySelectorAll('.fmt-oa').forEach(el => {
        const textVal = el.innerText.trim();
        let numVal = 0;
        if (textVal !== '0' && textVal !== '' && textVal !== '-') {
            let parsedVal = parseFloat(textVal.replace(/,/g, ''));
            if (!isNaN(parsedVal)) numVal = parsedVal;
        }
        el.innerText = numVal.toFixed(1) + '%';
        if (numVal >= 95) el.style.color = '#059669';
        else if (numVal >= 80) el.style.color = '#D97706';
        else el.style.color = '#DC2626';
    });

    // 3. ตัดข้อความ Desc ที่ยาวเกินไป
    document.querySelectorAll('.desc-text').forEach(el => {
        if (!el.querySelector('.no-data') && el.innerText.trim() !== '-') {
            const fullText = el.innerText.trim();
            if (fullText.length > 10) el.innerText = fullText.substring(0, 10) + '...';
        }
    });

    // 4. จัดการ Progress Bar (ดึง %AR จาก SQL ตรงๆ เลย)
    let styleBlock = document.getElementById('grafana-progress-styles') || document.createElement('style');
    styleBlock.id = 'grafana-progress-styles';
    if (!styleBlock.parentNode) document.head.appendChild(styleBlock);

    let cssRules = ['.progress-fill { transition: width 1.5s cubic-bezier(0.25, 1, 0.5, 1), background 0.5s ease !important; }'];

    document.querySelectorAll('.progress-container').forEach((container, index) => {
        let uid = container.getAttribute('data-uid') || ('unknown_' + index);

        // 🚀 ดึง AR% และ Plan ที่ SQL คำนวณไว้แล้วมาใช้
        let arPercent = parseFloat(container.getAttribute('data-ar')) || 0;
        let plan = parseFloat(container.getAttribute('data-plan')) || 0;

        let visualPercent = arPercent > 100 ? 100 : arPercent;
        let safeKey = uid.replace(/["\\]/g, '\\$&');

        if (arPercent >= 100 && plan > 0) {
            cssRules.push(`
                .progress-fill[data-uid="${safeKey}"] { width: ${visualPercent}% !important; background: linear-gradient(90deg, #34d399 0%, #059669 100%) !important; }
                .progress-text[data-uid="${safeKey}"]::after { content: "${arPercent.toFixed(1)}%"; color: #059669 !important; }
            `);
        } else {
            cssRules.push(`
                .progress-fill[data-uid="${safeKey}"] { width: ${visualPercent}% !important; background: linear-gradient(90deg, #60a5fa 0%, #2563eb 100%) !important; }
                .progress-text[data-uid="${safeKey}"]::after { content: "${arPercent.toFixed(1)}%"; color: #1e293b !important; }
            `);
        }
    });
    styleBlock.innerHTML = cssRules.join('\n');

    // 5. คำนวณจำนวน Prod.Ord.No. ที่เพิ่มมา (+n)
    document.querySelectorAll('.po-display').forEach(el => {
        if (el.querySelector('.no-data') || el.innerText.trim() === '-') return;
        const po0 = el.getAttribute('data-po0') || '';
        const items = [el.getAttribute('data-po1'), el.getAttribute('data-po2'), el.getAttribute('data-po3')];
        const count = items.filter(x => x && x.trim() !== '-' && x.trim() !== '').length;
        if (count > 0) el.innerHTML = `${po0} <span style="color: #9ca3af; font-weight: 500; font-size: 0.95em;">(+${count})</span>`;
    });

    // 6. จัดกลุ่มการ์ดตามชื่อเครื่อง (Machine)
    document.querySelectorAll('.status-grid').forEach(grid => {
        if (grid.getAttribute('data-grouped') === 'true') return;
        const cards = Array.from(grid.querySelectorAll('.card-link'));
        if (cards.length === 0) return;

        const machineGroups = {};
        const groupOrder = [];

        cards.forEach(card => {
            const machineNameEl = card.querySelector('.machine-name');
            const machineName = machineNameEl ? machineNameEl.innerText.trim() : 'Unknown';
            if (!machineGroups[machineName]) {
                machineGroups[machineName] = [];
                groupOrder.push(machineName);
            }
            machineGroups[machineName].push(card);
        });

        grid.innerHTML = '';
        groupOrder.forEach(machineName => {
            const col = document.createElement('div');
            col.className = 'machine-column';
            const groupCards = machineGroups[machineName];
            groupCards.sort((a, b) => {
                const statusA = a.querySelector('.card-box').getAttribute('data-status');
                const statusB = b.querySelector('.card-box').getAttribute('data-status');
                if (statusA === 'Order End' && statusB !== 'Order End') return 1;
                if (statusB === 'Order End' && statusA !== 'Order End') return -1;
                return 0;
            });
            groupCards.forEach(card => col.appendChild(card));
            grid.appendChild(col);
        });
        grid.setAttribute('data-grouped', 'true');
    });

// ============================================================
// 6.5 Persistent Filter Stylesheet (กันกระพริบตอน refresh)
// ============================================================
function getFilterStyleBlock() {
    let block = document.getElementById('grafana-filter-styles');
    if (!block) {
        block = document.createElement('style');
        block.id = 'grafana-filter-styles';
        document.head.appendChild(block);
    }
    return block;
}

function applyHiddenStatusStyles() {
    window.grafanaDashboardHiddenStatuses = window.grafanaDashboardHiddenStatuses || new Set();
    const block = getFilterStyleBlock();
    const rules = Array.from(window.grafanaDashboardHiddenStatuses).map(status => {
        const safe = status.replace(/["\\]/g, '\\$&');
        return `.card-link:has(.card-box[data-status="${safe}"]) { display: none !important; }`;
    });
    block.innerHTML = rules.join('\n');
}

// เรียกทันทีตั้งแต่ต้นสคริปต์ เพื่อให้กฎ CSS มีผลก่อนการ์ดใหม่ถูกแทรก
applyHiddenStatusStyles();

// ============================================================
// 6.6 Build Executive Summary Bar
// ============================================================
function buildSummaryBar() {
    const bar = document.getElementById('exec-summary-bar');
    if (!bar) return;

    const EXCLUDE_FROM_TOTAL = ['Order End'];

    // กำหนดสไตล์ไว้ล่วงหน้าเฉพาะสถานะที่รู้จัก ส่วนสถานะใหม่ๆ จะใช้ fallback
    const knownStyles = {
        'Mass Pro':  { cls: 'mass-pro',  order: 1 },
        'Dandori':   { cls: 'dandori',   order: 2 },
        'Stop':      { cls: 'stop',      order: 3 },
        'No Plan':   { cls: 'no-plan',   order: 4 },
        'Order End': { cls: 'order-end', order: 5 },
        '4M Change': { cls: 'four-m',    order: 6 },
        'Offline':   { cls: 'offline',   order: 7 },
        'Alarm':     { cls: 'alarm',     order: 8 }
    };

    const cards = document.querySelectorAll('.card-box');
    const counts = {};
    let totalOA = 0;
    let oaCount = 0;

    // สแกนสถานะจริงจากการ์ดทั้งหมด ไม่ผูกกับ list ที่ fix ไว้
    cards.forEach(card => {
        const st = (card.getAttribute('data-status') || 'Unknown').trim();
        counts[st] = (counts[st] || 0) + 1;

        const oaEl = card.querySelector('.fmt-oa');
        if (oaEl) {
            const oaVal = parseFloat(oaEl.innerText);
            if (!isNaN(oaVal) && oaVal > 0 && !['Order End', 'Offline', 'No Plan'].includes(st)) {
                totalOA += oaVal;
                oaCount++;
            }
        }
    });

    // Total = รวมทุกสถานะ ยกเว้นสถานะที่อยู่ใน EXCLUDE_FROM_TOTAL
    const total = Object.entries(counts)
        .filter(([key]) => !EXCLUDE_FROM_TOTAL.includes(key))
        .reduce((sum, [, val]) => sum + val, 0);

    const running = (counts['Mass Pro'] || 0) + (counts['Dandori'] || 0);
    const stopped = counts['Stop'] || 0;
    const avgOA = oaCount > 0 ? (totalOA / oaCount) : 0;
    const oaColor = avgOA >= 95 ? '#4ade80' : avgOA >= 80 ? '#fbbf24' : '#f87171';

    // เรียง legend: สถานะที่รู้จักก่อนตามลำดับที่กำหนด ตามด้วยสถานะใหม่เรียงตามตัวอักษร
    const statusKeys = Object.keys(counts).filter(k => counts[k] > 0);
    statusKeys.sort((a, b) => {
        const oa = knownStyles[a] ? knownStyles[a].order : 999;
        const ob = knownStyles[b] ? knownStyles[b].order : 999;
        if (oa !== ob) return oa - ob;
        return a.localeCompare(b);
    });

    const legendHTML = statusKeys.map(key => {
        const style = knownStyles[key];
        const isInactive = window.grafanaDashboardHiddenStatuses.has(key);
        if (style) {
            // สถานะที่รู้จัก ใช้ class สีที่กำหนดไว้ล่วงหน้า
            return `
            <span class="legend-chip ${style.cls}${isInactive ? ' inactive' : ''}" data-status="${key}">
                <span class="legend-dot"></span>
                ${key}: <strong>${counts[key]}</strong>
            </span>`;
        } else {
            // สถานะใหม่ที่ยังไม่รู้จัก ใช้ fallback style (สีเทากลาง)
            return `
            <span class="legend-chip legend-chip-fallback${isInactive ? ' inactive' : ''}" data-status="${key}">
                <span class="legend-dot"></span>
                ${key}: <strong>${counts[key]}</strong>
            </span>`;
        }
    }).join('');

    bar.innerHTML = `
        <div class="exec-stats">
            <div class="exec-bar-title-wrapper">
                <img src="/public/img/Logo_Narong-Pat.png" class="exec-logo-img" alt="Logo">
                <div class="exec-bar-title">
                    <div class="exec-bar-name">One Stanley Narong-Pat Machine Status V2.0</div>
                    <div class="exec-bar-copy">© 2026 Thai Stanley Electric PCL. All Rights Reserved.</div>
                </div>
            </div>
            <div class="stat-divider"></div>
            <div class="stat-item total">
                <div class="stat-value">${total}</div>
                <div class="stat-label">Total Machines</div>
            </div>
            <div class="stat-item running">
                <div class="stat-value">${running}</div>
                <div class="stat-label">Running</div>
            </div>
            <div class="stat-item stopped">
                <div class="stat-value">${stopped}</div>
                <div class="stat-label">Stop</div>
            </div>
            <div class="stat-item avg-oa" style="border-color: ${oaColor}44;">
                <div class="stat-value" style="color: ${oaColor};">${avgOA.toFixed(1)}%</div>
                <div class="stat-label">Avg %OA</div>
            </div>
            <div class="stat-divider"></div>
            <div class="stat-legend-wrapper" style="display: flex; flex-direction: column; justify-content: center;">
                <div class="stat-legend" style="margin-left: 4px; margin-bottom: 8px;">
                    ${legendHTML}
                </div>
                <div style="font-size: 10px; color: rgba(253, 186, 116, 0.6); margin-left: 8px; font-weight: 600; letter-spacing: 0.5px; text-transform: uppercase;">
                    👆 Click to show/hide
                </div>
            </div>
        </div>
    `;

    bar.querySelectorAll('.legend-chip').forEach(chip => {
        const targetStatus = chip.getAttribute('data-status');
        chip.title = 'Click to show/hide these machines';

        chip.addEventListener('click', function () {
            if (window.grafanaDashboardHiddenStatuses.has(targetStatus)) {
                window.grafanaDashboardHiddenStatuses.delete(targetStatus);
                this.classList.remove('inactive');
            } else {
                window.grafanaDashboardHiddenStatuses.add(targetStatus);
                this.classList.add('inactive');
            }
            applyHiddenStatusStyles();
            collapseEmptyColumns();
        });
    });

    collapseEmptyColumns();
}

function collapseEmptyColumns() {
    document.querySelectorAll('.machine-column').forEach(col => {
        const visibleCards = Array.from(col.querySelectorAll('.card-link'))
            .filter(c => getComputedStyle(c).display !== 'none');
        col.style.display = visibleCards.length === 0 ? 'none' : 'flex';
    });
}

buildSummaryBar();

    // 7. ฟังก์ชัน Timer (นับเวลาสด) จำกัดเวลาสูงสุด 744:59:59
    function updateTimers() {
        document.querySelectorAll('.live-duration').forEach(el => {
            const status = el.getAttribute('data-status');
            const startStr = el.getAttribute('data-start');
            if (['Order End', 'Offline'].includes(status) || !startStr) {
                el.innerText = '--:--:--'; return;
            }
            let startTime = new Date(startStr).getTime();
            if (isNaN(startTime)) startTime = Number(startStr) > 9999999999 ? Number(startStr) : Number(startStr) * 1000;

            let diffSec = Math.max(0, Math.floor((Date.now() - startTime) / 1000));

            // กำหนดค่าลิมิตวินาทีสูงสุดที่ 744:59:59 (744 ชั่วโมง * 3600 + 59 นาที * 60 + 59 วินาที)
            const MAX_SEC = 2681999;
            diffSec = Math.min(diffSec, MAX_SEC); // บังคับไม่ให้ค่าเกิน 2681999

            const h = String(Math.floor(diffSec / 3600)).padStart(2, '0');
            const m = String(Math.floor((diffSec % 3600) / 60)).padStart(2, '0');
            const s = String(diffSec % 60).padStart(2, '0');
            el.innerText = `${h}:${m}:${s}`;
        });
    }

    if (window.grafanaLiveTimer) clearInterval(window.grafanaLiveTimer);
    updateTimers();
    window.grafanaLiveTimer = setInterval(updateTimers, 1000);

} catch (e) { console.error('Script Error:', e); }
```

### 4.2 อ่านทีละขั้น

#### ขั้น 0 - Order End ชั้นที่ 2 (ตรรกะสำคัญที่สุดในไฟล์นี้)

1. หา `GRAFANA_TZ` จาก `${__timezone}` ของ dashboard - มี fallback 3 ชั้น (`browser` → tz เบราว์เซอร์, `utc` → `UTC`, ไม่แทนค่า → tz เบราว์เซอร์)
2. `getZonedParts()` ใช้ `Intl.DateTimeFormat.formatToParts` ดึง ปี/เดือน/วัน/ชั่วโมง ตาม tz นั้น - **รองรับ DST ถูกต้อง** (DESIGN.md §9.6 ระบุว่านี่คือวิธีที่ถูก)
3. `getProductionShiftInfo()` ตัดสินกะ:
   - `hour >= 8 && hour < 20` → `Morning` มิฉะนั้น `Night`
   - ถ้าเป็น `Night` และ `hour < 8` → **production date ถอยไป 1 วัน** (ผ่าน `Date.UTC` เพื่อให้ข้ามเดือน/ปีถูก)
   - คืน `{ dateString: 'YYYY-MM-DD', shift: 'Morning' | 'Night' }`
4. วนทุกการ์ดที่สถานะเป็น `Mass Pro` / `Dandori` / `Stop` และมี PO0 จริง แล้วอ่าน `vCreateDateTxt0..3` จาก `.hidden-dates`
   - `decodeURIComponent` (คลาย `%20` ที่ SQL ใส่ไว้) → เติม `T` และ `Z` ให้เป็น ISO 8601 → `new Date()`
   - เทียบกับกะปัจจุบัน - **ถ้ามี slot ใดตรง ถือว่ายังเป็นใบสั่งของกะนี้**
5. ถ้าไม่มี slot ไหนตรงเลย → **แตกการ์ดเป็น 2 ใบ**

| การ์ด | `data-status` | เนื้อหา |
|---|---|---|
| **ใบเดิม** (อยู่ที่เดิม) | คงสถานะจริง (`Mass Pro`/`Stop`/…) | ล้างข้อมูลใบสั่งทิ้งหมด: PO/ICS/Desc = `-`, Output/Plan/OA = `0`, `data-ar`/`data-plan` = `0`, href ทุก param ของใบสั่งถูก set เป็น `-` |
| **ใบโคลน** (แทรกต่อท้าย) | `Order End` | ข้อมูลใบสั่งเดิมครบ · badge เขียนว่า `Order End` · timer = `--:--:--` · `data-uid` ต่อท้าย `-oe` เพื่อไม่ให้กฎ CSS ชนกับใบเดิม |

> อ่านความหมายได้ว่า: *"เครื่องยังเดินอยู่ (สถานะจริง) แต่ใบสั่งที่โหลดอยู่ไม่ใช่ของกะนี้แล้ว -
> ใบเก่าที่จบไปแสดงแยกไว้อีกใบ"*

#### ขั้น 1–3 - format

| ขั้น | ทำอะไร |
|---|---|
| 1 | `.fmt-num` → `toLocaleString('en-US')` (ใส่คอมม่า) ข้าม `No Data` / `-` / ว่าง |
| 2 | `.fmt-oa` → `toFixed(1) + '%'` + ระบายสี **≥95 เขียว `#059669` · ≥80 ส้ม `#D97706` · ต่ำกว่า แดง `#DC2626`** |
| 3 | `.desc-text` ตัดที่ 10 ตัวอักษร + `...` (ข้อความเต็มยังอยู่ใน `title`) |

#### ขั้น 4 - Progress bar

ไม่ใช้ inline style แต่ **generate `<style id="grafana-progress-styles">` ทั้งก้อน** แล้วเลือกเป้าหมายด้วย
`[data-uid="…"]`:

- `width` = `min(AR%, 100)` - บาร์ตันที่ 100% แต่ **ข้อความแสดงค่าจริงที่เกิน 100% ได้**
- `arPercent >= 100 && plan > 0` → gradient เขียว + ข้อความสีเขียว
- นอกนั้น → gradient น้ำเงิน + ข้อความสี `#1e293b`
- ข้อความใส่ผ่าน `::after { content: "…" }` ไม่ใช่ DOM text
- `transition: width 1.5s cubic-bezier(...)` - เอฟเฟกต์วิ่งของบาร์

#### ขั้น 5 - `(+n)`

ถ้ามี `data-po1..3` ที่ไม่ว่างและไม่ใช่ `-` → ต่อท้ายเลขใบสั่งแรกด้วย `(+n)` สีเทา
(ตรงกับที่ DESIGN.md §9.2 ข้อ 6 / D-27 บันทึกไว้)

#### ขั้น 6 - จัดคอลัมน์ตามเครื่อง

- จัดกลุ่มการ์ดตาม `.machine-name` แล้วสร้าง `.machine-column` ต่อเครื่อง
- ลำดับคอลัมน์ = ลำดับที่เจอเครื่องครั้งแรก (มาจาก `ORDER BY` ของ SQL: zone → weight → machine)
- ในแต่ละคอลัมน์ **การ์ด `Order End` ถูกดันไปท้ายเสมอ**
- ใช้ flag `data-grouped="true"` กันทำซ้ำ

#### ขั้น 6.5–6.6 - Exec summary bar + filter

**การนับ**

```
counts[status] = จำนวน "การ์ด" ที่มีสถานะนั้น   (ไม่ใช่จำนวนเครื่อง)
total   = Σ counts ยกเว้น 'Order End'
running = counts['Mass Pro'] + counts['Dandori']
stopped = counts['Stop']
avgOA   = ค่าเฉลี่ยอย่างง่ายของ .fmt-oa เฉพาะการ์ดที่
          oaVal > 0  และสถานะไม่ใช่ Order End / Offline / No Plan
```

สี Avg %OA: `≥95 #4ade80` · `≥80 #fbbf24` · ต่ำกว่า `#f87171`

**Legend & filter**

- legend สร้างจากสถานะที่ **พบจริง** ไม่ใช่ list ตายตัว - สถานะที่ไม่รู้จักได้ class `legend-chip-fallback`
- ลำดับที่กำหนดไว้: `Mass Pro`(1) `Dandori`(2) `Stop`(3) `No Plan`(4) `Order End`(5) `4M Change`(6) `Offline`(7) `Alarm`(8) → นอกนั้นเรียงตามตัวอักษร
- คลิก chip = toggle ซ่อน/แสดง เก็บสถานะไว้ที่ `window.grafanaDashboardHiddenStatuses` (`Set`)
- ซ่อนด้วย CSS `.card-link:has(.card-box[data-status="…"]) { display: none }` ใน `<style id="grafana-filter-styles">`
  → **`applyHiddenStatusStyles()` ถูกเรียกตั้งแต่ต้นสคริปต์ เพื่อให้กฎมีผลก่อนการ์ดใหม่ถูกแทรก (กันกระพริบตอน auto-refresh)**
- `collapseEmptyColumns()` ยุบคอลัมน์ที่ไม่เหลือการ์ดที่มองเห็น

#### ขั้น 7 - Live timer

- `setInterval` 1 วินาที · เก็บ handle ไว้ที่ `window.grafanaLiveTimer` และ `clearInterval` ก่อนตั้งใหม่ทุกครั้ง (กัน timer ซ้อนตอน re-render)
- สถานะ `Order End` / `Offline` หรือไม่มี `data-start` → แสดง `--:--:--`
- parse `data-start` ด้วย `new Date()` · ถ้าไม่ผ่านจึงเดาว่าเป็น epoch (วินาทีหรือมิลลิวินาที)
- clamp สูงสุด `2681999` วินาที = **744:59:59** (31 วัน)

---

## 5. อะไรคำนวณที่ไหน - ตารางสรุป

| ค่า | SQL | JavaScript | ต้องย้ายไป backend |
|---|:--:|:--:|---|
| สถานะล่าสุดต่อเครื่อง | ✅ | | Q-01 |
| `Order End` ชั้น 1 (`seq > 1`) | ✅ | | Q-02 |
| **`Order End` ชั้น 2 (เทียบกะ)** | | ✅ | **Q-02 - ยังไม่ทำ** |
| **แตกการ์ดเป็น 2 ใบ** | | ✅ | ต้องตัดสินใจว่า contract จะแทนด้วยอะไร |
| `%OA` ต่อ PO × machine | ✅ | | ✅ `server/src/domain/oa.ts` |
| `%AR` ต่อการ์ด | ✅ | | ✅ `achievementFrom()` |
| `OutputActual`, `Output/Hr` | ✅ | | |
| นับ Running / Stopped / Total | | ✅ | **Q-02 - ยังไม่ทำ** |
| **Avg %OA (simple average)** | | ✅ | D-20 · `server/src/domain/oa.ts` |
| format ตัวเลข / สี threshold | | ✅ | เป็นเรื่อง presentation → อยู่ที่ frontend ได้ |
| จัดคอลัมน์ / filter / timer | | ✅ | presentation |

---

## 6. ข้อค้นพบ / bug / ประเด็นค้าง

| # | เรื่อง | รายละเอียด | อ้างอิง |
|---|---|---|---|
| **F-01** | **drill-down param ว่างเปล่า 11 ตัว** | href ส่ง `mainGroup`, `process`, `shift`, `mode`, `status`, `cycle_time`, `avr_cycle_time`, `time_mold_opening`, `time_mold_end`, `time_injection`, `qty`, `cavity` แต่ **ไม่มีชื่อเหล่านี้ใน `SELECT`** → ได้ค่าว่างเสมอ · `std_time` ยิ่งพลาดซ้อน เพราะ SQL ส่งชื่อ `STD_Time` (Handlebars case-sensitive) | ขยายจาก DESIGN.md §10 ที่ระบุไว้แค่ `mainGroup` |
| **F-02** | **`{{QtyColor}}` ไม่มีอยู่จริง** | ใช้เป็น class ของ OUTPUT ACTUAL แต่ไม่มีใน `SELECT` → class ว่างเปล่าตลอด | ใหม่ |
| **F-03** | **time picker แทบไม่มีผลกับตัวเลข** | `$__timeFrom/$__timeTo` ใช้ใน `POs_To_Show` เท่านั้น · `TotalOutput_Per_PO` และ `RealtimeStatus_Latest`/`StatusPerPO_Latest` ใช้ `now() - INTERVAL` ตายตัว → **เลื่อน time picker แล้ว Output/%OA ไม่เปลี่ยน** เปลี่ยนแค่ว่ามีการ์ด `Order End`/`Pending` เก่ากี่ใบ · **v4 (2026-09-10): ค่าตายตัวนั้นขยับจาก `'1 days'` เป็น `'3 days'`** ยืนยันเป็นกฎธุรกิจจริงจาก IOT ไม่ใช่บั๊ก - พอร์ตมาแล้วที่ `server/src/influx/queries.ts`'s `OA_WINDOW_HOURS` (24→71, ดู §0) | DESIGN.md §10 "Time window hardcode" |
| **F-04** | **`AR_percent` คืน `0` เมื่อ `TotalPlan = 0`** | ขัดกับ rule R2 "ไม่มีข้อมูล ≠ ศูนย์" · THS 6338 ส่ง `plan_qty = 0` ทุกแถว → บอร์ดขึ้น 0% ทั้งที่ควรขึ้น "ไม่มีแผน" | DESIGN.md §9.2 ข้อ 2 |
| **F-05** | **`StatusStartTime` ไม่ถูกบังคับเป็น UTC** | โค้ดขั้น 0 ระมัดระวังมากกับ `vCreateDateTxt` (เติม `Z` เอง) แต่ `data-start` ของ timer ส่งเข้า `new Date(startStr)` ตรงๆ · ถ้า `CAST(... AS VARCHAR)` ให้ string ที่ไม่มี `Z`/offset เบราว์เซอร์จะตีความเป็น **local time** → ที่ไทยจะเพี้ยน 7 ชม. และ `Math.max(0, …)` จะทำให้ timer ค้างที่ `00:00:00` · **ต้องตรวจ output จริงของ cast ก่อนสรุป** | ใหม่ - ต้องยืนยัน |
| **F-06** | **Avg %OA มี bias สูงเกินจริง** | เงื่อนไข `oaVal > 0` ตัดเครื่องที่ %OA เป็น 0 จริงๆ ออกจากตัวหาร → ค่าเฉลี่ยสูงกว่าความจริง · และเป็น simple average ต่อการ์ด ไม่ถ่วงน้ำหนักด้วยชิ้น/เวลา | DESIGN.md D-20 |
| **F-07** | **`Offline` มีใน legend แต่ไม่มีใครสร้าง** | `knownStyles` และ timer รู้จัก `Offline` แต่ไม่มีโค้ดส่วนไหนตั้งค่านี้ → เครื่องที่ telemetry หลุดค้างสถานะเดิมตลอด | DESIGN.md §8.4, T-11 |
| **F-08** | **`Alarm` โผล่ใน legend แต่ไม่มีใน enum ของ DESIGN.md** | `knownStyles` มี `'Alarm'` (order 8) - ต้องยืนยันว่า `production_machine_status.Result` ส่งค่านี้จริงไหม แล้วเติมเข้า enum | ใหม่ |
| **F-09** | **threshold ไม่สอดคล้องกัน** | `SumCycle` ใช้ `std_time + 20` แต่ `OA_percent` ใช้ `std_time + 100` (และ `SumCycle` ไม่ถูกใช้เลย) | DESIGN.md D-22 |
| **F-10** | **`MIN` vs `MAX` std_time** | `OA_percent` ใช้ `MIN(std_time)` แต่คอลัมน์ `STD_Time` ใช้ `MAX(std_time)` - ถ้า std เปลี่ยนกลาง PO ผลจะเพี้ยน | DESIGN.md §9.1 ข้อ 4 |
| **F-11** | **dead column 4 ตัว** | `ModeStatus`, `STD_Time`, `SumCycle` คำนวณแล้วไม่มีใครใช้ · `_sort_weight`/`_sort_time` ใช้แค่ `ORDER BY` แต่ยังถูกส่งลง client | ใหม่ |
| **F-12** | **`FULL JOIN` ด้วย `machine` อย่างเดียว** | ปลอดภัยเพราะ query กรอง 1 plant · **แต่ query ระดับ global ต้อง join ด้วย `(codeCompany, plant, machine)`** ไม่งั้นเครื่องชื่อซ้ำข้ามโรงงานจะปนกัน | DESIGN.md §10 |
| **F-13** | ~~กะ hardcode 08:00–20:00 สองกะ~~ **ล้าสมัย 2026-09-10** | เดิมอยู่ใน `getProductionShiftInfo()` ของ v3 - **ทั้งฟังก์ชันและ layer 2 ที่มันรองรับถูกถอดออกจาก panel จริงแล้ว** (§0) ไม่มีการเทียบกะที่ไหนใน SQL หรือ JS ของเวอร์ชันปัจจุบันอีกต่อไป | §0, DESIGN.md §9.5 (ปิดประเด็น ไม่ใช่แก้ไข) |
| **F-14** | **SQL variable interpolate ตรงๆ** | `'${Lamp_var}'`, `${Zone_var:singlequote}` ต่อ string เข้า SQL - ใน Grafana รับได้ แต่ **web app ต้อง parameterize** | ใหม่ |
| **F-15** | **HTML/CSS สร้างจาก string ที่มาจาก DB** | `legendHTML` เอาค่าสถานะไปต่อเป็น HTML · `cssRules` เอา `machine`/`PO` ไปต่อเป็น CSS โดย escape แค่ `"` และ `\` - React จะแก้ให้เองแต่ควรรู้ไว้ | ใหม่ |
| **F-16** | **ต้องใช้ CSS `:has()`** | filter ทั้งระบบพึ่ง `:has()` → เบราว์เซอร์เก่าใช้ไม่ได้ | ใหม่ |
| **F-17** | **`hardcode machine exclusion` ไม่ปรากฏใน query นี้** | DESIGN.md §10 บันทึกว่ามี `machine != 'lA1','lA2','D2','D3','D4','P1l4'` ฝังใน SQL - v4 มี `AND "machine" != 'lA1' AND ... != 'P1l4'` อยู่ใน `RealtimeStatus_Latest`/`StatusPerPO_Latest` เท่านั้น ไม่อยู่ใน `All_IO_Ranked`/`TotalOutput_Per_PO` → เครื่องพวกนี้ยังมีผลต่อ `%OA`/output แม้จะไม่มีการ์ดสถานะ | DESIGN.md §10 |
| **F-18** | **`Pending` (v4) ไม่ถูกกันออกจาก `%OA` เฉลี่ยฝั่ง backend** | Grafana v4 ตัด `Pending` ออกจากทั้ง Total และ Avg %OA (`EXCLUDE_FROM_TOTAL`/`EXCLUDE_FROM_OA` ใน §0) แต่ `server/src/domain/oa.ts` ไม่รู้จักสถานะเครื่องเลย - คำนวณจาก `production_machine_io` ล้วน ไม่ join กับ `production_machine_status.Result` จึงนับเครื่องที่ถูกกด `Pending` ค้างไว้เข้าค่าเฉลี่ยด้วย ทั้งที่ Grafana ไม่นับ ผู้ต้องสงสัยหลักของช่องว่าง %OA plant 6051 (51.2% vs 50.9%, 2026-09-10) | §0, `server/src/domain/oa.ts`, `server/src/influx/queries.ts` `SUBSTANTIVE_STATUSES` |

---

## 7. สิ่งที่ web app ต้องทำต่อ

> **อัปเดต 2026-08-27 - ข้อ 1, 3, 4 ทำแล้ว** เอกสารนี้ถูกใช้ reconcile ตัวเลข THS
> กับบอร์ดจริง ผลคือ Total 19 → **29** · %OA 75.2% → **80.9%** รายละเอียดครบใน
> `docs/BACKEND-HANDOVER.md` §4.8
>
> | สิ่งที่แก้ | ที่ไหน |
> |---|---|
> | window 2 ชม. → 24 ชม. (ตามบอร์ด) | `server/src/influx/queries.ts` |
> | TOTAL = ทุกสถานะยกเว้น `Order End` | `server/src/domain/counts.ts` |
> | `Order End` ชั้น 2 (เทียบกะ) | `server/src/domain/orderShift.ts` |
> | เลิกให้ freshness label ล้าง census ของ plant | `server/src/services/globalOverviewService.ts` |
>
> **ห้ามใส่ตัวกรอง `process`** - ลองแล้วและถอดออก บอร์ดกรอง `${process_var}` ทีละ process
> แต่ exec board ต้องนับทุกเครื่องในไซต์ · 6332 มี `Injection` 26 + `Surface` 2 (`BP6`, `HC2`)
> ถ้ากรองจะได้ THS = 27 ทั้งที่หน้างานมี 29 (เหตุผลเต็มใน `server/src/config/policy.ts`)

1. ~~ย้าย `Order End` ชั้นที่ 2 ไป backend~~ **ยกเลิก 2026-09-10 - ไม่มีของให้ย้ายแล้ว** ยืนยันจาก panel
   สดว่า layer 2 (เทียบกะ) ถูกถอดออกจากทั้ง SQL และ JS จริง (§0) สิ่งที่ควรพอร์ตแทนคือกลไกใหม่: `Pending`
   จาก `production_machine_status.Result` (คนกดปุ่มเอง) ต้องกันออกจาก Avg %OA เหมือนที่ Grafana v4 ทำ
   (ดู F-18) - `server/src/domain/orderShift.ts` ที่พอร์ต layer 2 เก่ามาควรถูกทำเครื่องหมายว่าอิงข้อมูล
   ที่ล้าสมัยแล้ว ไม่ใช่ลบทิ้งทันที เพราะยังไม่กระทบตัวเลข (มันแค่รายงาน ไม่ตัดออก)
2. **ตัดสินใจว่า contract จะแทน "การ์ดที่แตกเป็น 2 ใบ" อย่างไร** - ตัวเลือกที่ตรงไปตรงมาคือ
   ให้เครื่องหนึ่งมี `currentOrder: null` + `lastEndedOrder: {...}` แทนการส่ง 2 record
3. **นิยาม "Total Machines" ใหม่** - บอร์ดเดิมนับ *การ์ด* (derive จากข้อมูลที่วิ่ง) จึงพลาดเครื่องที่ offline
   → ต้องมี master list (Q-08)
4. **`%AR` ที่ `TotalPlan = 0` ต้องเป็น `null`** ไม่ใช่ `0` และ UI ต้องแสดง "ไม่มีแผน"
5. **drill-down ส่งแค่ key** (`company, plant, machine, PO`) ให้ dashboard ปลายทาง query เอง - แทน 40 parameter
6. **เก็บ timestamp เป็น ISO 8601 พร้อม `Z` ใน JSON** อย่าให้ frontend ต้องเดา/ซ่อม format
   (และเลิกใช้ trick `REPLACE(' ', '%20')` - encode ที่ชั้น URL เท่านั้น)
7. **ตรวจ F-05 กับข้อมูลจริง** ก่อนย้าย timer มา React

---

## 8. สิ่งที่ยังไม่ได้เก็บในเอกสารนี้

| ส่วน | สถานะ |
|---|---|
| **CSS ของ panel** | ❌ ยังไม่มี - class ที่โค้ดอ้างถึงแต่ยังไม่รู้หน้าตา: `.card-box[data-status]`, `.machine-column`, `.legend-chip` (+ `mass-pro` `dandori` `stop` `no-plan` `order-end` `four-m` `offline` `alarm` `legend-chip-fallback` `inactive`), `.exec-stats` / `.stat-item` / `.stat-divider`, `.highlight-blue`, `.no-data` |
| **Panel JSON เต็ม** | ❌ - ยังไม่รู้ค่า refresh interval, datasource UID ที่ panel นี้ใช้จริง (มี 3 UID ปนกันในระบบ ตาม D-17), นิยาม variable `Lamp_var` / `process_var` / `Zone_var` |
| **สาขา `t03` / `{{else}}` แบบ byte-for-byte** | ⚠️ ย่อไว้ (เนื้อหาเหมือน `t01` ต่างแค่ suffix) |
| **Dashboard `adz5fli` (Global V1.0)** | ❌ ยังไม่ได้ถอด - DESIGN.md §1 ระบุว่าตัวนี้จะถูกแทนที่ด้วย web app |

---

## 9. อ้างอิง

- `docs/DESIGN.md` - §8 schema · §9 สูตร · §10 query ที่ต้องเขียนใหม่ · §12 open decisions
- `docs/BACKEND-HANDOVER.md` - สถานะงาน backend (Phase 3)
- `server/src/domain/oa.ts`, `server/src/domain/trend.ts` - สูตรที่ port มาแล้ว
