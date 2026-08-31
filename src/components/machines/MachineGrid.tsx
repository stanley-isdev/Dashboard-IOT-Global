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
 */
export function MachineGrid({ machines }: { machines: Machine[] }) {
  const { t } = useI18n();

  if (machines.length === 0) {
    return <p style={{ color: 'var(--sub)' }}>{t('site.neverConnected')}</p>;
  }

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
        <section key={zone} style={{ marginBottom: 'var(--sp-5)' }}>
          <h3 style={{ fontSize: 'var(--fs-label)', color: 'var(--sub)', marginBottom: 'var(--sp-2)' }}>
            {zone}
          </h3>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(15rem, 1fr))',
              gap: 'var(--sp-3)',
            }}
          >
            {list.map((m) => (
              <MachineCard key={m.id} machine={m} />
            ))}
          </div>
        </section>
      ))}
    </>
  );
}

function MachineCard({ machine: m }: { machine: Machine }) {
  const { t, lang } = useI18n();
  const token = bucketToken(m.bucket);
  const running = m.bucket === 'running';

  const cycleDelta =
    m.cycle_time_sec !== null && m.std_time_sec !== null && m.std_time_sec > 0
      ? ((m.cycle_time_sec - m.std_time_sec) / m.std_time_sec) * 100
      : null;

  return (
    <article
      className="panel"
      style={{ padding: 'var(--sp-3) var(--sp-4)', display: 'grid', gap: 'var(--sp-2)' }}
    >
      <header style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--sp-2)' }}>
        <strong style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--fs-h2)' }}>
          {m.id}
        </strong>
        {m.mode ? <span className="badge">{m.mode}</span> : null}
      </header>

      {/* Glyph plus word, always. The status pill never relies on colour alone. */}
      <span
        className="badge"
        style={{ background: token.tintVar, color: token.inkVar, alignSelf: 'start' }}
      >
        <StatusGlyph token={token} />
        {t(machineStatusKey(m.status) as TKey)}
      </span>

      {m.po_slots.length > 0 ? (
        <div style={{ fontSize: 'var(--fs-micro)', color: 'var(--sub)' }}>
          {m.po_slots.map((slot) => (
            <div key={slot.slot} className="mono">
              {slot.production_order}
              {slot.part_name ? ` · ${slot.part_name}` : ''}
            </div>
          ))}
          {/* The IO measurement carries four PO slots; empty ones are collapsed
              rather than rendered as blank rows. */}
          <div>{`${m.po_slots.length} ${t('common.of')} 4 PO`}</div>
        </div>
      ) : null}

      <div style={{ display: 'flex', gap: 'var(--sp-4)', flexWrap: 'wrap' }}>
        <span>
          <span className="kpi__label">{t('table.oa')}</span>
          <div>
            <MeasureValue
              measure={toMeasure(m.oa_pct, running ? 'online' : 'no_data')}
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
          <div className="mono" style={{ color: 'var(--sub)', fontSize: 'var(--fs-nano)' }}>
            {m.shot_count === null ? '-' : `${formatInt(m.shot_count, lang)} shots`}
          </div>
        </span>
      </div>

      {m.cycle_time_sec !== null && m.std_time_sec !== null ? (
        <div
          className="mono"
          style={{ fontSize: 'var(--fs-nano)', color: 'var(--sub)' }}
          title={t('kpi.oa.tooltip')}
        >
          {formatSeconds(m.cycle_time_sec, lang)} / std {formatSeconds(m.std_time_sec, lang)}
          {cycleDelta !== null ? ` (${cycleDelta >= 0 ? '+' : ''}${cycleDelta.toFixed(1)}%)` : ''}
        </div>
      ) : null}

      {m.time_injection_sec !== null ? (
        <details style={{ fontSize: 'var(--fs-nano)', color: 'var(--sub)' }}>
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
