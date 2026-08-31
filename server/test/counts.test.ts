import { describe, expect, it } from 'vitest';
import type { MachineStatus } from '@dashboard/contract';
import { BUCKET_OF, checkPartition, type Violation } from '@dashboard/domain-shared';
import { buildPlantCensus } from '../src/domain/counts.ts';
import type { MachineObservation } from '../src/services/liveSnapshot.ts';

/**
 * The board's rule: everything counts except `Order End`
 * (docs/grafana/MACHINE-STATUS-V2.md §4.2, `EXCLUDE_FROM_TOTAL`).
 */
const EXCLUDED = new Set<MachineStatus>(['Order End']);

const obs = (pairs: [string, MachineStatus][]): MachineObservation[] =>
  pairs.map(([machine, status]) => ({
    plant: '6332',
    machine,
    process: 'Injection',
    zone: null,
    status,
    lastSeen: null,
  }));

const census = (pairs: [string, MachineStatus][], machineExclusions: string[] = []) =>
  buildPlantCensus({ observations: obs(pairs), machineExclusions });

function partitionViolations(c: ReturnType<typeof census>): Violation[] {
  const out: Violation[] = [];
  checkPartition(c.counts, 'test', out);
  return out;
}

describe("buildPlantCensus - the board's TOTAL: everything but `Order End`", () => {
  it('still adds up when every machine is running or stopped', () => {
    // The snapshot the old TOTAL = RUNNING + STOP rule was set from. Both rules
    // agree here, which is exactly why that one looked right for two days.
    const c = census([
      ['I1', 'Mass Pro'],
      ['I2', 'Mass Pro'],
      ['I3', 'Dandori'],
      ['I5', 'Stop'],
    ]);

    expect(c.counts.running).toBe(3); // Mass Pro + Dandori
    expect(c.counts.stopped).toBe(1);
    expect(c.counts.total).toBe(c.counts.running + c.counts.stopped);
    expect(c.counts.total).toBe(4);
    expect(partitionViolations(c)).toEqual([]);
  });

  it('counts the third states the board counts, and only drops `Order End`', () => {
    const c = census([
      ['I1', 'Mass Pro'],
      ['I2', 'No Plan'],
      ['I3', 'Order End'],
      ['I5', '4M Change'],
      ['I6', 'Pending'],
    ]);

    // Four of five. The old rule reported 1 here - which is what made THS read
    // 19 against the board's 27 on 2026-08-27.
    expect(c.counts.total).toBe(4);
    expect(c.observed).toBe(5);
    expect(c.notCounted).toBe(1);
    expect(c.counts.not_counted['Order End']).toBe(1);

    // The buckets carry them rather than the headline swallowing them.
    expect(c.counts.running).toBe(1);
    expect(c.counts.idle).toBe(1); // No Plan. `Order End` is idle too, but excluded.
    expect(c.counts.other).toBe(2); // 4M Change + Pending
    expect(partitionViolations(c)).toEqual([]);
  });

  it('excludes `Order End` because layer 1 emits an EXTRA card per finished order', () => {
    // The board's `Order End` cards are additional to the machine's live card,
    // so counting them would count one machine twice. Nothing to do with the
    // machine being uninteresting.
    const c = census([
      ['I1', 'Mass Pro'],
      ['I1-oe', 'Order End'],
    ]);

    expect(c.counts.total).toBe(1);
    expect(c.counts.idle).toBe(0);
    expect(partitionViolations(c)).toEqual([]);
  });

  it('never invents machines from master data - only InfluxDB decides TOTAL', () => {
    // masterData claims THS 6338 has six machines; exactly one reports.
    // The old behaviour turned the gap into five `Offline` rows, inheriting a
    // config error that claims 10 machines at 6332 where 27 actually report.
    const c = census([['I24', 'Dandori']]);

    expect(c.counts.total).toBe(1);
    expect(c.counts.by_status.Offline).toBe(0);
    expect(c.counts.no_data).toBe(0);
    expect(partitionViolations(c)).toEqual([]);
  });

  it('drops excluded machines before counting anything', () => {
    const c = census(
      [
        ['I1', 'Mass Pro'],
        ['IA1', 'Stop'],
        ['IA2', 'Stop'],
      ],
      ['IA1', 'IA2'],
    );

    expect(c.counts.total).toBe(1);
    expect(c.counts.stopped).toBe(0);
    expect(c.observed).toBe(1);
    expect(c.notCounted).toBe(0);
    expect(partitionViolations(c)).toEqual([]);
  });

  it('keeps stopped meaning the Stop status exactly', () => {
    // `Alarm` reads like a stop but is not one until someone decides it is
    // (D-21). It counts toward TOTAL, as it does on the board, but it must not
    // quietly inflate the STOP tile an executive escalates on.
    const c = census([
      ['I1', 'Stop'],
      ['I2', 'Alarm'],
      ['I3', 'Warning'],
    ]);

    expect(c.counts.stopped).toBe(1);
    expect(c.counts.by_status.Stop).toBe(1);
    expect(c.counts.other).toBe(2);
    expect(c.counts.total).toBe(3);
    expect(c.notCounted).toBe(0);
    expect(partitionViolations(c)).toEqual([]);
  });

  it('produces an all-zero census for a plant that reported nothing', () => {
    const c = census([]);
    expect(c.counts.total).toBe(0);
    expect(c.observed).toBe(0);
    expect(partitionViolations(c)).toEqual([]);
  });

  it('keeps every enum value routable to a bucket', () => {
    // If someone adds a status to the contract and forgets BUCKET_OF, this
    // fails here rather than as a partition violation in production.
    for (const status of Object.keys(BUCKET_OF) as MachineStatus[]) {
      const c = census([['M1', status]]);
      expect(partitionViolations(c)).toEqual([]);
      expect(c.counts.total).toBe(EXCLUDED.has(status) ? 0 : 1);
    }
  });
});
