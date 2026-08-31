# คิวรี่ InfluxDB ด้วยมือ — คู่มือสั้น

เอกสารนี้คือชุดคำสั่งสำหรับ**ตรวจฐานข้อมูลเอง** เวลาตัวเลขบนแดชบอร์ดกับบอร์ด Grafana
ไม่ตรงกัน · schema เต็มอยู่ที่ `docs/DESIGN.md` §8 · ที่มาของสูตรอยู่ที่ §9

---

## 1. รันยังไง

```bash
node scripts/influx-query.mjs "SELECT ..."
node scripts/influx-query.mjs --file query.sql
node scripts/influx-query.mjs "SELECT ..." --csv    # เอาไปวางใน Excel
node scripts/influx-query.mjs "SELECT ..." --json
```

สคริปต์อ่าน `INFLUX_URL` / `INFLUX_DATABASE` / `INFLUX_TOKEN` จาก `server/.env` เอง
ไม่ต้องพิมพ์ token ลง command line (และไม่ตกไปอยู่ใน shell history)

endpoint นี้**อ่านอย่างเดียว** ยิงใส่ production ได้ไม่มีผลข้างเคียง

---

## 2. กับดัก 2 อย่างที่ต้องรู้ก่อนเริ่ม

### 2.1 คอลัมน์ตัวพิมพ์ใหญ่ปนเล็ก **ต้องใส่ double quote**

```sql
"Result"  "ProductionOrder0"  "vCreateDateTxt0"  "StatusStartTime"  "MachineStatus"
```

ถ้าไม่ใส่ DataFusion จะแปลงเป็นตัวเล็กหมด → คอลัมน์ไม่มีจริง → **InfluxDB ตอบ HTTP 500 พร้อม body ว่างเปล่า**
ไม่มีข้อความบอกอะไรเลย · สคริปต์จะเตือนให้ก่อนยิง

### 2.2 ต้องมีเงื่อนไข `time` เสมอ

```sql
WHERE "time" >= now() - INTERVAL '24 hours'
```

ถ้าไม่ใส่จะเจอ `Query would scan 432 Parquet files, exceeding the file limit`
และถ้าใส่กว้างเกิน ~3 วัน จะเจอ 500 body ว่างแบบเดียวกับข้อ 2.1 · **เพดานปลอดภัยคือ 71 ชั่วโมง**

---

## 3. คิวรี่ที่ใช้บ่อย

### 3.1 มีเครื่องอะไรบ้างใน plant นี้ — คิวรี่สำคัญที่สุด

ใช้เทียบว่าฐานข้อมูลเรากับบอร์ด Grafana เห็นเครื่องชุดเดียวกันไหม

```sql
SELECT DISTINCT "machine" AS machine, "process" AS process
FROM production_machine_status
WHERE "plant" = '6332'
  AND "time" >= now() - INTERVAL '24 hours'
ORDER BY machine
```

### 3.2 เครื่องนี้มีอยู่จริงไหม (ทุก plant)

```sql
SELECT DISTINCT "plant" AS plant, "machine" AS machine, "process" AS process
FROM production_machine_status
WHERE "time" >= now() - INTERVAL '24 hours'
  AND "machine" LIKE '%TC%'
```

### 3.3 มี plant อะไรบ้างใน instance นี้

```sql
SELECT DISTINCT "plant" AS plant
FROM production_machine_status
WHERE "time" >= now() - INTERVAL '24 hours'
ORDER BY plant
```

### 3.4 สถานะล่าสุดของแต่ละเครื่อง — ตัวเดียวกับที่แดชบอร์ดใช้นับ

```sql
SELECT machine, process, result, last_seen FROM (
  SELECT "machine" AS machine, "process" AS process,
         "Result" AS result, "time" AS last_seen,
         ROW_NUMBER() OVER (PARTITION BY "machine" ORDER BY "time" DESC) AS rn
  FROM production_machine_status
  WHERE "plant" = '6332'
    AND "time" >= now() - INTERVAL '24 hours'
    -- ข้ามธงกระพริบ เอาเฉพาะสถานะหลักล่าสุด (ดู queries.ts · SUBSTANTIVE_STATUSES)
    AND "Result" IN ('Mass Pro','Dandori','Stop','No Plan','Order End','4M Change','Offline')
) t WHERE rn = 1
ORDER BY machine
```

ตัด `AND "Result" IN (...)` ออก ถ้าอยากเห็นแถวล่าสุดจริงๆ รวม `Warning`/`Alarm`/`Pending`

### 3.5 นับสถานะ — ได้ TOTAL / RUNNING / STOP

```sql
SELECT result, COUNT(*) AS machines FROM (
  SELECT "Result" AS result,
         ROW_NUMBER() OVER (PARTITION BY "machine" ORDER BY "time" DESC) AS rn
  FROM production_machine_status
  WHERE "plant" = '6332' AND "process" = 'Injection'
    AND "time" >= now() - INTERVAL '24 hours'
    AND "Result" IN ('Mass Pro','Dandori','Stop','No Plan','Order End','4M Change','Offline')
) t WHERE rn = 1
GROUP BY result
ORDER BY machines DESC
```

- `TOTAL` = ผลรวมทุกแถว **ยกเว้น `Order End`**
- `RUNNING` = `Mass Pro` + `Dandori`
- `STOP` = ที่เหลือ

### 3.6 เครื่องนี้สถานะกระพริบไหม

ใช้ตอนสงสัยว่าทำไมเครื่องเด้งไปมาระหว่าง RUNNING กับ STOP

```sql
SELECT "Result" AS result, "time" AS t
FROM production_machine_status
WHERE "plant" = '6332' AND "machine" = 'HC2'
  AND "time" >= now() - INTERVAL '3 hours'
ORDER BY "time" DESC
LIMIT 20
```

`HC2` เคยอ่านได้ว่า `Warning ← Mass Pro ← Warning ← Mass Pro` สลับทุกแถว — เครื่องเดินอยู่ แค่ยกธงเตือน

### 3.7 %OA รายเครื่อง — สูตรเดียวกับบอร์ด (DESIGN.md §9.1)

```sql
SELECT "machine" AS machine,
       MIN("std_time") AS min_std,
       SUM("qty") AS pcs,
       SUM(CASE WHEN "cycle_time" > "std_time" + 100
                THEN "std_time" * "qty" ELSE "cycle_time" * "qty" END) AS weighted,
       (MIN("std_time") * SUM("qty"))
         / NULLIF(SUM(CASE WHEN "cycle_time" > "std_time" + 100
                           THEN "std_time" * "qty" ELSE "cycle_time" * "qty" END), 0)
         * 100 AS oa_pct,
       MAX("time") AS last_row
FROM production_machine_io
WHERE "plant" = '6332'
  AND "time" >= now() - INTERVAL '24 hours'
  AND "ProductionOrder0" IS NOT NULL AND "ProductionOrder0" != '' AND "ProductionOrder0" != '-'
GROUP BY "machine", "ProductionOrder0"
ORDER BY machine
```

### 3.8 ใบสั่งที่เครื่องโหลดอยู่ + เวลาสร้าง (ใช้ตัดสิน `Order End` ชั้น 2)

```sql
SELECT "machine" AS machine,
       "ProductionOrder0" AS po0,
       MAX("vCreateDateTxt0") AS created0,
       MAX("time") AS last_row
FROM production_machine_io
WHERE "plant" = '6332'
  AND "time" >= now() - INTERVAL '24 hours'
GROUP BY "machine", "ProductionOrder0"
ORDER BY machine
```

`vCreateDateTxt` เป็น **UTC** และมี 2 รูปแบบ: `2026-08-27 01:02:56` กับ `2026/08/26 20:00:00`
ส่วน `-` แปลว่าไม่มีใบสั่งใน slot นั้น (ไม่ใช่ข้อมูลเสีย)

### 3.9 คอลัมน์ทั้งหมดของตาราง

```sql
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'production_machine_status'
ORDER BY column_name
```

---

## 4. เทียบกับ datasource ของบอร์ด Grafana

ตรงนี้คือประเด็นที่ค้างอยู่ (D-17) — บอร์ดเห็นเครื่องที่ฐานข้อมูลเราไม่มี

**ขั้นตอน**

1. Grafana → เปิด dashboard `Machine Status V2.0` (`adz5fll`)
2. **Dashboard settings → JSON Model** → หาคำว่า `"datasource"` ของ panel นั้น จดค่า `uid`
3. Grafana → **Connections → Data sources** → หา datasource ที่ UID ตรงกัน → ดู **URL** กับ **Database**
4. เทียบกับ `INFLUX_URL` / `INFLUX_DATABASE` ใน `server/.env`

**หรือทางลัด** — เปิด **Explore** ใน Grafana เลือก datasource ของบอร์ด แล้ววางคิวรี่ข้อ 3.1
ถ้าผลออกมามี `P1TC1` แปลว่าคนละฐานข้อมูลกับเราแน่นอน

**สิ่งที่รู้แล้ว ณ 2026-08-27**

| | ของเรา | บอร์ด |
|---|---|---|
| Database | `iot_data_global_test` | ? |
| Surface ที่ 6332 | BP6, HC2 | BP6, HC2, **P1TC1** |
| Injection ที่ 6332 | 26 เครื่อง | **29 เครื่อง** |
| plant ที่มี | 6051, 6332, 6338 | ? |

> ⚠️ ชื่อฐานข้อมูลของเราลงท้ายด้วย **`_test`** — น่าสงสัยมากว่าบอร์ดชี้ไปฐาน production
> คนละตัว ตรวจข้อ 4 ก่อนไปหาสาเหตุอื่น

---

## 5. อ้างอิง

- `docs/grafana/MACHINE-STATUS-V2.md` — source ของ panel เดิม + คำอธิบายทีละบรรทัด
- `docs/DESIGN.md` §8 (schema) · §9 (สูตร)
- `docs/BACKEND-HANDOVER.md` §4.2 (กับดัก InfluxDB) · §4.8 (การ reconcile กับบอร์ด)
- `server/src/influx/queries.ts` — คิวรี่จริงที่ backend ใช้
