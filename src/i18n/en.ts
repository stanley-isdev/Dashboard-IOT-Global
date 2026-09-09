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
  /*
   * The masthead lockup, split across the two lines the brand mark is drawn
   * with. Never translated - it is the group name, like the company codes
   * above, so both locales carry the same two strings and th.ts repeats them
   * rather than romanising them. `app.title` stays the whole name and is what
   * the tab, the alt text and the link label use.
   */
  'app.bases': 'THS · ASI (Thailand) · VNS (Vietnam) · ISE (Indonesia) · STJ (Japan) · SUS · IIS (USA) · SMX (Mexico) · SEH (Hungary)',
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
  /* "Plant", the level below Region. The operator boards call the same level
     `Lamp_var` ("LAMP 2"), so a reader holding both screens maps between them
     on the plant CODE - which is why the menu leads with the code, not the
     label. */
  'filter.plant': 'Plant',
  'filter.allPlants': 'All · {count} plants',
  'filter.plantCount.one': '{count} plant',
  'filter.plantCount.other': '{count} plants',
  'filter.noPlants': 'No plants selected',
  /* The refresh control, mirroring the plant board's. The interval values
     themselves (5s, 1m) are not translated - see the note on `label` in
     RefreshPicker.tsx. */
  'refresh.now': 'Refresh now',
  'refresh.interval': 'Auto-refresh interval',
  'refresh.off': 'Off',
  'range.8h': 'Last 8h',
  'range.24h': 'Last 24h',
  'range.7d': 'Last 7 days',
  /* The picker's trigger has room for one short string beside the clock and
     the offset, so it uses these; the sentence forms above label the rows
     inside the panel and anything that names a range in prose. */
  'range.8h.short': '8 hours',
  'range.24h.short': '24 hours',
  'range.7d.short': '7 days',
  'filter.time': 'Time',
  /* The export control at the end of the filter row. `export.label` is the word
     on the button; the next two are its tooltip, which is the only place there
     is room to say what the file contains and why it is sometimes unavailable.
     "PDF" is not translated - it is a format, like `5s` is a unit.

     `export.busy` replaces the label for the second or so the board is being
     photographed and the two rendering libraries are being fetched. It is a
     word and not a spinner because the button is 100px of orange with a word in
     it, and swapping the word is the one change at that size a reader notices
     without looking for it.

     The last two are the header printed at the top of the file. Both are
     timestamps and they usually differ by seconds, so the labels have to be
     specific about which is which: one is when the numbers were measured, the
     other is when this copy of them was taken. */
  'export.label': 'Export',
  'export.busy': 'Exporting…',
  'export.pdf': 'Download this board as a PDF',
  'export.generated': 'Data generated',
  'export.exported': 'Exported',
  'export.empty': 'Nothing to export yet',

  /* --------------------------------------------------------- live badge */
  'live.live': 'Live',
  'live.age': 'updated {age}',
  'live.slow': 'Refreshing…',
  'live.stale': 'Stale',
  'live.offline': 'Offline',

  /* ------------------------------------------------------------ toggles */
  /* The language menu's trigger and the menu's own heading: the generic word,
     so the capsule does not change width when the locale does. */
  'lang.label': 'Language',
  /* The two locale names are endonyms and are deliberately *not* translated -
     they are the same two strings in th.ts. Someone who cannot read the
     language currently on screen can still recognise their own language's name
     in its own script, and that is the whole population this control is for. */
  'lang.th': 'ไทย',
  'lang.en': 'English',
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
  /* The footer's other half: the same promise about the metrics, for the mode
     where there is no single zone to name. */
  'time.siteLocalNote': 'Timestamps in each site’s own clock · metrics use each site’s own shift',

  /* ------------------------------------------------------- time picker ----
     Grafana's wording, deliberately: this board is read beside one, and the
     two controls should not use two vocabularies for the same thing. */
  'time.range': 'Time range',
  'time.quick': 'Quick ranges',
  'time.absolute': 'Absolute time range',
  'time.from': 'From',
  'time.to': 'To',
  'time.apply': 'Apply time range',
  'time.selectRange': 'Select a time range',
  'time.closeCalendar': 'Close the calendar',
  'time.openCalendar': 'Pick a date',
  'time.prevMonth': 'Previous month',
  'time.nextMonth': 'Next month',
  'time.pickHint': 'First click = start date · click again = end date',
  'time.clear': 'Clear',
  /* Shown while a calendar window is the live one, with the escape back to the
     quick ranges beside it. The quick list still shows a tick against whichever
     range it would fall back to, so without this line there is nothing on the
     panel saying which of the two halves the board is actually on. */
  'time.absoluteActive': 'The board is on the dates above.',
  'time.backToQuick': 'Back to a quick range',
  /* Warns, before Apply is pressed, that this window costs several reads.
     ~71 h is all one InfluxDB query can scan on this instance, so a week is
     three - and a reader told nothing assumes the slow paint is a hang. */
  'time.absoluteChunks': 'A window this wide is read in {n} parts, so it takes longer to load.',

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
  // The shortfall against plan. It carried the payload's unit until the six-card
  // strip narrowed this card's figure row: "-1,573 pcs" overran it by 10px at
  // 1180px and rendered as "-1,57…", which is a truncated *number* and the one
  // thing on this board that must never happen. The unit is not lost - the foot
  // directly below prints "Actual 21,626 pcs" on the same card - so what came
  // off is the only word here that was already on screen twice.
  'kpi.achievement.gap': '{delta}',
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
  /*
   * The same qualifier as the pill beside the figure, where it has about 45px
   * and sets as two centred lines.
   *
   * English needs no shorter wording, so this is 'kpi.target' verbatim and the
   * key exists for Thai. "Target" and "95%" are two unbreakable runs and wrap
   * to the two lines the figure row was drawn to hold; Thai's "เป้าหมาย" is one
   * word to a reader and two to the line breaker (ICU breaks Thai on
   * syllables, so เป้า | หมาย is a legal break), which made three lines, grew
   * the figure row past its min-height and, because the six cards are grid
   * siblings that stretch to a common height, pushed the whole strip down in
   * Thai only. "เป้า" is what the plants say anyway.
   *
   * Split from 'kpi.target' rather than shortened in place: the drawer tile
   * caption that also reads it has a full card width and no reason to lose the
   * word. Mirrors 'kpi.achievement.planShort', split off for the same slot.
   */
  'kpi.targetShort': 'Target {target}%',
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

  /* ------------------------------------------- absence (why there is no data) */
  'absence.noDate': 'No telemetry yet',
  'absence.quietWindow': 'No data in this window',
  'absence.owner': 'Owner: {owner}',
  'absence.contradiction': 'Configured as connected, but nothing has ever arrived',

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
  /* The base page's shift panel. It used to borrow 'filter.range' - 'Range' -
     which named the control in the toolbar above rather than the table below,
     and the table is a per-shift breakdown of output, plan and %OA. */
  'shift.breakdown': 'Shift breakdown',
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
  /*
   * The end of an outage. The body leads with the gap rather than with the
   * recovery, because the gap is the fact a reader cannot get anywhere else:
   * the badge already says the board is live, and nothing else on screen says
   * the trend they are about to read has a hole in it. See describeRecovery.
   */
  'banner.recovered.title': 'Connection restored',
  'banner.recovered.body': 'The board was not current for {gap}, so the trend has a gap.',

  /* ------------------------------------------------------- state pages */
  /*
   * The screens with no numbers on them. See HardErrorState.tsx for why there
   * are nine of these rather than one: the six ApiError kinds are six different
   * faults with six different owners, and a reader who cannot tell them apart
   * from the screen has to go and ask somebody.
   *
   * House style for every one of them, and the reason the strings are this
   * shape rather than shorter:
   *
   *   the title  names what is wrong, as a statement, never with an "!"
   *   the body   says what still works and how long this lasts
   *   check1..n  are imperatives in the order to work through them, from what
   *              the reader can do alone to what needs somebody else
   *
   * No apologies anywhere. "Sorry, something went wrong" costs a line and tells
   * a person on a factory floor nothing they can act on.
   */
  'state.try': 'Try:',
  'state.reload': 'Reload',
  'state.retryNow': 'Retry now',
  'state.retrying': 'Reconnecting - attempt {n} of {total}',
  'state.retryAuto': 'The board keeps trying on its own.',
  /* Said plainly, because with refresh off nothing will clear this screen and a
     reader who expects it to recover would sit in front of it. */
  'state.retryOff': 'Automatic refresh is off, so this will not clear on its own.',
  'state.copy': 'Copy the details',
  'state.copied': 'Copied',

  'state.loading.overview': 'Loading the global board',
  'state.loading.scope': 'Loading {name}',
  'state.loading.body': '{range} · {process}',
  'state.loading.code': 'WAITING FOR THE FIRST RESPONSE',

  /* ------------------------------------------------------------ errors */
  /*
   * The flat keys are the page TITLES, which is what `ApiError.messageKey`
   * resolves to. They were full sentences when they were the whole of a
   * one-line panel; each now heads a page that says the rest.
   */
  'error.title': 'Could not load this view',
  'error.network': 'Cannot reach the server',
  'error.timeout': 'The server did not answer within {sec} seconds',
  'error.http': 'Cannot reach the database',
  'error.unauthorized': 'Sign in to view this board',
  'error.contract': 'The data does not match the agreed format',
  'error.notfound': 'That site does not exist',

  'error.network.body':
    'The API could not be contacted at all, so the fault is the network or a server that is not running.',
  'error.network.check1': 'That this machine is on the site network',
  'error.network.check2': 'That the API service is running',

  'error.timeout.body':
    'The window in force may be wider than the database can answer for. Narrow it and load again.',
  'error.timeout.check1': 'A shorter range in the time picker',
  'error.timeout.check2': 'A narrower Region or Process filter',
  /* The button that does check1 in one tap, since the row it names is the one
     control the shell keeps on screen for this state. */
  'error.timeout.narrow': 'Load the last 24 hours',

  'error.http.body':
    'The server is running, but it could not read from InfluxDB. This board stays empty until that connection is back.',
  'error.http.check1': 'That InfluxDB is running',
  'error.http.check2': 'The token and the bucket in the server environment',
  'error.http.check3': 'If it persists, send IT the line at the foot of this page',

  'error.contract.body':
    'This is a fault in the server, not on this machine. Copy the line below and send it to the development team.',

  'error.unauthorized.body':
    'The session has expired, or this browser has not signed in with a company account.',

  'error.notfound.body':
    'The code {code} is not in the system. It may have been renumbered, or this is an old link.',
  'error.notfound.home': 'Back to the global overview',

  /* ------------------------------------------------------ empty result */
  /*
   * Not an error, and worded so nobody reads it as one. The query returned 200
   * with an empty list because of a choice the reader made, so the first thing
   * the body says is that the system is fine.
   */
  'empty.title': 'No data matches the current filters',
  'empty.noRegion': 'Everything is working - no Region is ticked, so there is no base to show.',
  'empty.narrowed': 'Everything is working. The filters in force match nothing in this window.',
  'empty.selectAll': 'Select every base',
  'empty.clear': 'Clear the filters',

  /*
   * The panel-level version, for a drill-down where the site is real and its
   * KPI cards are correct and only one list came back empty. Both name Process
   * and nothing else, because ScopeQuery and PlantQuery carry `range` and
   * `process` only - see the notes at the call sites. Naming Plant or Zone here
   * would send the reader to clear a control that is not the cause.
   */
  'empty.panel.plants': 'No plant at this base runs {process}.',
  'empty.panel.machines': 'No machine in this plant runs {process}.',
  'empty.panel.clearProcess': 'Show every process',
  'empty.panel.working': 'Everything else on this page is current.',

  /* --------------------------------------------------------------- map */
  // The two board tabs. They name what the reader is about to look at, not the
  // widget they will get: "which base" on one side, "what happened" on the other.
  'board.fleet': 'Fleet Overview',
  'board.analytics': 'Executive Analytics',
  'map.title': 'Device Location & Health',
  'map.bases': '{count} Bases Global',
  'map.sub': 'pin colour and shape = reporting state · number = %OA',
  // Two silences, two entries - and the range is named in the first, because
  // "No data" beside "Not connected" reads as the same claim twice. With both
  // swatches on the one grey these words are doing more work than usual: see
  // src/domain/status.ts for why no colour was spent on the distinction.
  'map.legend.noData': 'No data in range',
  'map.legend.notConnected': 'Not connected',
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
  /* `table.noRegion` was here, and it said the same thing `empty.noRegion` now
     says a level up: RankingTable used to explain an empty region inside its
     own panel, and OverviewPage answers it for the whole board instead, because
     a region picked down to nothing empties the KPI strip, the map and the
     trend beside it. See the note in RankingTable where the branch used to be. */
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
  /* The Top-N picker beside the title above - "Top 5" / "Top 10" / "Top 20" /
     "Top 50". Also the aria-label for its trigger and its menu. */
  'alerts.top': 'Top {n}',
  'alerts.topAria': 'Number of stops shown',

  /* ------------------------------------------------------------- trend */
  'trend.title': 'Trend',
  /* The caption under the panel title: what the line covers, in two halves.

     The scope half differs by page - the global board averages every connected
     plant, the drill-down is one site - and saying "all connected plants" over
     a single base's chart was the reason this was not simply shared.

     The span half is the one that must name what is *drawn* rather than what
     was picked. `trend.span` is the ordinary case; `trend.spanShort` is the one
     the backend forces - the Flux window tops out at 71 hours
     (MAX_WINDOW_HOURS), so "Last 7d" is drawn over the 24 hours that exist, and
     the caption says so rather than letting the title's "7 days" stand over a
     day of data. */
  'trend.sub': 'Hourly average across all connected plants · {span}',
  'trend.subSite': 'Hourly average for this site · {span}',
  'trend.span': 'last {hours} h',
  'trend.spanShort': 'last {hours} h of {range} served',
  'trend.now': 'now',
  'trend.ago24': '−24h',
  'trend.oaAvg': '%OA Avg',
  'trend.target': 'Target {target}',
  'trend.axis': 'Time ({tz})',
  'trend.peak': 'Peak',
  'trend.dip': 'Low',
  'trend.below': 'Below {threshold}',
  /* %OA is standard over actual time, so it has no ceiling at 100 (D-27). The
     axis stops where the readable band stops; this says what is above it. */
  'trend.offscale': '{count} h off scale',
  /* The label on the zoom that answers it. "Axis max" and not "Zoom": what the
     control moves is a number the reader can already see on the axis. */
  'trend.ceiling': 'Axis max',
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
  'alerts.title': 'Top 10 Active stops',
  'alerts.sub': 'top 10 across reporting bases',
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
