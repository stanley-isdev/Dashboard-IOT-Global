import type { Dict } from './en';

/**
 * Thai strings.
 *
 * Typed as `Dict`, so omitting a key fails `npm run typecheck`. That is
 * stricter than i18next, which falls back to English at runtime and lets an
 * untranslated screen reach production unnoticed.
 *
 * ## Machine states are not translated
 *
 * Every name of a machine state prints its English term in both locales -
 * Running, Stop, Mass Pro, Dandori, 4M Change, No Plan, Order End - and only
 * the prose around it is Thai. Three reasons, in order of weight:
 *
 *   1. They are not English words being translated, they are the identifiers
 *      the source system reports. `machineStatusKey()` in domain/status.ts
 *      derives `machine.mass_pro` from the literal string `Mass Pro` in the
 *      payload, and the same string is what the operator reads off the andon
 *      and off Grafana. A board that renames it has to be reconciled by hand
 *      by whoever is looking at both screens.
 *   2. The explanatory text was already English and could not be otherwise:
 *      "TOTAL = RUNNING + STOP" and "RUNNING = Mass Pro + Dandori" are
 *      formulae. A card labelled กำลังเดิน over a tooltip reading RUNNING =
 *      ... made the reader do the mapping.
 *   3. กำลังเดิน in particular was not the word this plant uses.
 *
 * The line is drawn at the state name. Definitions, captions, headings and
 * running text stay Thai - "หยุดนอกแผน" under the STOP card is the definition
 * of the state, not its name, and is more useful in Thai than out of it.
 *
 * `site.*` is deliberately on the other side of that line: it describes whether
 * a *base* is reporting, not what a machine is doing, and it is read by the
 * same people in the same sentence as the coverage text around it.
 */
export const th: Dict = {
  /* ------------------------------------------------------------- shell */
  'app.title': 'One Stanley Narong-Pat Global Executive Dashboard',
  /* Not translated - see en.ts. */
  'app.bases': 'THS · ASI (ไทย) · VNS (เวียดนาม) · ISE (อินโดนีเซีย) · STJ (ญี่ปุ่น) · SUS · IIS (สหรัฐฯ) · SMX (เม็กซิโก) · SEH (ฮังการี)',
  'nav.skip': 'ข้ามไปยังเนื้อหาหลัก',
  'nav.overview': 'ภาพรวมทั่วโลก',
  'nav.back': 'ย้อนกลับ',

  /* ------------------------------------------------------------ filters */
  'filter.region': 'พื้นที่',
  'filter.process': 'กระบวนการ',
  'filter.range': 'ช่วงเวลา',
  'filter.all': 'ทั้งหมด',
  'filter.allBases': 'ทั้งหมด · {count} ฐาน',
  // Thai does not inflect for number; both keys exist to satisfy the schema.
  'filter.baseCount.one': '{count} ฐาน',
  'filter.baseCount.other': '{count} ฐาน',
  'filter.noBases': 'ยังไม่เลือกฐาน',
  /* คงคำว่า Lamp ไว้ตรงกับบอร์ด operator (`Lamp_var`, "LAMP 2") และตรงกับที่หน้างานเรียก
     ถ้าแปลเป็น "โรงงาน" คนที่ถือสองจอจะต้องมาแปลงเองว่าอันไหนคืออันไหน */
  'filter.plant': 'Lamp',
  'filter.allPlants': 'ทั้งหมด · {count} Lamp',
  'filter.plantCount.one': '{count} Lamp',
  'filter.plantCount.other': '{count} Lamp',
  'filter.noPlants': 'ยังไม่เลือก Lamp',
  /* คงคำว่า Zone ไว้ด้วยเหตุผลเดียวกับ Lamp: บอร์ด operator เรียก `Zone_var`
     และป้ายหน้างานก็เขียนแบบนี้ ส่วนค่าของโซน (`2A-A`) ไม่แปลในทุกภาษา */
  'filter.zone': 'Zone',
  'filter.allZones': 'ทั้งหมด · {count} โซน',
  // ภาษาไทยไม่ผันตามจำนวน มีสองคีย์เพื่อให้ครบตาม schema
  'filter.zoneCount.one': '{count} โซน',
  'filter.zoneCount.other': '{count} โซน',
  'filter.noZones': 'ยังไม่เลือกโซน',
  'filter.zoneLamps': 'อยู่ใน {count} Lamp',
  'refresh.now': 'รีเฟรชเดี๋ยวนี้',
  'refresh.interval': 'รอบรีเฟรชอัตโนมัติ',
  'refresh.off': 'ปิด',
  'range.8h': '8 ชม.ล่าสุด',
  'range.24h': '24 ชม.ล่าสุด',
  'range.7d': '7 วันล่าสุด',
  'range.8h.short': '8 ชั่วโมง',
  'range.24h.short': '24 ชั่วโมง',
  'range.7d.short': '7 วัน',
  'filter.time': 'เวลา',
  /* "Export" คงเป็นภาษาอังกฤษเหมือนที่ artboard เขียนไว้ และเหมือน PDF ที่เป็นชื่อรูปแบบไฟล์
     ไม่ใช่คำบรรยาย ส่วน tooltip แปลเต็ม เพราะเป็นที่เดียวที่มีที่พอจะบอกว่าไฟล์มีอะไรอยู่

     สองคีย์ท้ายคือหัวกระดาษที่อยู่บนสุดของไฟล์ ทั้งคู่เป็นเวลาและมักห่างกันไม่กี่วินาที
     ป้ายจึงต้องบอกให้ชัดว่าอันไหนคืออันไหน: อันหนึ่งคือตอนที่วัดค่าได้ อีกอันคือตอนที่กดออกไฟล์ */
  'export.label': 'Export',
  'export.busy': 'กำลังออกไฟล์…',
  'export.pdf': 'ดาวน์โหลดบอร์ดนี้เป็น PDF',
  'export.generated': 'ข้อมูล ณ เวลา',
  'export.exported': 'ออกไฟล์เมื่อ',
  'export.empty': 'ยังไม่มีข้อมูลให้ export',

  /* --------------------------------------------------------- live badge */
  'live.live': 'สด',
  'live.age': 'อัปเดต {age}',
  'live.slow': 'กำลังดึงข้อมูล…',
  'live.stale': 'ข้อมูลค้าง',
  'live.offline': 'ขาดการเชื่อมต่อ',

  /* ------------------------------------------------------------ toggles */
  'lang.label': 'ภาษา',
  /* Endonyms, identical to en.ts on purpose - see the note there. */
  'lang.th': 'ไทย',
  'lang.en': 'English',
  'lang.toggle': 'English',
  'lang.current': 'ภาษาไทย',
  'theme.toDark': 'เปลี่ยนเป็นธีมมืด',
  'theme.toLight': 'เปลี่ยนเป็นธีมสว่าง',
  'kiosk.on': 'โหมดจอแสดงผล',
  'kiosk.off': 'ออกจากโหมดจอแสดงผล',
  'time.siteLocal': 'เวลาท้องถิ่น',
  'time.reference': 'เวลาสำนักงานใหญ่',
  'time.referenceNote': 'เวลาที่แสดงเป็น {tz} · การคำนวณยังใช้กะของแต่ละไซต์',
  'time.siteLocalNote': 'เวลาที่แสดงเป็นเวลาท้องถิ่นของแต่ละไซต์ · การคำนวณยังใช้กะของแต่ละไซต์',

  /* ------------------------------------------------------- time picker */
  'time.range': 'ช่วงเวลา',
  'time.quick': 'ช่วงเวลาที่ใช้บ่อย',
  'time.absolute': 'ระบุช่วงเวลาเอง',
  'time.from': 'จาก',
  'time.to': 'ถึง',
  'time.apply': 'ใช้ช่วงเวลานี้',
  'time.selectRange': 'เลือกช่วงเวลา',
  'time.closeCalendar': 'ปิดปฏิทิน',
  'time.openCalendar': 'เลือกวันที่',
  'time.prevMonth': 'เดือนก่อนหน้า',
  'time.nextMonth': 'เดือนถัดไป',
  'time.pickHint': 'คลิกครั้งแรก = วันเริ่ม · คลิกอีกครั้ง = วันสิ้นสุด',
  'time.clear': 'ล้างค่า',
  'time.absoluteActive': 'ขณะนี้บอร์ดใช้ช่วงวันที่ด้านบน',
  'time.backToQuick': 'กลับไปใช้ช่วงเวลาสำเร็จรูป',
  'time.absoluteChunks': 'ช่วงกว้างขนาดนี้ต้องอ่านข้อมูล {n} ครั้ง จึงใช้เวลาโหลดนานขึ้น',

  /* ---------------------------------------------------------------- KPI */
  'kpi.machines': 'เครื่องจักรทั้งหมด',
  // The state name, not a translation of it - see the note at the top.
  'kpi.running': 'Running',
  'kpi.stopped': 'Stop',
  'kpi.oa': '%OA เฉลี่ย',
  'kpi.oa.short': '%OA',
  'kpi.oa.definition': 'ประสิทธิภาพรอบผลิต',
  'kpi.oa.gap': '{delta} จุด',
  'kpi.oa.tooltip':
    '%OA (ประสิทธิภาพรอบการผลิต) เปรียบเทียบเวลามาตรฐานกับเวลาจริงต่อรอบ เฉพาะชิ้นงานที่ผลิตได้ รอบที่ยาวเกินมาตรฐาน +100 วินาที จะถูกนับเป็นเวลามาตรฐาน ดังนั้นค่านี้ไม่รวมเวลาที่เครื่องหยุด จึงไม่ใช่ OEE Availability และจะสูงกว่าเสมอ เวลาที่เครื่องหยุดดูได้จากการ์ด “Stop” และรายการ “เครื่องที่หยุดนานที่สุด”',
  'kpi.achievement': '%ความสำเร็จตามแผน',
  'kpi.achievement.actual': 'จริง {qty}',
  'kpi.achievement.plan': 'แผน {qty} {unit}',
  'kpi.achievement.planShort': 'แผน {qty}',
  'kpi.achievement.actualUnit': 'จริง {qty} {unit}',
  'kpi.achievement.gap': '{delta}',
  'kpi.attention': 'ต้องเข้าดูแล',
  // Thai does not inflect for number; both keys exist to satisfy the schema.
  'table.plants.one': '{count} โรงงาน',
  'table.plants.other': '{count} โรงงาน',
  'kpi.attention.none': 'ไม่มีฐานที่ต่ำกว่า {threshold}%',
  'kpi.attention.tooltip':
    'นับฐานที่อยู่ในเกณฑ์วิกฤต คือ %OA ต่ำกว่า {threshold}% ซึ่งไม่เท่ากับ “ต่ำกว่าเป้า {target}%” เพราะเกณฑ์สีคือ {target}-5 และ {target}-20 ฐานที่ทำได้ 82% จึงต่ำกว่าเป้าแต่ยังไม่วิกฤต ป้ายสถานะเหนือตารางอันดับนับครบทุกเกณฑ์',
  'kpi.attention.badge': 'แจ้งเตือน',
  'kpi.target': 'เป้าหมาย {target}%',
  /* ชื่อสถานะมาจากระบบต้นทาง ไม่แปล */
  'kpi.running.definition': 'Mass Pro/Dandori',
  'kpi.running.tooltip':
    'เครื่องที่อยู่ในสถานะ Mass Pro หรือ Dandori · 4M Change ยังไม่นับเป็นเดินเครื่อง และเนื่องจาก TOTAL = RUNNING + STOP จึงไม่ถูกนับที่ไหนเลย',
  'kpi.stopped.definition': 'หยุดนอกแผน',
  'kpi.stopped.tooltip':
    'นับเฉพาะสถานะ Stop คือเครื่องที่หยุดในช่วงที่มีแผนผลิต ส่วน No Plan (ไม่มีแผนผลิต) และ Order End (ผลิตครบออเดอร์แล้ว) ไม่ใช่การหยุด จึงไม่ถูกนับตรงนี้ และเนื่องจาก TOTAL = RUNNING + STOP จึงไม่ถูกนับที่อื่นด้วย',
  'kpi.machines.definition': '{total} ฐาน · {countries} ประเทศ · ยังไม่เชื่อมต่อ {missing}',
  'kpi.share': '{pct} ของเครื่องที่เชื่อมต่อ',
  'kpi.machines.connected': 'เชื่อมต่อแล้ว {reporting} จาก {total}',
  'kpi.machines.rest': '{count} {buckets} · {pct}',
  'kpi.info.open': 'ตัวเลข {label} มาจากไหน',
  'kpi.notCounted': 'ไม่ถูกนับในยอดรวม',

  'kpi.machines.source': 'นับจากสถานะล่าสุดที่แต่ละเครื่องส่งเข้า InfluxDB',
  'kpi.machines.source.formula': 'TOTAL = RUNNING + STOP',
  'kpi.machines.source.note':
    'เครื่องที่อยู่สถานะอื่นจะไม่ถูกนับ เช่น No Plan (ไม่มีแผนผลิต), Order End (ผลิตครบออเดอร์แล้ว), Pending (รอดำเนินการ) และโรงงานที่ไม่ส่งข้อมูลจะไม่ถูกนับเลย',
  'kpi.running.source':
    'เครื่องที่สถานะล่าสุดเป็น Mass Pro หรือ Dandori · Dandori คือการเปลี่ยนรุ่น เครื่องมีคนดูแลและกำลังทำงานอยู่ จึงนับเป็นเดินเครื่อง ไม่ใช่การหยุด',
  'kpi.running.source.formula': 'RUNNING = Mass Pro {massPro} + Dandori {dandori}',
  'kpi.stopped.source':
    'ทุกเครื่องที่นับแล้วไม่ได้เดิน ได้แก่ Stop และสถานะอื่นที่ไม่ใช่ Mass Pro หรือ Dandori · RUNNING + STOP = TOTAL เสมอ จึงไม่มีเครื่องไหนตกหล่นระหว่างสองการ์ด',
  'kpi.stopped.source.formula': 'STOP = {breakdown}',
  'kpi.stopped.source.note':
    'เครื่องที่ผลิตครบออเดอร์ (Order End) ไม่ถูกนับเลย เพราะบอร์ดหน้างานแสดงเป็นการ์ดใบที่สองคู่กับใบที่กำลังเดินอยู่ ถ้านับด้วยจะกลายเป็นนับเครื่องเดียวกันสองครั้ง · นอกนั้นที่ไม่ได้เดินถูกนับตรงนี้หมด รวม No Plan และ 4M Change เพราะการ์ดที่ผู้บริหารใช้ตัดสินใจไม่ควรมีเศษซ่อนอยู่ข้างหลัง',

  'kpi.running.source.note':
    'ไม่มีสถานะอื่นถูกนับรวมในตัวเลขนี้ · 4M Change (ช่วงหยุดตรวจหลังเปลี่ยนคน เครื่อง วัตถุดิบ หรือวิธีผลิต) ยังไม่ถูกนับ เพราะยังไม่ได้ตัดสินว่าถือเป็นเดินเครื่องหรือหยุด',

  /* บรรทัดที่ขึ้นต้นด้วย "- " จะกลายเป็น bullet ใน panel (ดู SourceText ใน
     KpiCard.tsx) · เรียงเป็น "ตัวแปรคืออะไร แล้วค่อยสูตร" เพราะผู้บริหารที่
     เห็นสูตรก่อนรู้จักตัวแปร จะอ่านไม่ออกว่าแต่ละตัวมาจากไหน */
  'kpi.oa.source':
    '%OA บอกว่าเครื่องเดินได้เร็วหรือช้ากว่ามาตรฐานเท่าไร ใช้ค่า 3 ตัวที่เครื่องส่งเข้า InfluxDB ทุกรอบการฉีด\n' +
    '- เวลามาตรฐาน คือเวลาที่ควรใช้ต่อรอบ กำหนดไว้ในข้อมูลหลักของชิ้นงาน\n' +
    '- เวลารอบจริง คือเวลาที่เครื่องใช้จริงในรอบนั้น\n' +
    '- จำนวนชิ้น ใช้ถ่วงน้ำหนัก งานที่ผลิตเยอะจึงมีผลต่อค่าเฉลี่ยมากกว่า',
  'kpi.oa.source.formula':
    '%OA = เวลามาตรฐาน ÷ เวลารอบจริง × 100',
  'kpi.oa.source.note':
    '100% = เดินได้ตามมาตรฐานพอดี · ต่ำกว่า 100% = ช้ากว่ามาตรฐาน\n' +
    'ค่าของกลุ่มนี้เฉลี่ยจาก {machines} ใน {total} เครื่อง\n' +
    'มีเครื่อง 2 แบบที่ไม่ถูกนับ\n' +
    '- ไม่มีใบสั่งผลิตโหลดอยู่ ไม่นับเป็น 0% เพราะ “ไม่มีงานให้ผลิต” ไม่เท่ากับ “ผลิตได้ 0%”\n' +
    '- รันหลายใบสั่งพร้อมกันในช็อตเดียว เวลามาตรฐานที่ส่งมาเป็นผลรวมของทุกใบสั่ง แต่รอบที่เครื่องใช้จริงมีรอบเดียว ค่าจึงพองเกินจริง\n' +
    'รอบที่ยาวผิดปกติ (เกินมาตรฐานเกิน 100 วินาที) จะถูกนับเป็นเวลามาตรฐาน ค่านี้จึงไม่รวมเวลาที่เครื่องหยุด ดูเวลาหยุดได้ที่การ์ด Stop',

  /* การ์ดนี้ถูกอ่านผิดบ่อยที่สุดในแถบ เพราะ "ต้องเข้าดูแล 0" กับป้าย
     "ต่ำกว่าเป้า 3" อยู่บนจอเดียวกันแล้วดูขัดกัน ทั้งที่นับคนละเกณฑ์ */
  'kpi.attention.source':
    'นับจำนวนฐานผลิตที่ %OA ตกอยู่ในเกณฑ์วิกฤต ไม่ใช่จำนวนเครื่องและไม่ใช่จำนวนโรงงาน\n' +
    '- เกณฑ์วิกฤต คือ %OA ต่ำกว่า {warn}% เซิร์ฟเวอร์เป็นคนกำหนด ไม่ได้ตั้งค่าไว้ในหน้าเว็บ\n' +
    '- ฐานที่ยังไม่มีค่า %OA ไม่ถูกนับ เพราะ “วัดไม่ได้” ไม่เท่ากับ “ปกติดี”',
  'kpi.attention.source.formula': 'ต้องเข้าดูแล = ฐานที่ %OA ต่ำกว่า {warn}%',
  /* แสดงเป็นช่วงตัวเลขตรงๆ ไม่ใช่ "{target}-5 และ {target}-20" ซึ่งบังคับให้
     คนอ่านคิดเลขเอง และทำให้ประโยคยาวโดยไม่จำเป็น */
  'kpi.attention.source.note':
    'เกณฑ์สีมี 3 ระดับ การ์ดนี้นับเฉพาะระดับล่างสุด\n' +
    '- {good}% ขึ้นไป ตามเป้า\n' +
    '- {warn} ถึง {warnTop}% ต่ำกว่าเป้า แต่ยังไม่วิกฤต\n' +
    '- ต่ำกว่า {warn}% วิกฤต คือกลุ่มที่การ์ดนี้นับ\n' +
    'ตอนนี้มีโรงงานย่อยอยู่ในเกณฑ์วิกฤต {plants} โรง',

  /* โครงเดียวกับ kpi.oa.source: บอกตัวแปรก่อน แล้วค่อยสูตร แล้วค่อยข้อควรระวัง */
  'kpi.achievement.source':
    '%ความสำเร็จ บอกว่าใบสั่งผลิตที่เครื่องโหลดอยู่ เดินไปได้กี่เปอร์เซ็นต์ของจำนวนที่สั่ง ใช้ค่า 2 ตัวจากข้อมูลชุดเดียวกับ %OA\n' +
    '- จำนวนที่สั่ง คือจำนวนชิ้นของใบสั่งนั้น ไม่ใช่เป้าต่อกะหรือต่อวัน\n' +
    '- จำนวนที่ผลิตได้ คือชิ้นที่เครื่องทำไปแล้วในใบสั่งนั้น',
  'kpi.achievement.source.formula': '%ความสำเร็จ = จริง {actual} ÷ แผน {plan} × 100',
  'kpi.achievement.source.note':
    'ตัวหารคือจำนวนของใบสั่งเอง ไม่ใช่เป้าของกะ บอร์ดหน้างานจึงเรียกตัวเลขนี้ว่า %AR (Progress)\n' +
    '- เครื่องที่เพิ่งเริ่มใบสั่ง 800 ชิ้นจะอ่านได้ต่ำ เพราะใบสั่งเพิ่งเริ่ม ไม่ใช่เพราะทำไม่ทัน\n' +
    '- เกิน 100% คือผลิตเกินจำนวนที่สั่ง\n' +
    '- เครื่องที่ไม่มีใบสั่งโหลดอยู่ ไม่ถูกนับทั้งตัวตั้งและตัวหาร',

  /* ----------------------------------------------------------- coverage */
  'coverage.label': 'ครอบคลุม {reporting} จาก {total} ไซต์',
  'coverage.partial': 'คำนวณจาก {reporting} จาก {total} ไซต์',
  'aggregation.weighted_by_qty': 'ถ่วงน้ำหนักตามจำนวนชิ้น',
  'aggregation.weighted_by_time': 'ถ่วงน้ำหนักตามเวลาเดินเครื่อง',
  'aggregation.simple_avg': 'ค่าเฉลี่ยอย่างง่าย',

  /* ------------------------------------------------------------- tiers */
  'tier.good': 'ตามเป้า',
  'tier.warn': 'ต่ำกว่าเป้า',
  'tier.critical': 'วิกฤต',
  'tier.unknown': 'ไม่ทราบ',

  /* ------------------------------------------------------- site status */
  'site.online': 'กำลังรายงาน',
  'site.stale': 'ข้อมูลค้าง',
  'site.degraded': 'รายงานบางส่วน',
  'site.no_data': 'ไม่มีข้อมูล',
  'site.not_connected': 'ยังไม่เชื่อมต่อ',
  'site.notConnectedShort': 'ยังไม่เชื่อมต่อ',
  'site.lastSeen': 'ณ {time}',
  'site.neverConnected': 'ยังไม่มีข้อมูลจากเครื่อง',

  /* ------------------------------------------------------- readiness */
  'readiness.live': 'ใช้งานแล้ว',
  'readiness.installing': 'กำลังติดตั้ง',
  'readiness.planned': 'อยู่ในแผน',
  'readiness.unknown': 'ยังไม่ระบุ',

  /* --------------------------------------------------- machine buckets */
  'bucket.running': 'Running',
  'bucket.stopped': 'Stopped',
  'bucket.idle': 'Idle',
  'bucket.other': 'Other',
  'bucket.no_data': 'No data',

  'machine.mass_pro': 'Mass Pro',
  'machine.dandori': 'Dandori',
  'machine.stop': 'Stop',
  'machine.4m_change': '4M Change',
  'machine.no_plan': 'No Plan',
  'machine.order_end': 'Order End',
  'machine.offline': 'Offline',
  'machine.pending': 'Pending',
  'machine.alarm': 'Alarm',
  'machine.warning': 'Warning',

  'measure.not_applicable': 'ไม่เกี่ยวข้อง',
  'measure.noPlan': 'ไม่มีแผน',

  'unit.pcs': 'ชิ้น',
  'unit.shots': 'ช็อต',

  /* ------------------------------------------------------------ shifts */
  'shift.chip': '{code} · {time}',
  'shift.chipFull': '{label} ({index} จาก {of}) · {time}',
  'shift.header': '{label} · {start}–{end} · {time}',
  'shift.productionDate': 'วันที่ผลิต {date}',
  'shift.notConfigured': 'ยังไม่ได้กำหนดกะ',
  'shift.notConfigured.tooltip':
    'ยังไม่ได้กำหนดรูปแบบกะของไซต์นี้ เวลาที่แสดงเป็นเวลานาฬิกาท้องถิ่น',
  'shift.endsSoon': 'จบ {time}',
  'shift.ending': 'ใกล้จบกะ',
  'shift.inProgress': 'กำลังดำเนินการ',
  'shift.notStarted': 'ยังไม่เริ่ม',

  /* ----------------------------------------------------------- banners */
  'banner.stale.title': 'ไม่สามารถดึงข้อมูลสดได้',
  'banner.stale.body': 'กำลังแสดงข้อมูล ณ {time} ({age}) กำลังลองใหม่…',
  'banner.frozen.title': 'ข้อมูลไม่อัปเดต',
  'banner.frozen.body': 'เซิร์ฟเวอร์ส่งข้อมูลชุดเดิมมาตั้งแต่ {time}',
  'banner.partial.title': 'บางแหล่งข้อมูลใช้งานไม่ได้',
  'banner.partial.body': 'ติดต่อ {sources} ไม่ได้ ข้อมูลบางส่วนในหน้านี้จึงไม่ครบ',
  'banner.config.title': 'ไฟล์ตั้งค่ามีปัญหา',
  'banner.retry': 'ลองใหม่',
  'banner.dismiss': 'ปิดข้อความแจ้งเตือน',
  'banner.recovered.title': 'เชื่อมต่อได้แล้ว',
  'banner.recovered.body': 'บอร์ดไม่เป็นปัจจุบันไป {gap} กราฟช่วงนั้นจึงขาดไป',

  /* ------------------------------------------------------- state pages */
  'state.try': 'ลองเช็ค',
  'state.reload': 'โหลดใหม่',
  'state.retryNow': 'ลองใหม่เดี๋ยวนี้',
  'state.retrying': 'กำลังเชื่อมต่อใหม่ — ครั้งที่ {n} จาก {total}',
  'state.retryAuto': 'ระบบจะลองใหม่เองเรื่อยๆ',
  'state.retryOff': 'ปิดการรีเฟรชอัตโนมัติอยู่ หน้านี้จะไม่หายไปเอง',
  'state.copy': 'คัดลอกรายละเอียด',
  'state.copied': 'คัดลอกแล้ว',

  'state.loading.overview': 'กำลังโหลดข้อมูลภาพรวม',
  'state.loading.scope': 'กำลังโหลด {name}',
  'state.loading.body': '{range} · {process}',
  'state.loading.code': 'กำลังรอการตอบกลับครั้งแรก',

  /* ------------------------------------------------------------ errors */
  'error.title': 'โหลดหน้านี้ไม่สำเร็จ',
  'error.network': 'ติดต่อเซิร์ฟเวอร์ไม่ได้',
  'error.timeout': 'เซิร์ฟเวอร์ไม่ตอบกลับภายใน {sec} วินาที',
  'error.http': 'ต่อฐานข้อมูลไม่ได้',
  'error.unauthorized': 'ต้องเข้าสู่ระบบก่อนดูบอร์ดนี้',
  'error.contract': 'รูปแบบข้อมูลไม่ตรงกับที่ตกลงไว้',
  'error.notfound': 'ไม่พบไซต์ที่ระบุ',

  'error.network.body':
    'เรียก API ไม่ถึงเลย ปัญหาจึงอยู่ที่เครือข่ายหรือเซิร์ฟเวอร์ที่ไม่ได้รันอยู่',
  'error.network.check1': 'เครื่องนี้ต่อเครือข่ายของโรงงานอยู่หรือไม่',
  'error.network.check2': 'API service ยังรันอยู่หรือไม่',

  'error.timeout.body':
    'ช่วงเวลาที่เลือกไว้อาจกว้างกว่าที่ฐานข้อมูลตอบได้ ลองย่อลงแล้วโหลดใหม่',
  'error.timeout.check1': 'เลือกช่วงเวลาที่สั้นลงในตัวเลือกเวลา',
  'error.timeout.check2': 'แคบตัวกรอง Region หรือ Process ลง',
  'error.timeout.narrow': 'โหลด 24 ชั่วโมงล่าสุด',

  'error.http.body':
    'เซิร์ฟเวอร์ยังทำงานอยู่ แต่อ่านข้อมูลจาก InfluxDB ไม่สำเร็จ บอร์ดนี้จะว่างจนกว่าจะต่อได้',
  'error.http.check1': 'InfluxDB ยังรันอยู่หรือไม่',
  'error.http.check2': 'token และ bucket ในค่าตั้งของเซิร์ฟเวอร์',
  'error.http.check3': 'ถ้ายังไม่หาย ส่งบรรทัดล่างสุดของหน้านี้ให้ทีม IT',

  'error.contract.body':
    'นี่เป็นปัญหาที่เซิร์ฟเวอร์ ไม่ใช่ที่เครื่องนี้ กดคัดลอกบรรทัดข้างล่างแล้วส่งให้ทีมพัฒนา',

  'error.unauthorized.body': 'เซสชันหมดอายุ หรือเบราว์เซอร์นี้ยังไม่ได้เข้าสู่ระบบด้วยบัญชีบริษัท',

  'error.notfound.body': 'ไม่มีรหัส {code} ในระบบ อาจถูกเปลี่ยนรหัสไปแล้ว หรือเป็นลิงก์เก่า',
  'error.notfound.home': 'กลับหน้าภาพรวม',

  /* ------------------------------------------------------ empty result */
  'empty.title': 'ไม่มีข้อมูลตามตัวกรองที่เลือก',
  'empty.noRegion': 'ระบบทำงานปกติ — ยังไม่ได้ติ๊ก Region ไว้เลย จึงไม่มีฐานผลิตให้แสดง',
  'empty.narrowed': 'ระบบทำงานปกติ ตัวกรองที่ใช้อยู่ไม่ตรงกับข้อมูลใดในช่วงเวลานี้',
  'empty.selectAll': 'เลือกทุกฐานผลิต',
  'empty.clear': 'ล้างตัวกรอง',

  'empty.panel.plants': 'ไม่มีโรงงานในฐานนี้ที่ผลิตกระบวนการ {process}',
  'empty.panel.machines': 'ไม่มีเครื่องจักรในโรงงานนี้ที่ผลิตกระบวนการ {process}',
  'empty.panel.clearProcess': 'แสดงทุกกระบวนการ',
  'empty.panel.working': 'ส่วนอื่นของหน้านี้เป็นข้อมูลปัจจุบันทั้งหมด',

  /* --------------------------------------------------------------- map */
  'board.fleet': 'ภาพรวมเครื่องจักร',
  'board.analytics': 'วิเคราะห์เชิงบริหาร',
  'map.title': 'ตำแหน่งและสถานะอุปกรณ์',
  'map.bases': '{count} ฐานทั่วโลก',
  'map.sub': 'สีและรูปทรงหมุด = สถานะการรายงาน · ตัวเลข = %OA',
  'map.legend.noData': 'ไม่มีข้อมูล',
  'map.reset': 'รีเซ็ตมุมมอง',
  'map.zoomIn': 'ขยายเข้า',
  'map.zoomOut': 'ย่อออก',
  'map.expand': 'ขยายแผนที่',
  'map.collapse': 'คืนขนาดแผนที่',
  'map.pinLabel': '{company}, {country} · {status}',
  'map.notConnected': 'ยังไม่เชื่อมต่อ',

  /* ------------------------------------------------------ the base drawer ---- */
  'drawer.open': 'ดูรายละเอียด {company}',
  'drawer.close': 'ปิดแผงข้อมูล',
  'drawer.oa': '%OA ปัจจุบัน',
  'drawer.achv': '%ความสำเร็จตามแผน',
  'drawer.achv.note': 'ผลิตจริง {actual} จาก {plan} {unit}',
  'drawer.machines': 'เครื่องสถานะ Running',
  'drawer.machines.note': 'Stop {stopped} · ไม่มีแผน {idle}',
  'drawer.downtime': 'เวลาหยุดสะสม',
  'drawer.downtime.note': 'ไม่รวมอยู่ใน %OA',
  'drawer.read.oa': '%OA ห่างจากเป้า {target}% อยู่ {delta} จุด',
  'drawer.read.planMet': 'ผลผลิตถึงแผนแล้วที่ {pct}',
  'drawer.read.planShort': 'ผลผลิตอยู่ที่ {pct} ของแผน',
  'drawer.plants': 'โรงงานในฐานนี้ {count} แห่ง',
  'map.pop.rollout': 'การติดตั้ง',
  'map.pop.telemetry': 'การส่งข้อมูล',

  /* ------------------------------------------------------------- table */
  'table.title': 'อันดับโรงงาน',
  'table.sub': 'เรียงตาม %OA จากต่ำไปสูง',
  'table.base': 'ฐานการผลิต',
  'table.plant': 'โรงงาน',
  'table.dateTime': 'วันที่/เวลา',
  'table.shift': 'กะ',
  'table.runStop': 'Run/Stop',
  'table.oa': '%OA',
  'table.achv': '%ตามแผน',
  'table.down': 'เวลาหยุด',
  'table.output': 'ผลผลิต',
  'table.run': '{count} Run',
  'table.stop': '{count} Stop',
  'table.noDowntime': 'ไม่มี',
  'table.notReporting': 'ยังไม่รายงาน ({count})',
  'table.expand': 'แสดงโรงงานของ {company}',
  'table.collapse': 'ซ่อนโรงงานของ {company}',
  'table.plantsCount': '{count} โรงงาน',

  /* --------------------------------------------- sortable column heads ---- */
  'sort.by': 'เรียงตาม {column}',
  'sort.reverse': 'สลับลำดับ',

  /* ------------------------------------------ status summary chips ---- */
  'summary.label': 'จำนวนฐานตามสถานะ',
  'summary.chip': '{count} ฐาน{status}',
  'summary.connected': 'เชื่อมต่อ',
  'summary.offline': 'ออฟไลน์',
  'summary.coverage': 'เชื่อมต่อ {connected} ฐาน ออฟไลน์ {offline} ฐาน',

  /* ------------------------------------- right-panel segmented control ---- */
  'view.select': 'มุมมองแผง',
  'view.ranking': 'อันดับ',
  'view.trend': 'แนวโน้ม',
  'view.alerts': 'การหยุด',
  'trend.tab': 'แนวโน้ม %OA รวม · {range}',
  'alerts.tab': 'การหยุดและการแจ้งเตือนที่นานที่สุด',
  'alerts.top': 'สูงสุด {n}',
  'alerts.topAria': 'จำนวนรายการที่แสดง',

  /* ------------------------------------------------------------- trend */
  'trend.title': 'แนวโน้ม',
  'trend.sub': 'ค่าเฉลี่ยรายชั่วโมงของโรงงานที่เชื่อมต่อทั้งหมด · {span}',
  'trend.subSite': 'ค่าเฉลี่ยรายชั่วโมงของไซต์นี้ · {span}',
  'trend.span': '{hours} ชม. ล่าสุด',
  'trend.spanShort': 'มีข้อมูล {hours} ชม. ล่าสุด จาก {range} ที่เลือก',
  'trend.now': 'ปัจจุบัน',
  'trend.ago24': '−24 ชม.',
  'trend.oaAvg': '%OA เฉลี่ย',
  'trend.target': 'เป้าหมาย {target}',
  'trend.axis': 'เวลา ({tz})',
  'trend.peak': 'สูงสุด',
  'trend.dip': 'ต่ำสุด',
  'trend.below': 'ต่ำกว่า {threshold}',
  'trend.offscale': '{count} ชม. หลุดสเกล',
  'trend.ceiling': 'เพดานแกน',
  'trend.vsTarget': 'เทียบเป้า',
  'trend.showTable': 'ตาราง',
  'trend.showChart': 'กราฟ',
  'trend.insufficient': 'ประวัติยังไม่พอสำหรับวาดกราฟแนวโน้ม',
  'trend.time': 'เวลา',
  'trend.sites': 'ไซต์',
  'trend.machines': 'เครื่อง',

  /* ------------------------------------------------------------ alerts */
  'alerts.title': '10 อันดับแรกของเครื่องที่หยุดอยู่',
  'alerts.sub': '10 อันดับแรกจากฐานที่รายงาน',
  'alerts.none': 'ไม่มีการแจ้งเตือน',
  'alerts.owner': '{role}',
  'severity.critical': 'วิกฤต',
  'severity.major': 'รุนแรง',
  'severity.minor': 'เล็กน้อย',
  'severity.info': 'แจ้งเพื่อทราบ',
  'alert.reason.stop.heater_failure': 'ฮีตเตอร์ขัดข้อง',
  'alert.reason.stop.material_jam': 'วัตถุดิบติดขัด',
  'alert.reason.stop.quality_hold': 'ระงับเพื่อตรวจคุณภาพ',
  'alert.reason.stop.mold_change': 'เปลี่ยนแม่พิมพ์เกินเวลา',
  'alert.reason.telemetry.sync_timeout': 'การส่งข้อมูลหมดเวลา',

  /* -------------------------------------------------------- data quality */
  'quality.warnings': 'พบข้อมูลไม่สอดคล้อง {count} รายการ',
  'quality.title': 'ความสอดคล้องของข้อมูล',
  'methodology.open': 'ตัวเลขเหล่านี้คำนวณอย่างไร',
  'methodology.title': 'ตัวเลขเหล่านี้คำนวณอย่างไร',
  'methodology.target': 'เป้าหมาย %OA',
  'methodology.tierPolicy': 'เกณฑ์สี',
  'methodology.aggregation': 'วิธีรวมค่า %OA',
  'methodology.freshness': 'เกณฑ์ความสดของข้อมูล',
  'methodology.generatedAt': 'ข้อมูล ณ เวลา',
  'methodology.source': 'แหล่งข้อมูล',
  'methodology.close': 'ปิด',

  /* -------------------------------------------------------------- misc */
  'common.loading': 'กำลังโหลด…',
  'common.grafana': 'เปิดใน Grafana',
  'country.TH': 'ไทย',
  'country.JP': 'ญี่ปุ่น',
  'country.HU': 'ฮังการี',
  'country.VN': 'เวียดนาม',
  'country.ID': 'อินโดนีเซีย',
  'country.US': 'สหรัฐฯ',
  'country.MX': 'เม็กซิโก',

  'common.of': 'จาก',
  'common.seconds': '{n} วิ',
  'common.minutes': '{n} นาที',
  'common.hours': '{n} ชม.',
};
