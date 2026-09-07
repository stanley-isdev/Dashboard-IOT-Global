import { describe, expect, it } from 'vitest';
import { exportName } from './exportDoc';

/**
 * The filename, which is the only part of a printed board that a folder full of
 * other printed boards can tell apart.
 */
describe('exportName', () => {
  it('joins the parts and stamps the payload time in UTC', () => {
    expect(exportName(['fleet', '24h'], '2026-09-02T10:42:17.000Z')).toBe(
      'fleet_24h_2026-09-02-1042Z',
    );
  });

  it('drops nulls and empty parts rather than leaving double separators', () => {
    expect(exportName(['fleet', null, '', '8h'], '2026-09-02T10:42:17.000Z')).toBe(
      'fleet_8h_2026-09-02-1042Z',
    );
  });

  it('replaces anything a filesystem or a shell would argue with', () => {
    /* A multi-select region arrives as `TH,JP`, and a comma in a filename is a
       field separator to half the tools that touch it. */
    expect(exportName(['fleet', 'TH,JP'], '2026-09-02T10:42:17.000Z')).toBe(
      'fleet_TH-JP_2026-09-02-1042Z',
    );
  });

  it('leaves the stamp alone when generated_at is not the shape it expects', () => {
    /* Defensive rather than aspirational: the contract pins `generated_at` to
       ISO UTC, so this is what a payload from a server that has drifted off it
       does - a strange name, not a crash or a silently missing timestamp. */
    expect(exportName(['fleet'], 'not-a-time')).toBe('fleet_not-a-time');
  });
});
