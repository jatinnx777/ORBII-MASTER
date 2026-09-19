import { describe, expect, it } from 'vitest';
import { LINES_PER_BATCH, batchLines, parseCrashLog } from './crash-log';

describe('parseCrashLog', () => {
  it('returns nothing for an empty drain', () => {
    expect(parseCrashLog('')).toEqual([]);
  });

  it('splits lines and trims them', () => {
    expect(parseCrashLog('  a  \nb\n  c')).toEqual(['a', 'b', 'c']);
  });

  it('drops blank lines rather than shipping them', () => {
    expect(parseCrashLog('a\n\n\n   \nb')).toEqual(['a', 'b']);
  });

  it('handles a single line with no newline', () => {
    expect(parseCrashLog('1737000000 crash_accel_armed')).toEqual([
      '1737000000 crash_accel_armed',
    ]);
  });
});

describe('batchLines', () => {
  it('returns nothing for no lines', () => {
    expect(batchLines([])).toEqual([]);
  });

  it('keeps a short log in one batch', () => {
    expect(batchLines(['a', 'b'])).toEqual([['a', 'b']]);
  });

  it('splits at the batch size', () => {
    const lines = Array.from({ length: LINES_PER_BATCH + 1 }, (_, i) => `l${i}`);
    const out = batchLines(lines);
    expect(out).toHaveLength(2);
    expect(out[0]).toHaveLength(LINES_PER_BATCH);
    expect(out[1]).toEqual([`l${LINES_PER_BATCH}`]);
  });

  it('splits evenly when the count is a multiple', () => {
    const lines = Array.from({ length: 4 }, (_, i) => `l${i}`);
    expect(batchLines(lines, 2)).toEqual([
      ['l0', 'l1'],
      ['l2', 'l3'],
    ]);
  });

  it('never loses a line', () => {
    const lines = Array.from({ length: 57 }, (_, i) => `l${i}`);
    expect(batchLines(lines, 10).flat()).toEqual(lines);
  });

  it('survives a nonsense batch size instead of looping forever', () => {
    expect(batchLines(['a', 'b'], 0)).toEqual([['a', 'b']]);
  });
});
