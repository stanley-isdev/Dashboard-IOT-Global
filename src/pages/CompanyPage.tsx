import { Link, useParams } from 'react-router';
import { useCompany } from '../api/queries';
import { useConfig } from '../config/AppContext';
import { deriveConnection, useFreezeDetector, useNow } from '../domain/connectionState';
import { toMeasure } from '../domain/measure';
import { isReporting, siteToken } from '../domain/status';
import { useI18n } from '../i18n/I18nProvider';
import type { TKey } from '../i18n/en';
import { formatInt, formatPct } from '../i18n/format';
import { useFilters, useLinkWithFilters } from '../state/useFilters';
import { AlertList } from '../components/alerts/AlertList';
import { TrendChart } from '../components/charts/TrendChart';
import { ConnectionBanner } from '../components/feedback/ConnectionBanner';
import { HardErrorState } from '../components/feedback/HardErrorState';
import { GrafanaLink } from '../components/common/GrafanaLink';
import { Breadcrumb } from '../components/layout/Breadcrumb';
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
  const [filters] = useFilters();
  const link = useLinkWithFilters();

  const query = useCompany(companyCode, { range: filters.range, process: filters.process });
  const { data, isError, isPending, error, refetch } = query;

  const now = useNow();
  const frozen = useFreezeDetector(data?.meta.generated_at);
  const connection = deriveConnection(
    { envelope: data?.meta, freshness: data?.freshness, isError, isPending, nowMs: now },
    frozen,
  );
  useShellConnection(connection, null);

  if (!data && isError) return <HardErrorState error={error} onRetry={() => void refetch()} />;

  if (!data) {
    return <div className="skeleton" style={{ height: '24rem' }} />;
  }

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
      />

      <Breadcrumb
        trail={[{ label: t('nav.overview'), to: '/overview' }, { label: c.code }]}
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
            {data.plants.length === 0 ? (
              <p style={{ color: 'var(--sub)' }}>
                <StatusGlyph token={token} showLabel />
              </p>
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
              <h2>{t('trend.title')}</h2>
            </div>
            <TrendChart
              points={data.trend}
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
