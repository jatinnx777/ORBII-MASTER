import { describe, expect, it } from 'vitest';
import {
  MAX_MINUTES,
  MAX_PRESETS,
  MIN_MINUTES,
  addPreset,
  normalisePreset,
  removePreset,
  samePreset,
  sanitisePresets,
  type JourneyPreset,
} from './journey-presets';

const preset = (over: Partial<JourneyPreset> = {}): JourneyPreset => ({
  id: 'p1',
  label: 'Hostel to metro',
  minutes: 30,
  contactId: 'c1',
  ...over,
});

describe('normalisePreset', () => {
  it('trims the label and keeps the given id', () => {
    const p = normalisePreset({ id: 'x', label: '  Library to PG  ', minutes: 20 });
    expect(p).toMatchObject({ id: 'x', label: 'Library to PG', minutes: 20 });
  });

  it('rejects a blank label rather than inventing one', () => {
    expect(normalisePreset({ label: '   ', minutes: 20 })).toBeNull();
  });

  it('clamps a duration that would fire before she has left', () => {
    expect(normalisePreset({ label: 'Walk', minutes: 1 })?.minutes).toBe(MIN_MINUTES);
  });

  it('clamps a duration longer than a journey can be', () => {
    expect(normalisePreset({ label: 'Walk', minutes: 99_999 })?.minutes).toBe(MAX_MINUTES);
  });

  it('defaults a missing contact to null instead of guessing', () => {
    expect(normalisePreset({ label: 'Walk', minutes: 20 })?.contactId).toBeNull();
  });

  it('survives a non-finite duration', () => {
    expect(normalisePreset({ label: 'Walk', minutes: Number.NaN })?.minutes).toBe(MIN_MINUTES);
  });
});

describe('samePreset', () => {
  it('ignores case and surrounding space in the label', () => {
    expect(samePreset(preset(), preset({ id: 'p2', label: '  hostel to METRO ' }))).toBe(true);
  });

  it('treats a different contact as a different trip', () => {
    expect(samePreset(preset(), preset({ id: 'p2', contactId: 'c2' }))).toBe(false);
  });
});

describe('addPreset', () => {
  it('puts the newest first', () => {
    const list = addPreset([preset()], preset({ id: 'p2', label: 'Gym' }));
    expect(list.map((p) => p.id)).toEqual(['p2', 'p1']);
  });

  it('moves a duplicate trip to the front instead of storing it twice', () => {
    const list = addPreset([preset(), preset({ id: 'p2', label: 'Gym' })], preset({ id: 'p3' }));
    expect(list.map((p) => p.label)).toEqual(['Hostel to metro', 'Gym']);
    expect(list).toHaveLength(2);
  });

  it('replaces an edited preset rather than duplicating its id', () => {
    const list = addPreset([preset()], preset({ minutes: 45 }));
    expect(list).toHaveLength(1);
    expect(list[0].minutes).toBe(45);
  });

  it('caps the list, dropping the oldest', () => {
    let list: JourneyPreset[] = [];
    for (let i = 0; i < MAX_PRESETS + 3; i++) {
      list = addPreset(list, preset({ id: `p${i}`, label: `Trip ${i}` }));
    }
    expect(list).toHaveLength(MAX_PRESETS);
    expect(list[0].label).toBe(`Trip ${MAX_PRESETS + 2}`);
  });
});

describe('removePreset', () => {
  it('removes only the named one', () => {
    const list = removePreset([preset(), preset({ id: 'p2', label: 'Gym' })], 'p1');
    expect(list.map((p) => p.id)).toEqual(['p2']);
  });
});

describe('sanitisePresets', () => {
  it('returns nothing for a value that is not a list', () => {
    expect(sanitisePresets(null)).toEqual([]);
    expect(sanitisePresets({ label: 'Walk' })).toEqual([]);
  });

  it('drops rows that are not presets and keeps the ones that are', () => {
    const out = sanitisePresets([
      preset(),
      null,
      'nope',
      { label: 'No minutes' },
      { label: '', minutes: 10 },
      { id: 'p9', label: 'Cab home', minutes: 25, contactId: null },
    ]);
    expect(out.map((p) => p.label)).toEqual(['Hostel to metro', 'Cab home']);
  });

  it('never returns more than the cap, whatever is on disk', () => {
    const many = Array.from({ length: 20 }, (_, i) => preset({ id: `p${i}`, label: `T${i}` }));
    expect(sanitisePresets(many)).toHaveLength(MAX_PRESETS);
  });

  it('clamps a stored duration that is out of range', () => {
    const out = sanitisePresets([{ id: 'p1', label: 'Walk', minutes: 0, contactId: null }]);
    expect(out[0].minutes).toBe(MIN_MINUTES);
  });
});
