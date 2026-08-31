/**
 * English strings.
 *
 * This file is the schema: `th.ts` is typed as `Dict`, so a missing Thai key is
 * a compile error rather than a silent runtime fallback to English. That is the
 * one thing an i18n library would have given us, and the type system gives it
 * more strictly and for free.
 *
 * Never translated: company codes (THS), plant codes (6332), machine ids, PO
 * numbers, part names. Those come from SAP in whatever language SAP holds them.
 *
 * `{name}` placeholders are interpolated by `t(key, params)`.
 */
export const en = {
  /* ------------------------------------------------------------- shell */
  'app.title': 'One Stanley Narong-Pat Global Executive Dashboard',
  'app.bases': 'THS · ASI (Thailand) · VNS (Vietnam) · ISE (Indonesia) · STJ (Japan) · SUS · IIS (USA) · SMX (Mexico) · SEH (Hungary)',
  'app.copyright': '© 2026 Thai Stanley Electric PCL',
  'app.globalBases': '{count} Global Bases',
  'nav.skip': 'Skip to main content',
  'nav.overview': 'Global overview',
  'nav.back': 'Back',

  /* ------------------------------------------------------------ filters */
  'filter.region': 'Region',
  'filter.process': 'Process',
  'filter.range': 'Range',
  'filter.all': 'All',
  'filter.allBases': 'All · {count} bases',
  /* The count beside a scope in the region menu, and the trigger's label once
     more than one scope is ticked. Two keys because `t` does plain
     substitution: five of the seven countries hold exactly one base, and
     "1 bases" under Japan is the kind of thing a reader stops on. */
  'filter.baseCount.one': '{count} base',
  'filter.baseCount.other': '{count} bases',
  /* The empty scope. "None" alone would read as "no filter", which is the
     opposite of what it means here. */
  'filter.noBases': 'No bases selected',
  /* "Lamp", not "Plant": it is what the operator boards call this level
     (`Lamp_var`, "LAMP 2") and what the floor says out loud. A board that
     renames it makes whoever is holding both screens do the mapping. */
  'filter.plant': 'Lamp',
  'filter.allPlants': 'All · {count} lamps',
  'filter.plantCount.one': '{count} lamp',
  'filter.plantCount.other': '{count} lamps',
  'filter.noPlants': 'No lamps selected',
  /* The refresh control, mirroring the plant board's. The interval values
     themselves (5s, 1m) are not translated - see the note on `label` in
     RefreshPicker.tsx. */
  'refresh.now': 'Refresh now',
  'refresh.interval': 'Auto-refresh interval',
  'refresh.off': 'Off',
  'range.8h': 'Last 8h',
  'range.24h': 'Last 24h',
  'range.7d': 'Last 7 days',
  /* The segmented control has ~70px per option, so it uses these rather than
     the sentence forms above, which are still used by anything that names a
     range in prose. */
  'range.8h.short': '8 hours',
  'range.24h.short': '24 hours',
  'range.7d.short': '7 days',
  'filter.time': 'Time',

  /* --------------------------------------------------------- live badge */
  'live.live': 'Live',
  'live.age': 'updated {age}',
  'live.slow': 'Refreshing…',
  'live.stale': 'Stale',
  'live.offline': 'Offline',

  /* ------------------------------------------------------------ toggles */
  'lang.toggle': 'ภาษาไทย',
  'lang.current': 'English',
  /* The theme switch is icon-only, so these two are its whole label - they are
     read aloud and shown as the tooltip. Each names the *action*, not the state,
     which is the one place this board departs from the language tiles beside it:
     a text tile cannot say "switch to" without becoming a sentence, an icon's
     accessible name has nowhere else to put it. */
  'theme.toDark': 'Switch to dark theme',
  'theme.toLight': 'Switch to light theme',
  'kiosk.on': 'Kiosk mode',
  'kiosk.off': 'Exit kiosk mode',
  'time.siteLocal': 'Site local',
  'time.reference': 'HQ time',
  'time.referenceNote': 'Timestamps in {tz} · metrics still use each site’s own shift',

  /* ---------------------------------------------------------------- KPI ----
     Labels are one or two words. The strip is six columns of 10px uppercase in
     the design, and "Cycle Efficiency (%OA)" ellipsises to "Cycle Effici…"
     there, which communicates less than the short label plus the caption below
     it does. D-19's requirement - that the name not imply availability - is met
     by the caption, which is always rendered and never hover-only, and now also
     by the Down column sitting on the same screen. */
  'kpi.machines': 'Total machine',
  'kpi.running': 'Running',
  'kpi.stopped': 'Stop',
  'kpi.oa': 'Avg %OA',
  'kpi.oa.short': '%OA',
  /* What the figure *is*, not what it leaves out.
     "excludes machine downtime" was accurate and read as a puzzle: %OA elsewhere
     in this industry means Operating Availability, which includes downtime, so a
     caption saying it does not invited exactly the question it was meant to
     settle. Naming the metric answers that question in two words - this is a
     cycle-time ratio, not an availability one - and D-19's full caveat is on the
     label as a tooltip and in the methodology dialog, where a sentence fits.
     Deliberately not "Net Operating Rate": that name implies availability, which
     is the misreading being prevented. */
  'kpi.oa.definition': 'Cycle efficiency',
  // The gap to the target, in percentage points. "pts" and not "%" - the figure
  // beside it is a percentage and the distance between two percentages is
  // points, and calling it 11.6% invites the reader to take it as a ratio of
  // the target rather than a difference from it.
  'kpi.oa.gap': '{delta} pts',
  'kpi.oa.tooltip':
    'Cycle Efficiency (%OA) compares standard cycle time against actual cycle time for the parts that were produced. Cycles longer than standard + 100 s count as standard, so machine downtime is excluded from this figure. It is not OEE Availability and will always read higher. Downtime appears separately under Stopped and Longest Active Stops.',
  'kpi.achievement': '%Achievement',
  /* Split into two whole phrases rather than one string, because the artboard
     colours the actual and leaves the plan plain - and a colour has to wrap a
     phrase, not a substring someone found with indexOf. Each half still reads
     as a complete unit to a translator. */
  'kpi.achievement.actual': 'Actual {qty}',
  'kpi.achievement.plan': 'Plan {qty} {unit}',
  /*
   * The overview strip splits the fraction across the card - plan in the corner,
   * actual at the foot - so the unit rides on one of them, not both. It goes on
   * the actual, which is the figure a reader checks against Grafana. The corner
   * is the narrowest slot on the strip and "Plan 23,200 pcs" there cost the
   * neighbouring label 16px it did not have. Section 8.5 still holds: the unit
   * is read from the payload, never assumed.
   */
  'kpi.achievement.planShort': 'Plan {qty}',
  'kpi.achievement.actualUnit': 'Actual {qty} {unit}',
  // The shortfall against plan, in the payload's own unit. Points would have
  // been the consistent choice beside the %OA card, and it is the wrong one:
  // this card's plan is a quantity, and "1,299 pieces short" is what a
  // production meeting can act on.
  'kpi.achievement.gap': '{delta} {unit}',
  'kpi.attention': 'Needing attention',
  // Two keys rather than one interpolated string: `t` does plain substitution,
  // so a single "{count} plants" prints "1 plants" for a single-plant base.
  'table.plants.one': '{count} plant',
  'table.plants.other': '{count} plants',
  /* Names the threshold rather than referring to it. "None below threshold"
     sat two panels away from a chip reading "3 Below target" and read as a
     contradiction; the two count different things, and printing the number is
     what makes both statements legible at once. Served, never hardcoded - see
     zTierPolicy and D-16. */
  'kpi.attention.none': 'None below {threshold}%',
  /* On the label, for the reader who does the subtraction anyway. */
  'kpi.attention.tooltip':
    'Bases in the critical band: %OA below {threshold}%. Not the same as below the {target}% target: the tier bands are {target}-5 and {target}-20, so a base at 82% is below target without being critical. The ranking’s status chips count every band.',
  // The badge in the card's top-right corner. Rendered only when the count is
  // non-zero, so it is the strip's one piece of across-the-room signalling.
  'kpi.attention.badge': 'Alert',
  'kpi.target': 'Target {target}%',
  /* Both captions are measured to the narrowest card they appear on: 161px at
     TV density, which is sixteen characters at 18px. The old running caption was
     forty-eight and ellipsised to "Mass Pro + Dandori · 4M Chang…" even at the
     design width, and a truncated definition is worse than a short one. What
     came off is on the label as a tooltip, and the machines it excluded are now
     counted on the Total machine card rather than merely alluded to here.

     "Mass Pro/Dandori" rather than "Mass Pro + Dandori": the plus is ten pixels
     wider than the TV card and the slash is not. */
  'kpi.running.definition': 'Mass Pro/Dandori',
  'kpi.running.tooltip':
    'Machines in Mass Pro or Dandori. 4M Change is not counted as running, and since TOTAL is RUNNING + STOP it is not counted anywhere.',
  /* Says which kind of stop, which is the question an executive is actually
     asking. It is the Stop status alone: a machine halted while it was scheduled
     to produce. No Plan and Order End are not stops and never were - that is the
     `stopped-means-stop` invariant, not a wording choice. */
  'kpi.stopped.definition': 'Unplanned stop',
  'kpi.stopped.tooltip':
    'The Stop status only: a machine halted while it was scheduled to produce. No Plan (nothing scheduled) and Order End (the order is complete) are not stops, so they are not counted here - nor anywhere else, since TOTAL is RUNNING + STOP.',
  'kpi.machines.definition': '{total} bases · {countries} countries · {missing} not yet connected',
  /* The design prints a bare "88.9%" under Running. The denominator is the one
     thing that has to travel with it: six of nine bases have no gateway, so the
     connected fleet and the fleet are different numbers. */
  'kpi.share': '{pct} of connected fleet',
  /* Coverage, on the card it qualifies. This used to be a list of nine base
     codes under the masthead, where nobody read it. */
  'kpi.machines.connected': '{reporting} of {total} connected',
  /* The rest of the census, beside the total: "1 Idle · 1.5%". Without it the
     strip prints 54 and 10 over 65 and reads as an arithmetic error, and its two
     shares sum to 98.5%. The buckets are named because "1 Other" would be the
     least informative true answer available. */
  'kpi.machines.rest': '{count} {buckets} · {pct}',

  /**
   * The ⓘ affordance. Named after the card so one string serves every card that
   * grows one, and so a screen reader hears which figure it is about.
   */
  'kpi.info.open': 'Where does {label} come from?',
  /* Marks the statuses that are outside TOTAL. A word, not a shade -
     src/domain/status.ts forbids meaning by colour alone, and this is the one
     thing stopping a reader adding Order End into the Stop figure. */
  'kpi.notCounted': 'not counted in the totals',
  /**
   * A source note is three parts by convention: the lead, an optional boxed
   * rule, and an optional note under it. KpiCard looks up `.formula` and
   * `.note` beside the base key, so a card that needs only a sentence just
   * omits them.
   *
   * Two rules for the wording, both learned the hard way:
   *
   * 1. **No internal codes.** D-21, T-11, Q-08 mean nothing to the person
   *    reading the board, and one of these strings shipped with "while D-21 is
   *    open" in it. State the reason instead - "because nobody has decided yet
   *    whether it counts as running or as a stop" says the same thing to
   *    everyone. The codes belong in comments and in docs/DESIGN.md.
   *
   * 2. **Never translate a status name; gloss it.** `Mass Pro`, `Dandori`,
   *    `4M Change` are what the machine HMI shows and what the floor calls
   *    them, so renaming them would leave an executive and a technician
   *    describing the same machine in different words. Keep the name, put a
   *    short parenthetical after it the first time it appears in a sentence.
   */
  'kpi.machines.source': 'Counted from the latest status each machine reported to InfluxDB.',
  'kpi.machines.source.formula': 'TOTAL = RUNNING + STOP',
  'kpi.machines.source.note':
    'A machine in any other state is not counted - No Plan (nothing scheduled), Order End (the order is complete), Pending (waiting) - and a site sending no telemetry contributes nothing.',

  'kpi.running.source':
    'Machines whose latest status is Mass Pro or Dandori. Dandori is a mould change: the machine is manned and being worked on, which is why it counts as running rather than as a stop.',
  /* The split is the whole point of this one - a reader takes 24 running
     differently once they know how many of those are changing moulds. */
  'kpi.running.source.formula': 'RUNNING = Mass Pro {massPro} + Dandori {dandori}',
  'kpi.stopped.source':
    'Every counted machine that is not running: Stop, plus anything else the floor is reporting that is neither Mass Pro nor Dandori. RUNNING + STOP is TOTAL, so no machine falls between the two cards.',
  'kpi.stopped.source.formula': 'STOP = {breakdown}',
  'kpi.stopped.source.note':
    'A machine that has finished its order (Order End) is not counted at all - the plant board shows it as a second card beside the live one, so counting it would count the machine twice. Everything else that is not running is here, including No Plan and 4M Change, because a card an executive escalates on should not have a remainder hidden behind it.',

  'kpi.running.source.note':
    'No other status reaches this figure. 4M Change - the check after a change of operator, machine, material or method - is left out, because nobody has decided yet whether it counts as running or as a stop.',

  /*
   * The one card whose panel has to name its own denominator out loud.
   *
   * %OA exists only for a machine with an order loaded, and on the real data
   * that is a minority of the floor - four of twenty-nine on one plant the day
   * this was written. A reader who takes this figure for "how the factory is
   * doing" is reading it wrong, and the count in the rule is what stops them.
   */
  /* Ordered "what the inputs are, then the formula". An executive shown the
     formula first has no idea where any of its terms come from, and the panel's
     whole job is that nobody has to find someone in IS to ask. */
  'kpi.oa.source':
    '%OA says how much faster or slower a machine is running than its standard. It uses three figures the machines report to InfluxDB on every shot\n' +
    '- Standard cycle time - how long one cycle should take, set in the part master data\n' +
    '- Actual cycle time - how long the machine really took on that cycle\n' +
    '- Pieces produced - the weighting, so a long production run counts for more than a short one',
  /* A bare count was worse than no count: "plain average of 6 machines" beside
     a Total machine card reading 38 is a number with no denominator, and the
     first question it got asked was where the 6 came from. The ratio answers
     that in the same glance, and the note below says what happened to the rest. */
  'kpi.oa.source.formula':
    '%OA = standard cycle time ÷ actual cycle time × 100',
  /* A line starting `- ` becomes a bullet - see SourceText in KpiCard.tsx.
     Written as a list because these are two unrelated reasons, and run together
     as one sentence a reader could not see there were two of anything. */
  'kpi.oa.source.note':
    '100% = running exactly to standard · below 100% = slower than standard\n' +
    'This group figure is the average of {machines} of {total} machines\n' +
    'Two kinds of machine are left out\n' +
    '- No production order loaded. Not scored 0%, because having nothing scheduled is not the same as producing nothing\n' +
    '- Several orders running in the same shot. The standard time reported covers all of them while the cycle taken is a single cycle, so the figure comes out inflated\n' +
    'A cycle more than 100 seconds over standard is counted as standard, so time a machine spent stopped never reaches this figure. That is on the Stop card instead.',

  /*
   * The one card where the ⓘ has to correct the label rather than only explain
   * it. The denominator is the loaded order's quantity, and the plant board
   * calls the same number `%AR (PROGRESS)` - so a reader who takes
   * "%Achievement" as attainment against today's plan has the wrong figure in
   * mind, and no amount of precision elsewhere fixes that. Until the label
   * itself is settled, this panel is where it is said.
   */
  /* The most misread card on the strip: "Needing attention 0" sits on the same
     screen as a "3 Below target" chip and reads as a contradiction, when the two
     count different bands. The panel says so where the hover could not. */
  'kpi.attention.source':
    'Counts bases whose %OA is in the critical band. Not machines, and not plants\n' +
    '- Critical means %OA below {warn}%, a threshold the server sets rather than one fixed in this page\n' +
    '- A base with no %OA yet is not counted, because unmeasured is not the same as healthy',
  'kpi.attention.source.formula': 'Needing attention = bases with %OA below {warn}%',
  /* The bands as ranges, not as "{target}-5 and {target}-20". That phrasing
     made the reader do the arithmetic before they could read the sentence. */
  'kpi.attention.source.note':
    'There are three colour bands. This card counts only the lowest\n' +
    '- {good}% and above, on target\n' +
    '- {warn} to {warnTop}%, below target but not yet critical\n' +
    '- Under {warn}%, critical, the band this card counts\n' +
    '{plants} plants are in the critical band right now',

  /* Same shape as kpi.oa.source: name the inputs, then the formula, then the
     one thing a reader will otherwise misread. */
  'kpi.achievement.source':
    '%Achievement says how far through its loaded production order a machine has got. It uses two figures from the same data as %OA\n' +
    '- Order quantity - how many pieces the order is for, not a shift or daily target\n' +
    '- Pieces produced - how many of them the machine has made so far',
  'kpi.achievement.source.formula': '%Achievement = actual {actual} ÷ plan {plan} × 100',
  'kpi.achievement.source.note':
    'The denominator is the order’s own quantity, not a target for the shift. The plant board calls this number %AR (Progress) for that reason\n' +
    '- A machine an hour into an 800-piece order reads low because the order just started, not because it is behind\n' +
    '- Above 100% means more was produced than the order asked for\n' +
    '- A machine with no order loaded is in neither half of the fraction',

  /* ----------------------------------------------------------- coverage */
  'coverage.label': 'Coverage {reporting} of {total} sites',
  'coverage.partial': 'Based on {reporting} of {total} sites',
  'aggregation.weighted_by_qty': 'weighted by output qty',
  'aggregation.weighted_by_time': 'weighted by run time',
  'aggregation.simple_avg': 'simple average',

  /* ------------------------------------------------------------- tiers */
  'tier.good': 'On target',
  'tier.warn': 'Below target',
  'tier.critical': 'Critical',
  'tier.unknown': 'Unknown',

  /* ------------------------------------------------------- site status */
  'site.online': 'Reporting',
  'site.stale': 'Stale data',
  'site.degraded': 'Partly reporting',
  'site.no_data': 'No data',
  'site.not_connected': 'Not connected',
  'site.notConnectedShort': 'Not connected',
  'site.lastSeen': 'as of {time}',
  'site.neverConnected': 'No telemetry yet',

  /* ------------------------------------------------------- readiness */
  'readiness.live': 'Live',
  'readiness.installing': 'Installing',
  'readiness.planned': 'Planned',
  'readiness.unknown': 'Unknown',

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

  'measure.not_applicable': 'n/a',
  'measure.noPlan': 'No plan',

  /* Section 8.5: Shot and Pcs get swapped in the source data, so the unit is
     always rendered from the payload's `qty_unit` and never assumed. */
  'unit.pcs': 'pcs',
  'unit.shots': 'shots',

  /* ------------------------------------------------------------ shifts */
  'shift.chip': '{code} · {time}',
  'shift.chipFull': '{label} ({index} of {of}) · {time}',
  'shift.header': '{label} · {start}–{end} · {time}',
  'shift.productionDate': 'Production date {date}',
  'shift.notConfigured': 'Shift not configured',
  'shift.notConfigured.tooltip':
    'No shift pattern has been provided for this site. Times shown are local clock time.',
  'shift.endsSoon': 'ends {time}',
  'shift.ending': 'ending',
  'shift.inProgress': 'in progress',
  'shift.notStarted': 'not started',

  /* ----------------------------------------------------------- banners */
  'banner.stale.title': 'Live data unavailable',
  'banner.stale.body': 'Showing the snapshot from {time} ({age}). Retrying…',
  'banner.frozen.title': 'Data is not advancing',
  'banner.frozen.body': 'The server has returned the same snapshot since {time}.',
  'banner.partial.title': 'Some data sources are unavailable',
  'banner.partial.body': '{sources} could not be reached, so parts of this page are incomplete.',
  'banner.config.title': 'Configuration problem',
  'banner.retry': 'Retry now',
  'banner.dismiss': 'Dismiss this notice',
  'banner.mock.title': 'Sample data',
  'banner.mock.body': 'This build is showing generated data, not the production database.',

  /* ------------------------------------------------------------ errors */
  'error.title': 'Could not load this view',
  'error.network': 'The server could not be reached.',
  'error.timeout': 'The server did not respond in time.',
  'error.http': 'The server returned an error.',
  'error.unauthorized': 'You are not signed in.',
  'error.contract': 'The server sent data in an unexpected format.',
  'error.notfound': 'That site does not exist.',
  'error.detail': 'Technical detail',

  /* --------------------------------------------------------------- map */
  // The two board tabs. They name what the reader is about to look at, not the
  // widget they will get: "which base" on one side, "what happened" on the other.
  'board.fleet': 'Fleet Overview',
  'board.analytics': 'Executive Analytics',
  'map.title': 'Device Location & Health',
  'map.bases': '{count} Bases Global',
  'map.sub': 'pin colour and shape = reporting state · number = %OA',
  'map.legend.noData': 'No data',
  'map.offlineBasemap': 'Offline basemap',
  'map.reset': 'Reset view',
  'map.zoomIn': 'Zoom in',
  'map.zoomOut': 'Zoom out',
  'map.expand': 'Expand map',
  'map.collapse': 'Restore map',
  'map.pinLabel': '{company}, {country}. {status}.',
  'map.notConnected': 'not connected',

  /* ------------------------------------------------------ the base drawer ----
     Tapping a pin opens BaseDrawer over the right-hand edge of the board rather
     than navigating. `drawer.open` is the pin's tooltip and says what the tap
     will do, because the card itself - a percentage over a code - gives no clue
     that it is a control at all.

     The tile labels are the drawer's own rather than the ranking's `table.*`
     heads: a column head is abbreviated to fit a column ("%ACHV", "Downtime")
     and a tile has the width to say what the figure is. The captions underneath
     each name the thing the figure should be read against, which is the point of
     the tile over the table cell.

     There is no "view report" or "view details" key. The base's own page has
     nothing on it yet; when it does, the action goes in the drawer's footer. */
  'drawer.open': 'Show {company} details',
  'drawer.close': 'Close panel',
  'drawer.oa': 'Current %OA',
  'drawer.achv': '%Achievement',
  'drawer.achv.note': 'Actual {actual} of {plan} {unit}',
  'drawer.machines': 'Machines running',
  'drawer.machines.note': '{stopped} stopped · {idle} not scheduled',
  'drawer.downtime': 'Accumulated downtime',
  /* Says the one thing about this figure that surprises people, and the reason
     it is a tile of its own rather than a caption under %OA - D-19. */
  'drawer.downtime.note': 'Not included in %OA',
  /* The reading block: the gap to target and the gap to plan, which are the two
     numbers a reader would otherwise work out by hand. Each is only rendered
     when the field behind it is present. */
  'drawer.read.oa': '%OA is {delta} points against the {target}% target.',
  'drawer.read.planMet': 'Output has met plan at {pct}.',
  'drawer.read.planShort': 'Output is at {pct} of plan.',
  /* The plant list. Shown only when there is more than one - the map cannot say
     that THS is four plants, because one pin per company is what stops plants on
     the same site landing on top of each other. */
  'drawer.plants': '{count} plants at this base',
  /* For the six bases with no gateway, where every tile would be an em-dash.
     These two are the facts a dark base does have - how far along it is, and
     whether it has ever been heard from. */
  'map.pop.rollout': 'Rollout',
  'map.pop.telemetry': 'Telemetry',

  /* ------------------------------------------------------------- table */
  'table.title': 'Plant ranking',
  'table.sub': 'sorted by %OA, worst first',
  /* Names the cause and the cure. An empty panel with no sentence on it is
     indistinguishable from one that failed to load. */
  'table.noRegion': 'No bases selected. Pick one or more under Region.',
  'table.base': 'Plant',
  'table.plant': 'Plant',
  'table.dateTime': 'Date/Time',
  'table.shift': 'Shift',
  'table.runStop': 'Run/Stop',
  'table.oa': '%OA',
  'table.achv': '%ACHV',
  'table.down': 'Downtime',
  'table.output': 'Output',
  'table.run': '{count} Run',
  'table.stop': '{count} Stop',
  /* A downtime column reading "0m" invites the reader to wonder whether the
     figure is real or a default. The word does not. */
  'table.noDowntime': 'none',
  'table.notReporting': 'Not reporting ({count})',
  'table.expand': 'Show plants for {company}',
  'table.collapse': 'Hide plants for {company}',
  'table.plantsCount': '{count} plants',

  /* --------------------------------------------- sortable column heads ----
     Tooltips only - the sort *state* is announced from aria-sort on the <th>,
     never from these. Each says what the tap will do rather than repeating the
     column label the button already carries. */
  'sort.by': 'Sort by {column}',
  'sort.reverse': 'Reverse the order',

  /* ------------------------------------------ status summary chips ----
     The tier counts in the ranking's panel head. The tier words themselves come
     from tier.* above, so the chip cannot disagree with the row it summarises. */
  'summary.label': 'Bases by status',
  /* One chip as one phrase, which is what a screen reader is given and what the
     tooltip shows. Interpolated rather than concatenated so the order is the
     translator's to choose. */
  'summary.chip': '{count} {status}',
  /* The coverage half of that head. "Offline" rather than "Not reporting"
     because it has to sit beside "Connected" and be read as its opposite in one
     glance - the pair is the reading, not either word on its own. */
  'summary.connected': 'Connected',
  'summary.offline': 'Offline',
  'summary.coverage': '{connected} bases connected, {offline} offline',

  /* ------------------------------------- right-panel segmented control ----
     Short by requirement: three tabs plus a count have to fit beside a panel
     title inside one panel head, so these are one word each. */
  'view.select': 'Panel view',
  'view.ranking': 'Ranking',
  'view.trend': 'Trend',
  'view.alerts': 'Stops',
  /* The two tabs in the left column, spelled out as the artboard draws them.
     The range is interpolated rather than hardcoded to 24hr: the tab has to
     say which window the line covers, and that window is selectable. */
  'trend.tab': 'Global %OA trend · {range}',
  'alerts.tab': 'Longest active stops & alerts',

  /* ------------------------------------------------------------- trend */
  'trend.title': 'Trend',
  'trend.sub': 'Hourly average across all connected plants · last 24 h',
  'trend.now': 'now',
  'trend.ago24': '−24h',
  'trend.oaAvg': '%OA Avg',
  'trend.target': 'Target {target}',
  'trend.axis': 'Time ({tz})',
  'trend.peak': 'Peak',
  'trend.dip': 'Low',
  'trend.below': 'Below {threshold}',
  'trend.vsTarget': 'vs target',
  'trend.showTable': 'Table',
  'trend.showChart': 'Chart',
  'trend.insufficient': 'Not enough history to draw a trend yet.',
  'trend.time': 'Time',
  'trend.sites': 'Sites',
  /* The count that actually moves hour to hour. Measured over a live 24 h it
     ran from 1 to 18 while Sites stayed at 1 or 2, so an hour averaged over one
     machine drew the same dot as an hour averaged over eighteen. */
  'trend.machines': 'Machines',

  /* ------------------------------------------------------------ alerts */
  'alerts.title': 'Active stops',
  'alerts.sub': 'top 5 across reporting bases',
  'alerts.none': 'No active alerts.',
  'alerts.owner': '{role}',
  'severity.critical': 'Critical',
  'severity.major': 'Major',
  'severity.minor': 'Minor',
  'severity.info': 'Info',
  'alert.reason.stop.heater_failure': 'Heater failure',
  'alert.reason.stop.material_jam': 'Material jam',
  'alert.reason.stop.quality_hold': 'Quality hold',
  'alert.reason.stop.mold_change': 'Mold change overrun',
  'alert.reason.telemetry.sync_timeout': 'Telemetry sync timeout',

  /* -------------------------------------------------------- data quality */
  'quality.warnings': '{count} data integrity warnings',
  'quality.title': 'Data integrity',
  'methodology.open': 'How these numbers are calculated',
  'methodology.title': 'How these numbers are calculated',
  'methodology.target': 'Target %OA',
  'methodology.tierPolicy': 'Colour policy',
  'methodology.aggregation': '%OA aggregation',
  'methodology.freshness': 'Freshness thresholds',
  'methodology.generatedAt': 'Snapshot taken',
  'methodology.source': 'Data source',
  'methodology.close': 'Close',

  /* -------------------------------------------------------------- misc */
  'common.loading': 'Loading…',
  'common.grafana': 'Open in Grafana',
  /* ------------------------------------------------------------ countries ----
     Shown under each base code in the ranking. Country names are UI text, not
     master data - SAP holds the company name, never the country's - so they
     are translated here rather than sent by the API. A code with no entry
     falls back to the code itself, which is visible rather than blank. */
  'country.TH': 'Thailand',
  'country.JP': 'Japan',
  'country.HU': 'Hungary',
  'country.VN': 'Vietnam',
  'country.ID': 'Indonesia',
  'country.US': 'USA',
  'country.MX': 'Mexico',

  'common.of': 'of',
  'common.seconds': '{n}s',
  'common.minutes': '{n}m',
  'common.hours': '{n}h',
} as const;

export type TKey = keyof typeof en;

/**
 * The shape every locale must satisfy: the same keys, any string value.
 *
 * Note this is `Record<TKey, string>` and not `typeof en`. With `as const` the
 * latter would pin each value to its English literal, so `th.ts` could only
 * compile by repeating the English text. What we want checked is key coverage,
 * and that is exactly what this gives - omit a key and `npm run typecheck`
 * fails, which is stricter than i18next's silent runtime fallback.
 */
export type Dict = Record<TKey, string>;
