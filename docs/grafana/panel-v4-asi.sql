-- =====================================================================
--  Machine Status V2.0 - ASI board (`adz5fll`), panel query, v4
--
--  Captured verbatim from the live panel on 2026-09-11 and committed so it
--  stops being lost: the capture in MACHINE-STATUS-V2.md §2.1 is v3, from
--  2026-08-27, and the rules that moved between those two dates lived only in
--  this text.
--
--  Grafana's own tokens are left unexpanded. To run it by hand, substitute
--  them - scripts/influx-query.mjs takes a file with --file.
--
--  What differs from §2.1, and what each difference is worth:
--
--   1. `StatusPerPO_Latest` is new - the latest status PER (machine, PO group)
--      instead of per machine. A parked group now reads `Pending` instead of
--      being hardcoded to `Order End`.
--   2. Part 2 (`PendingCards`, UNION ALL) draws a parked PO group as a card of
--      its own, beside the machine's live one.
--   3. `_sort_weight`: 0 current, 1 Pending, 2 Order End (Order End was 1).
--   4. The status windows are `3 days`, not `1 days` - this is the ASI board.
--      `TotalOutput_Per_PO` is 3 days too, the rule master data carries as
--      `oaWindowHours: 71`. Our census window is the request range (24 h by
--      default), so a machine silent for one to three days is on the board and
--      not in our count. Nothing at 6051 is currently in that state.
--   5. The hardcoded machine exclusions (`lA1`, `lA2`, `D2`, `D3`, `D4`,
--      `P1l4`) are in the two STATUS CTEs and absent from the two IO CTEs - so
--      those machines have no card yet still move %OA and output. That is F-17,
--      now confirmed rather than inferred. None of the six exist at 6051.
-- =====================================================================

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
      AND "time" >= now() - INTERVAL '3 days'
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
      AND "time" >= now() - INTERVAL '3 days'
      AND "machine" != 'lA1' AND "machine" != 'lA2' AND "machine" != 'D2' AND "machine" != 'D3' AND "machine" != 'D4' AND "machine" != 'P1l4' 
),

StatusPerPO_Latest AS (
    SELECT
        "machine", "plant", "zone", "template",
        "Result", "StatusStartTime", "time",
        COALESCE("ProductionOrder0", '') AS "productionOrderNo0",
        COALESCE("ProductionOrder1", '') AS "productionOrderNo1",
        COALESCE("ProductionOrder2", '') AS "productionOrderNo2",
        COALESCE("ProductionOrder3", '') AS "productionOrderNo3",
        TRIM(COALESCE("ProductionOrder0", '')) || '_' || 
        TRIM(COALESCE("ProductionOrder1", '')) || '_' || 
        TRIM(COALESCE("ProductionOrder2", '')) || '_' || 
        TRIM(COALESCE("ProductionOrder3", '')) AS "Group_PO",
        COALESCE("icsno0", '') AS "icsno0", COALESCE("icsno1", '') AS "icsno1", COALESCE("icsno2", '') AS "icsno2", COALESCE("icsno3", '') AS "icsno3",
        COALESCE("icsname0", '') AS "icsname0", COALESCE("icsname1", '') AS "icsname1", COALESCE("icsname2", '') AS "icsname2", COALESCE("icsname3", '') AS "icsname3",
        COALESCE("vIcsName0", '') AS "vIcsName0", COALESCE("vIcsName1", '') AS "vIcsName1", COALESCE("vIcsName2", '') AS "vIcsName2", COALESCE("vIcsName3", '') AS "vIcsName3",
        ROW_NUMBER() OVER (
            PARTITION BY "machine",
                TRIM(COALESCE("ProductionOrder0", '')) || '_' || 
                TRIM(COALESCE("ProductionOrder1", '')) || '_' || 
                TRIM(COALESCE("ProductionOrder2", '')) || '_' || 
                TRIM(COALESCE("ProductionOrder3", ''))
            ORDER BY "time" DESC
        ) as rn_status_po
    FROM "production_machine_status"
    WHERE "plant" = '${Lamp_var}' 
      AND "process" = '${process_var}' 
      AND "zone" IN (${Zone_var:singlequote}) 
      AND "time" >= now() - INTERVAL '3 days'
      AND "machine" != 'lA1' AND "machine" != 'lA2' AND "machine" != 'D2' AND "machine" != 'D3' AND "machine" != 'D4' AND "machine" != 'P1l4'
      AND COALESCE("ProductionOrder0", '') NOT IN ('', '-')
),

PendingCards AS (
    SELECT S.*
    FROM StatusPerPO_Latest AS S
    WHERE S.rn_status_po = 1
      AND S."Result" = 'Pending'
      AND NOT EXISTS (
          SELECT 1 FROM POs_To_Show AS PTS
          WHERE PTS."machine" = S."machine"
            AND PTS."Group_PO" = S."Group_PO"
      )
)

-- Part 1: the ordinary cards (current work + older groups inside the picker)
SELECT 
    COALESCE(R."machine", P."machine") AS "machine",
    COALESCE(R."plant", P."plant") AS "plant",
    COALESCE(P."zone", R."zone") AS "zone",
    CASE 
        WHEN P.global_machine_seq > 1 AND SP."Result" = 'Pending' THEN 'Pending'
        WHEN P.global_machine_seq > 1 THEN 'Order End' 
        ELSE R."RealTimeStatus" 
    END AS "MachineStatusRealTime",
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
    CASE WHEN P.global_machine_seq > 1 THEN 2 ELSE 0 END AS "_sort_weight",
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
LEFT JOIN (SELECT * FROM StatusPerPO_Latest WHERE rn_status_po = 1) AS SP 
    ON SP."machine" = P."machine" AND SP."Group_PO" = P."Group_PO"

WHERE P."productionOrderNo0" IS NULL OR P.global_machine_seq = 1 OR (P.global_machine_seq > 1 AND P."productionOrderNo0" != '-')

UNION ALL

-- Part 2: a card per PO group an operator has parked in `Pending`
SELECT 
    PC."machine" AS "machine",
    PC."plant" AS "plant",
    PC."zone" AS "zone",
    'Pending' AS "MachineStatusRealTime",
    CASE WHEN PC."StatusStartTime" IS NOT NULL THEN CAST(PC."StatusStartTime" AS VARCHAR) ELSE CAST(PC."time" AS VARCHAR) END AS "StatusStartTime",
    PC."productionOrderNo0", PC."productionOrderNo1", PC."productionOrderNo2", PC."productionOrderNo3",
    '-' AS "ModeStatus",
    PC."icsno0", PC."icsno1", PC."icsno2", PC."icsno3",
    PC."vIcsName0", PC."vIcsName1", PC."vIcsName2", PC."vIcsName3",
    COALESCE(L."plan_qty0", 0) AS "plan_qty0",
    COALESCE(L."plan_qty1", 0) AS "plan_qty1",
    COALESCE(L."plan_qty2", 0) AS "plan_qty2",
    COALESCE(L."plan_qty3", 0) AS "plan_qty3",
    PC."icsname0", PC."icsname1", PC."icsname2", PC."icsname3",
    REPLACE(COALESCE(L."vCreateDateTxt0_Raw", ''), ' ', '%20') AS "vCreateDateTxt0",
    REPLACE(COALESCE(L."vCreateDateTxt1_Raw", ''), ' ', '%20') AS "vCreateDateTxt1",
    REPLACE(COALESCE(L."vCreateDateTxt2_Raw", ''), ' ', '%20') AS "vCreateDateTxt2",
    REPLACE(COALESCE(L."vCreateDateTxt3_Raw", ''), ' ', '%20') AS "vCreateDateTxt3",
    COALESCE(T2."OutputperHr", 0) AS "OutputperHr",
    COALESCE(T2."OutputActual", 0) AS "OutputActual",
    T2."STD_Time", T2."SumCycle", T2."OA_percent",
    1 AS "_sort_weight",
    PC."time" AS "_sort_time",
    (COALESCE(L."plan_qty0", 0) + COALESCE(L."plan_qty1", 0) + COALESCE(L."plan_qty2", 0) + COALESCE(L."plan_qty3", 0)) AS "TotalPlan",
    PC."template",
    CASE 
        WHEN (COALESCE(L."plan_qty0", 0) + COALESCE(L."plan_qty1", 0) + COALESCE(L."plan_qty2", 0) + COALESCE(L."plan_qty3", 0)) > 0 
        THEN (COALESCE(T2."OutputActual", 0) / (COALESCE(L."plan_qty0", 0) + COALESCE(L."plan_qty1", 0) + COALESCE(L."plan_qty2", 0) + COALESCE(L."plan_qty3", 0))::FLOAT) * 100
        ELSE 0 
    END AS "AR_percent"

FROM PendingCards AS PC
LEFT JOIN Latest_Per_PO AS L ON L."machine" = PC."machine" AND L."Group_PO" = PC."Group_PO"
LEFT JOIN TotalOutput_Per_PO AS T2 ON T2."machine" = PC."machine" AND T2."Group_PO_Sum" = PC."Group_PO"

ORDER BY "zone" ASC, "machine" ASC, "_sort_weight" ASC, "_sort_time" DESC
