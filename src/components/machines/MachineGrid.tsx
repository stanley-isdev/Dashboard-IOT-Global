import type { Machine } from '../../api/contract';
import { toMeasure } from '../../domain/measure';
import { bucketToken, machineStatusKey } from '../../domain/status';
import { useI18n } from '../../i18n/I18nProvider';
import type { TKey } from '../../i18n/en';
import { formatInt, formatSeconds } from '../../i18n/format';
import { MeasureValue } from '../primitives/MeasureValue';
import { StatusGlyph } from '../primitives/StatusGlyph';

/**
 * Machine cards, grouped by zone. Replaces the Machine Status V2.0 panel.
 *
 * A machine with no telemetry in the window renders as no-data, never as
 * stopped - the same rule that governs companies and plants, applied at the
 * bottom of the hierarchy where it is easiest to forget.
 *
 * There is no empty branch here any more, and its absence is deliberate. This
 * printed "No telemetry yet" whenever the list was empty, which was wrong
 * whenever the list was empty because Zone or Process had excluded everything -
 * it reported a dead gateway on a plant that was reporting perfectly. Only the
 * page knows which of the two happened, because only the page knows the
 * filters, so PlantPage decides between the two PanelEmpty variants and hands
 * this a non-empty list or does not render it at all.
 *
 * ## Every measurement is in the stylesheet now
 *
 * The zone margins, the zone heading's type, the grid template and the tile
 * itself were inline styles here. They moved to `.zonegroup` / `.machinegrid` /
 * `.machine-card` in components.css because the census now sits inside a deck
 * panel: that makes a tile the third card deep - deck card, panel, tile - and
 * the tile was borrowing `.panel`, whose fill and shadow at that depth read as
 * cards stacked on cards. A tile is not a panel. See the notes on the classes.
 */
export function MachineGrid({ machines }: { machines: Machine[] }) {
  /* No `useI18n` here any more: the only string this level held was the empty
     branch's, and every label below belongs to MachineCard, which has its own. */
  const zones = new Map<string, Machine[]>();
  for (const m of machines) {
    const key = m.zone ?? '-';
    const list = zones.get(key) ?? [];
    list.push(m);
    zones.set(key, list);
  }

  return (
    <>
      {[...zones.entries()].map(([zone, list]) => (
        <section className="zonegroup" key={zone}>
          <h3 className="zonegroup__title">{zone}</h3>
          <div className="machinegrid">
            {list.map((m) => (
              <MachineCard key={m.id} machine={m} />
            ))}
          </div>
        </section>
      ))}
    </>
  );
}

/**
 * The mark on a machine that has an order loaded.
 *
 * A page outline, and deliberately nothing out of StatusIcon's registry. Those
 * twelve shapes are the board's status vocabulary, and KpiMark records what
 * borrowing from them costs: "a reader learns to stop trusting the real ones".
 * This mark says what KIND of number follows - an order, not a quantity - and
 * says nothing about how the machine is doing.
 *
 * Drawn to StatusIcon's conventions (a 16-unit box, no fill, `currentColor`,
 * round joins) so it sits in a line of type like every other glyph here, and
 * inherited in the caption grey rather than KpiMark's brand orange: orange
 * already means the KPI strip's subject marks and the filter row's on-state,
 * and a third meaning is one too many. Quiet is also simply correct - this is a
 * label for a string of digits, not a signal.
 */
function PoMark() {
  return (
    <svg
      className="po-mark"
      viewBox="0 0 16 16"
      width="1em"
      height="1em"
      fill="none"
      stroke="currentColor"
      /* 1.6 against StatusIcon's 1.8: this shape has a corner fold inside it,
         and at the 11px the PO line is set in, the heavier stroke closes the
         gap between the fold and the edge into a blob. */
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M4.4 2.2h5.1l3 3v8.6H4.4Z" />
      <path d="M9.5 2.2v3h3" />
    </svg>
  );
}

function MachineCard({ machine: m }: { machine: Machine }) {
  const { t, lang } = useI18n();
  const token = bucketToken(m.bucket);
  const running = m.bucket === 'running';

  /*
   * How this tile treats the %OA of a machine that is not running.
   *
   * It used to hide it: `running ? 'online' : 'no_data'`, and `toMeasure`
   * returns the no-data arm for that status even when the value beside it is a
   * real number - so a stopped machine that had run earlier in the window, and
   * for which the backend had computed a figure and sent its PO slots, printed
   * "-". THS 6332 machine P1I2 was the case that surfaced it: Stop, order
   * 110000990088 loaded, 129 pcs on the same card, %OA blank.
   *
   * Two things were wrong with that. It threw away a figure that had been
   * computed, and it made the tile disagree with itself - the output line below
   * carries no such guard, so the same card showed one order-derived quantity
   * and hid the other from the same source row. And because the guard was
   * unconditional, the screen could not be used to tell "the machine is
   * stopped" apart from "this machine has no std_time", which is the other
   * reason %OA comes back null (see oaFromPoGroup in server/src/domain/oa.ts).
   *
   * So the figure is shown, marked. The `stale` arm exists for exactly this -
   * "was reporting, has gone quiet, the last known value stays on screen" - and
   * MeasureValue draws it in a cell as the number plus a clock, with the age in
   * the tooltip and in the accessible name.
   *
   * `status_since` and NOT `last_seen` is the timestamp it is qualified with.
   * `last_seen` is the machine's newest telemetry row, and a stopped machine
   * goes on reporting its status every poll - so it reads "as of 0 seconds ago"
   * about a figure that stopped advancing hours back. `status_since` is when
   * the machine entered the state it is in, which is the moment the number
   * froze.
   *
   * With no `status_since` there is nothing honest to qualify it with, so it
   * stays hidden rather than being printed as though it were current: an
   * unmarked figure beside a red Stop pill is the reading this whole change
   * exists to avoid.
   */
  const oaStatus = running ? 'online' : m.status_since ? 'stale' : 'no_data';

  const cycleDelta =
    m.cycle_time_sec !== null && m.std_time_sec !== null && m.std_time_sec > 0
      ? ((m.cycle_time_sec - m.std_time_sec) / m.std_time_sec) * 100
      : null;

  return (
    <article className="machine-card">
      <header className="machine-card__head">
        <strong className="machine-card__id">{m.id}</strong>
        {m.mode ? <span className="badge">{m.mode}</span> : null}
      </header>

      {/* Glyph plus word, always. The status pill never relies on colour alone.
          The tint and the ink stay inline: they are the bucket's own token, read
          per machine, and there is no class that could carry a value that
          changes with the data. */}
      <span
        className="badge machine-card__status"
        style={{ background: token.tintVar, color: token.inkVar }}
      >
        <StatusGlyph token={token} />
        {t(machineStatusKey(m.status) as TKey)}
      </span>

      {/* One line per loaded order, each marked as an order. The block renders
          only when there is one, so the mark is also what makes a tile with an
          order pick itself out of the grid - which is a thing a reader scans
          for, and which a bare 12-digit number did nothing to help. */}
      {m.po_slots.length > 0 ? (
        <div className="machine-card__po">
          {m.po_slots.map((slot) => (
            <div className="machine-card__poline" key={slot.slot}>
              <PoMark />
              <span className="mono">
                {slot.production_order}
                {slot.part_name ? ` · ${slot.part_name}` : ''}
              </span>
            </div>
          ))}
          {/* The IO measurement carries four PO slots; empty ones are collapsed
              rather than rendered as blank rows. This count was stuck at 1 for
              every machine until the group separator was fixed server-side -
              see the note in scopeService.ts. */}
          <div className="machine-card__pocount">
            {`${m.po_slots.length} ${t('common.of')} 4 PO`}
          </div>
        </div>
      ) : null}

      <div className="machine-card__figures">
        <span>
          <span className="kpi__label">{t('table.oa')}</span>
          <div>
            <MeasureValue
              measure={toMeasure(m.oa_pct, oaStatus, { asOf: m.status_since })}
              tier={m.oa_tier}
            />
          </div>
        </span>
        <span>
          <span className="kpi__label">{t('table.output')}</span>
          {/* Unit inside the value. Section 8.5 warns these get swapped, and a
              bare number is exactly how that ships. */}
          <div className="mono">
            {m.actual_qty === null ? '-' : `${formatInt(m.actual_qty, lang)} pcs`}
          </div>
          <div className="mono machine-card__note">
            {m.shot_count === null ? '-' : `${formatInt(m.shot_count, lang)} shots`}
          </div>
        </span>
      </div>

      {m.cycle_time_sec !== null && m.std_time_sec !== null ? (
        <div className="mono machine-card__note" title={t('kpi.oa.tooltip')}>
          {formatSeconds(m.cycle_time_sec, lang)} / std {formatSeconds(m.std_time_sec, lang)}
          {cycleDelta !== null ? ` (${cycleDelta >= 0 ? '+' : ''}${cycleDelta.toFixed(1)}%)` : ''}
        </div>
      ) : null}

      {m.time_injection_sec !== null ? (
        <details className="machine-card__more">
          <summary>{t('methodology.open')}</summary>
          <div className="mono">
            injection {formatSeconds(m.time_injection_sec, lang)}
            {m.time_mold_opening_sec !== null
              ? ` · mold open ${formatSeconds(m.time_mold_opening_sec, lang)}`
              : ''}
            {m.time_mold_end_sec !== null
              ? ` · mold end ${formatSeconds(m.time_mold_end_sec, lang)}`
              : ''}
          </div>
        </details>
      ) : null}
    </article>
  );
}
