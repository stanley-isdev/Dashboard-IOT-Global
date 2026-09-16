import type { LatestMachineStatusRow, MachineOaRow } from '../influx/queries.ts';
import { influxTimeToIsoUtc } from '../influx/time.ts';

/**
 * Merging rows that arrived as SEVERAL queries back into the answer ONE query
 * would have given.
 *
 * Split out of windowedSnapshot.ts on 2026-09-16, when the live poller became
 * the second caller. Both split a read for the same reason - the file-scan cap
 * counts the files one query touches - and both then owe the reader the
 * undivided answer. Kept in its own module rather than imported across the two
 * services, which would have made a cycle: windowedSnapshot already imports
 * `foldRows` from liveSnapshot.
 */

/**
 * Q-01 across chunks: the newest substantive row per machine.
 *
 * Each chunk's SQL already reduced to one row per machine WITHIN that chunk, so
 * this only has to pick between chunks - and the newest of those is the newest
 * of the whole window, because the chunks tile it without overlap. Concatenating
 * instead would hand `foldRows` several rows per machine and inflate every
 * plant's `machineCount` by the chunk count.
 */
export function mergeLatestStatus(rows: LatestMachineStatusRow[]): LatestMachineStatusRow[] {
  const newest = new Map<string, { row: LatestMachineStatusRow; at: string }>();
  for (const row of rows) {
    if (!row.plant || !row.machine) continue;
    // Keyed on plant AND machine: machine names repeat across plants (`I1`
    // exists at more than one), and a key on the name alone would let one
    // plant's row displace another's.
    const key = `${row.plant}|${row.machine}`;
    // Compared as ISO-UTC strings, which sort lexicographically in time order.
    // A row with no readable timestamp loses to any row that has one.
    const at = influxTimeToIsoUtc(row.last_seen) ?? '';
    const held = newest.get(key);
    if (!held || at > held.at) newest.set(key, { row, at });
  }
  return [...newest.values()].map((v) => v.row);
}

/**
 * Q-03/Q-04 across chunks: re-aggregate each `(plant, machine, PO slots)` group.
 *
 * Every column re-aggregates exactly - MIN of MINs, SUM of SUMs, COUNT of
 * COUNTs, MAX of MAXs - so the group this produces is the row a single query
 * over the whole window would have returned. That equality is the entire
 * justification for chunking; without it this would be a way of blurring the
 * file-scan cap rather than working within it.
 *
 * `plan*` and `cd*` are order attributes repeated onto every shot row and
 * constant within a group (verified against the live instance - see the
 * `MachineOaRow.plan0` note), so MAX picks the one value there is.
 */
export function mergeOaGroups(rows: MachineOaRow[]): MachineOaRow[] {
  const groups = new Map<string, MachineOaRow>();
  for (const row of rows) {
    const key = [row.plant, row.machine, row.po0, row.po1, row.po2, row.po3].join('\0');
    const held = groups.get(key);
    if (!held) {
      groups.set(key, { ...row });
      continue;
    }
    held.min_std_time = least(held.min_std_time, row.min_std_time);
    held.sum_qty = add(held.sum_qty, row.sum_qty);
    held.shot_count = add(held.shot_count, row.shot_count);
    held.weighted_time = add(held.weighted_time, row.weighted_time);
    held.plan0 = greatest(held.plan0, row.plan0);
    held.plan1 = greatest(held.plan1, row.plan1);
    held.plan2 = greatest(held.plan2, row.plan2);
    held.plan3 = greatest(held.plan3, row.plan3);
    held.cd0 = greatestText(held.cd0, row.cd0);
    held.cd1 = greatestText(held.cd1, row.cd1);
    held.cd2 = greatestText(held.cd2, row.cd2);
    held.cd3 = greatestText(held.cd3, row.cd3);
    held.last_row = greatestText(held.last_row, row.last_row);
    // `process` is a tag on the row and identical across a group's chunks;
    // keeping the first non-null covers the case where one chunk's rows predate
    // the tag being set.
    held.process ??= row.process;
  }
  return [...groups.values()];
}

/* Null-tolerant folds. `null` means "this chunk contributed nothing here", not
   zero: treating it as zero would collapse MIN(std_time) to 0 and take every
   %OA on the machine with it. */
const add = (a: number | null, b: number | null) => (a === null ? b : b === null ? a : a + b);
const least = (a: number | null, b: number | null) =>
  a === null ? b : b === null ? a : Math.min(a, b);
const greatest = (a: number | null, b: number | null) =>
  a === null ? b : b === null ? a : Math.max(a, b);
const greatestText = (a: string | null, b: string | null) =>
  a === null ? b : b === null ? a : a >= b ? a : b;
