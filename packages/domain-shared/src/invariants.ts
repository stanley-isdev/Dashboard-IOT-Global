import type { Counts, GlobalOverview, MachineStatus } from '@dashboard/contract';
import { isReporting } from './statusBucket.ts';

/**
 * Framework-agnostic port of src/domain/invariants.ts.
 *
 * zod proves the payload has the right fields and types. These prove it makes
 * sense: that the machine census adds up, that a site with no telemetry is not
 * quietly contributing to a denominator, and that no alert claims to come from
 * somewhere that sends no data. The design doc's section 16 asks for a one-off
 * reconciliation against Grafana before go-live - the real backend runs this
 * on every response instead, because `Order End` is derived in two separate
 * layers and a partial reimplementation will not look wrong, it will just be
 * wrong.
 */

export interface Violation {
  rule: string;
  where: string;
  detail: string;
}

export function checkPartition(counts: Counts, where: string, out: Violation[]): void {
  const byStatus = (Object.values(counts.by_status) as number[]).reduce((a, b) => a + b, 0);
  if (byStatus !== counts.total) {
    out.push({
      rule: 'machine-census-sums',
      where,
      detail: `sum(by_status)=${byStatus} but total=${counts.total}`,
    });
  }

  const buckets = counts.running + counts.stopped + counts.idle + counts.other + counts.no_data;
  if (buckets !== counts.total) {
    out.push({
      rule: 'buckets-partition-total',
      where,
      detail:
        `running+stopped+idle+other+no_data=${buckets} but total=${counts.total}. ` +
        'A status has been folded into another bucket or dropped.',
    });
  }

  const stop = (counts.by_status as Record<MachineStatus, number>).Stop ?? 0;
  if (counts.stopped !== stop) {
    out.push({
      rule: 'stopped-means-stop',
      where,
      detail:
        `stopped=${counts.stopped} but by_status.Stop=${stop}. ` +
        'No Plan and Order End must not be counted as stopped.',
    });
  }
}

export function checkGlobalOverview(payload: GlobalOverview): Violation[] {
  const out: Violation[] = [];

  checkPartition(payload.totals.counts, 'totals', out);
  for (const c of payload.companies) {
    checkPartition(c.counts, c.code, out);
    for (const p of c.plants) checkPartition(p.counts, `${c.code}/${p.code}`, out);
  }

  // Coverage: totals must be built from the reporting set only. A site with no
  // gateway must never drag the group average toward zero.
  const reporting = payload.companies.filter((c) => isReporting(c.status));
  if (payload.totals.companies_reporting !== reporting.length) {
    out.push({
      rule: 'coverage-matches-reporting-set',
      where: 'totals',
      detail: `companies_reporting=${payload.totals.companies_reporting} but ${reporting.length} companies report`,
    });
  }

  const reportedMachines = reporting.reduce((a, c) => a + c.counts.total, 0);
  if (payload.totals.counts.total !== reportedMachines) {
    out.push({
      rule: 'denominator-excludes-unconnected',
      where: 'totals.counts.total',
      detail: `total=${payload.totals.counts.total} but reporting sites hold ${reportedMachines}`,
    });
  }

  for (const c of payload.companies) {
    if (isReporting(c.status)) continue;
    if (c.counts.total !== 0 || c.kpi.oa_pct !== null) {
      out.push({
        rule: 'unconnected-site-contributes-nothing',
        where: c.code,
        detail: `status=${c.status} but reports ${c.counts.total} machines / oa=${c.kpi.oa_pct}`,
      });
    }
  }

  // Provenance: a site that sends nothing cannot report a fault.
  const reportingCodes = new Set(reporting.map((c) => c.code));
  for (const a of payload.alerts) {
    if (!reportingCodes.has(a.company)) {
      out.push({
        rule: 'alert-provenance',
        where: `alert:${a.id}`,
        detail: `alert attributed to ${a.company}, which is not reporting`,
      });
    }
  }

  return out;
}

/**
 * Unlike the frontend's `assertOrCollect` (which reads `import.meta.env.DEV`,
 * a Vite-only global), the backend caller decides explicitly whether a
 * violation is fatal. Recommended: throw in dev/test, log-and-serve
 * best-effort in production - a dashboard that blanks itself over an
 * arithmetic disagreement is less useful than one that shows the numbers and
 * says it is unsure.
 */
export function assertOrCollect(
  violations: Violation[],
  context: string,
  throwOnViolation: boolean,
): Violation[] {
  if (violations.length === 0) return violations;

  const summary = violations.map((v) => `  [${v.rule}] ${v.where}: ${v.detail}`).join('\n');
  const message = `Data integrity violations in ${context}:\n${summary}`;
  if (throwOnViolation) throw new Error(message);
  return violations;
}
