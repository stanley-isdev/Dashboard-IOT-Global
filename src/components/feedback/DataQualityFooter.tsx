import { useState } from 'react';
import type { GlobalOverview } from '../../api/contract';
import type { Violation } from '../../domain/invariants';
import { useI18n } from '../../i18n/I18nProvider';
import type { TKey } from '../../i18n/en';
import { formatDateTime } from '../../i18n/format';
import { useConfig } from '../../config/AppContext';
import { CloseMark } from '../primitives/CloseMark';
import { StatusIcon } from '../primitives/StatusIcon';

/**
 * The one place an executive can point at and ask "what am I actually looking
 * at" - plus the running integrity check.
 *
 * The methodology panel exists because of D-19 and D-20: %OA excludes downtime
 * and the group figure is weighted, and both facts have to be discoverable
 * without asking the IS department. The design doc's section 16 asks for a
 * one-off reconciliation against Grafana before go-live; the warning counter
 * here turns that into something that runs on every poll instead.
 */
export function DataQualityFooter({
  payload,
  violations,
}: {
  payload: GlobalOverview;
  violations: Violation[];
}) {
  const { t, lang } = useI18n();
  const cfg = useConfig();
  const [open, setOpen] = useState(false);

  return (
    /*
     * A cluster, not a footer band. The artboard runs its panels down to the
     * bottom rail with no strip underneath, so this sits in the map panel head
     * instead - where the artboard leaves the right-hand side empty.
     *
     * What used to be printed inline here (snapshot time, data source) is inside
     * the dialog now. It has to be *reachable*, not permanently on screen; the
     * integrity warning is the one thing that still surfaces on the board
     * itself, because a silent counter nobody opens is not a check.
     */
    <div className="quality-footer">
      {violations.length > 0 ? (
        <span className="quality-footer__warn">
          <span className="glyph" aria-hidden="true">
            ▲
          </span>
          {t('quality.warnings', { count: violations.length })}
        </span>
      ) : null}

      <button
        type="button"
        className="quality-footer__info tap"
        onClick={() => setOpen((v) => !v)}
        title={t('methodology.open')}
      >
        {/* Drawn, not typed - see the note in StatusIcon.tsx. `ⓘ` renders from
            whichever fallback font owns U+24D8 and blurs at this size, and this
            button sits a few centimetres from the KPI strip's own ⓘ, so the two
            have to be the same mark. */}
        <StatusIcon name="info-circle" />
        <span className="visually-hidden">{t('methodology.open')}</span>
      </button>

      {/*
       * An overlay, not an inline block. Inline, opening this pushed the board
       * off the bottom of a page that is deliberately exactly one viewport tall.
       * Click-outside and Escape both close it; the card scrolls internally so a
       * long violation list cannot grow the frame either.
       */}
      {open ? (
        <div
          className="methodology"
          role="dialog"
          aria-modal="true"
          aria-label={t('methodology.title')}
          onClick={() => setOpen(false)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setOpen(false);
          }}
        >
          <div className="methodology__card" onClick={(e) => e.stopPropagation()}>
            <div className="panel-head">
              <h2>{t('methodology.title')}</h2>
              {/* The same mark the base drawer uses - one component and one CSS
                  rule, so the two modal surfaces cannot drift apart - and not a
                  worded chip: it is the only control in this head, and the mark
                  already means "dismiss" everywhere else on the board. The word
                  stays as the accessible name. */}
              <button
                type="button"
                className="methodology__close tap"
                onClick={() => setOpen(false)}
                title={t('methodology.close')}
                autoFocus
              >
                <CloseMark />
                <span className="visually-hidden">{t('methodology.close')}</span>
              </button>
            </div>
            <dl style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '0.5rem 1rem' }}>
              <dt>{t('methodology.target')}</dt>
              <dd className="mono">{payload.target_oa}%</dd>

              <dt>{t('methodology.tierPolicy')}</dt>
              <dd className="mono">
                {payload.tier_policy.id} · {t('tier.good')} ≥ {payload.tier_policy.good_at} ·{' '}
                {t('tier.warn')} ≥ {payload.tier_policy.warn_at}
              </dd>

              <dt>{t('methodology.aggregation')}</dt>
              <dd>{t(`aggregation.${payload.oa_aggregation}` as TKey)}</dd>

              <dt>{t('kpi.oa')}</dt>
              <dd>{t('kpi.oa.tooltip')}</dd>

              <dt>{t('methodology.freshness')}</dt>
              <dd className="mono">
                stale &gt; {payload.freshness.stale_after_sec}s · no data &gt;{' '}
                {payload.freshness.no_data_after_sec}s
              </dd>

              {/* Moved in from the old footer band, which the artboard does not
                  have. Both answer "what am I actually looking at", which is
                  what this dialog is for. */}
              <dt>{t('methodology.generatedAt')}</dt>
              <dd className="mono">
                {formatDateTime(payload.meta.generated_at, cfg.referenceTimezone, lang)}
              </dd>

              {/* The API this board is reading, which is the whole of "where did
                  this come from" now that there is one adapter. It used to
                  print `dataSource` - `mock` or `http` - and that mattered
                  only while a build could quietly be serving generated data. */}
              <dt>{t('methodology.source')}</dt>
              <dd className="mono">{cfg.apiBaseUrl}</dd>
            </dl>

            {violations.length > 0 ? (
              <>
                <h3 style={{ marginTop: 'var(--sp-4)', fontSize: 'var(--fs-h2)' }}>
                  {t('quality.title')}
                </h3>
                <ul className="mono" style={{ fontSize: 'var(--fs-nano)', paddingLeft: '1rem' }}>
                  {violations.map((v, i) => (
                    <li key={i}>
                      [{v.rule}] {v.where}: {v.detail}
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
