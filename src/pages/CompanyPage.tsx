import { useMemo } from 'react';
import { Link, useParams } from 'react-router';
import { useCompany, useRetryState } from '../api/queries';
import { useConfig } from '../config/AppContext';
import {
  deriveConnection,
  useFreezeDetector,
  useNow,
  useRecovery,
} from '../domain/connectionState';
import { toMeasure } from '../domain/measure';
import { isReporting, siteToken } from '../domain/status';
import { useI18n } from '../i18n/I18nProvider';
import type { TKey } from '../i18n/en';
import { formatInt, formatPct } from '../i18n/format';
import { useFilters, useLinkWithFilters } from '../state/useFilters';
import { usePublishExport } from '../state/exportStore';
import { companyExportDoc } from '../domain/exportDoc';
import { useTrendWindow } from '../domain/trendWindow';
import { AlertList } from '../components/alerts/AlertList';
import { TrendChart } from '../components/charts/TrendChart';
import { ConnectionBanner } from '../components/feedback/ConnectionBanner';
import { HardErrorState, LoadingState } from '../components/feedback/HardErrorState';
import { PanelEmpty } from '../components/feedback/PanelEmpty';
import { GrafanaLink } from '../components/common/GrafanaLink';
import { useShellConnection } from '../components/layout/AppShell';
import { KpiCard } from '../components/kpi/KpiCard';
import { ShiftBreakdownTable } from '../components/machines/ShiftBreakdownTable';
import { Flag } from '../components/primitives/Flag';
import { ShiftChip } from '../components/primitives/ShiftChip';
import { StatusGlyph } from '../components/primitives/StatusGlyph';

export function CompanyPage() {
  const { companyCode = '' } = useParams();
  const { t, lang } = useI18n();
  const cfg = useConfig();
  const [filters, setFilters] = useFilters();
  const link = useLinkWithFilters();

  const query = useCompany(companyCode, { range: filters.range, process: filters.process });
  const { data, isError, isPending, error, refetch } = query;

  const now = useNow();
  const frozen = useFreezeDetector(data?.meta.generated_at);
  const connection = deriveConnection(
    { envelope: data?.meta, freshness: data?.freshness, isError, isPending, error, nowMs: now },
    frozen,
  );
  useShellConnection(connection);

  /* What the board is doing about a failure, for the error page to say out loud.
     Read unconditionally because it is a hook; only the error branch uses it. */
  const retry = useRetryState(query);

  /* The outage that just ended, if one did. Reports the gap it left in the
     trend; takes itself off after eight seconds. */
  const recovery = useRecovery(connection.state, now);

  /* The Export button in the filter row photographs whichever board is on screen -
     here, this base with the lamps and zones under it - and this names the file
     it writes. Memoised on the payload for the reason the store gives: the
     value is what the publish effect keys on. */
  const exportDoc = useMemo(() => (data ? companyExportDoc(data) : null), [data]);
  usePublishExport(exportDoc);

  /* Same window and the same caption as the global board's trend, from the same
     hook: this panel used to be titled "Trend" with no span at all, which left
     the time picker in the bar above it governing the figures beside it and
     apparently nothing here. See src/domain/trendWindow.ts. */
  const {
    points: trend,
    rangeLabel: trendRange,
    span: trendSpan,
  } = useTrendWindow(
    data?.trend,
    filters.range,
    // The served window wins over the quick range when the calendar set one.
    filters.from && filters.to ? { from: filters.from, to: filters.to } : null,
  );

  if (!data && isError) {
    return (
      <HardErrorState
        error={error}
        onRetry={() => void refetch()}
        retry={retry}
        siteCode={companyCode}
      />
    );
  }

  /* The company code, not its name: the name is in the payload this is waiting
     for, and the code is what the reader tapped to get here. */
  if (!data) return <LoadingState name={companyCode} />;

  const c = data.company;
  const reporting = isReporting(c.status);
  const token = siteToken(c.status);
  const coverage = { reporting: reporting ? 1 : 0, total: 1 };
  const int = (v: number) => formatInt(v, lang);

  return (
    <>
      <ConnectionBanner
        info={connection}
        referenceTimezone={cfg.referenceTimezone}
        onRetry={() => void refetch()}
        recovery={recovery}
      />

      {/* Drill-downs are taller than one screen by nature, so this region scrolls
          inside the locked frame rather than the page growing. */}
      <div
        className={`view view--scroll${connection.degraded ? ' is-stale' : ''}`}
        aria-busy={isPending}
      >
        <header className="panel" style={{ marginBottom: 'var(--sp-4)' }}>
          <div className="panel-head" style={{ marginBottom: 0 }}>
            <h2 style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-3)' }}>
              <Flag code={c.country_code} countryName={c.country_code} size="1.4em" />
              {c.code}
              <span className="rank-table__sub">{lang === 'th' ? (c.name_th ?? c.name) : c.name}</span>
            </h2>
            <div style={{ display: 'flex', gap: 'var(--sp-2)', alignItems: 'center', flexWrap: 'wrap' }}>
              <span className="chip" style={{ color: token.inkVar }}>
                <StatusGlyph token={token} showLabel />
              </span>
              <ShiftChip
                shift={c.shift}
                timezone={c.timezone}
                nowMs={now}
                variant="header"
              />
              <GrafanaLink url={c.grafana_url} />
            </div>
          </div>
        </header>

        <div className="kpis" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
          <KpiCard
            labelKey="kpi.machines"
            measure={toMeasure(c.counts.total, c.status)}
            format={int}
            coverage={coverage}
          />
          <KpiCard
            labelKey="kpi.running"
            measure={toMeasure(c.counts.running, c.status)}
            format={int}
            tier="good"
            coverage={coverage}
            definitionKey="kpi.running.definition"
          />
          <KpiCard
            labelKey="kpi.oa"
            measure={toMeasure(c.kpi.oa_pct, c.status, { asOf: c.last_seen })}
            tier={c.kpi.oa_tier}
            coverage={coverage}
            definitionKey="kpi.oa.definition"
          />
          <KpiCard
            labelKey="kpi.achievement"
            measure={toMeasure(c.kpi.achievement_pct, c.status, {
              asOf: c.last_seen,
              naReasonKey: 'measure.noPlan',
            })}
            coverage={coverage}
            foot={
              <>
                {t('kpi.achievement.actual', {
                  qty: c.kpi.actual_qty === null ? '-' : int(c.kpi.actual_qty),
                })}
                {' / '}
                {/* The unit was missing here, so this card printed the
                    placeholder "{unit}" verbatim. Section 8.5: Shot and Pcs get
                    swapped in the source data, so it is always read from the
                    payload rather than assumed. */}
                {t('kpi.achievement.plan', {
                  qty: c.kpi.plan_qty === null ? '-' : int(c.kpi.plan_qty),
                  unit: t(`unit.${data.qty_unit}` as TKey),
                })}
              </>
            }
          />
        </div>

        <div className="main-grid">
          <section className="panel">
            <div className="panel-head">
              <h2>{t('table.plant')}</h2>
            </div>
            {/*
             * Two causes, two answers - and until now one sentence for both.
             *
             * A base with nothing in scope means either that Process excluded
             * every machine it runs, or that the base itself has none
             * reporting. The first is something the reader did and can undo;
             * the second is a fact about the site. Printing the site's status
             * mark for both told an engineer to go and look at a gateway
             * because somebody had left a process picked.
             *
             * The test is the CENSUS, not `plants.length`, and that distinction
             * is load-bearing: `plants` comes off master data, so THS lists its
             * four lamps whatever the filters say and an empty array is
             * unreachable. Measured against the real endpoint on 2026-09-07,
             * `?process=Assembly` returns all four plants with `counts.total`
             * of 0 - which is the state a reader is actually in, and the one
             * the old condition could never have caught.
             *
             * Process and nothing else, checked against ScopeQuery in
             * DashboardApi.ts rather than assumed: this route is sent `range`
             * and `process` only. The Lamp filter is in the row above and reads
             * as though it ought to be the cause here, but it is never sent to
             * this endpoint, so offering to clear it would be a dead end.
             */}
            {c.counts.total === 0 && filters.process !== 'all' ? (
              <PanelEmpty
                message={t('empty.panel.plants', { process: filters.process })}
                action={{
                  label: t('empty.panel.clearProcess'),
                  onClick: () => setFilters({ process: 'all' }),
                }}
              />
            ) : c.counts.total === 0 ? (
              <PanelEmpty
                /* Not the funnel: nothing was filtered out. The cylinder says
                   the store was read and holds nothing for this base, which is
                   what "no telemetry yet" means. */
                glyph="database"
                message={t('site.neverConnected')}
              />
            ) : (
              <table className="rank-table">
                <thead>
                  <tr>
                    <th scope="col">{t('table.plant')}</th>
                    <th scope="col">{t('table.runStop')}</th>
                    <th scope="col">{t('table.oa')}</th>
                    <th scope="col">{t('table.achv')}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.plants.map((p) => (
                    <tr key={p.code}>
                      <td>
                        <Link to={link(`/company/${c.code}/plant/${p.code}`)}>
                          <span className="rank-table__name">
                            <span>{p.code}</span>
                            <span className="rank-table__sub">{p.label}</span>
                          </span>
                        </Link>
                      </td>
                      <td className="mono">
                        {int(p.counts.running)} / {int(p.counts.stopped)}
                      </td>
                      <td className="mono">
                        {p.kpi.oa_pct === null ? '-' : formatPct(p.kpi.oa_pct, lang)}
                      </td>
                      <td className="mono">
                        {p.kpi.achievement_pct === null
                          ? t('measure.noPlan')
                          : formatPct(p.kpi.achievement_pct, lang)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <section className="panel">
            <div className="panel-head">
              <h2>{t('filter.range')}</h2>
              <span className="sub">
                {data.shift_config
                  ? `${data.shift_config.shifts.length} ${t('common.of')} ${data.shift_config.shifts.length}`
                  : t('shift.notConfigured')}
              </span>
            </div>
            <ShiftBreakdownTable rows={data.shift_breakdown} timezone={c.timezone} />
          </section>
        </div>

        <div className="bottom-grid">
          <section className="panel">
            <div className="panel-head">
              <h2>{`${t('trend.title')} · ${trendRange}`}</h2>
              <span className="sub">{t('trend.subSite', { span: trendSpan })}</span>
            </div>
            <TrendChart
              points={trend}
              target={data.target_oa}
              warnAt={data.tier_policy.warn_at}
              referenceTimezone={cfg.referenceTimezone}
            />
          </section>
          <section className="panel">
            <div className="panel-head">
              <h2>{t('alerts.title')}</h2>
            </div>
            <AlertList alerts={data.alerts} />
          </section>
        </div>
      </div>
    </>
  );
}
