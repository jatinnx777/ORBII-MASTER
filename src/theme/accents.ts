// User-selectable app accent. Not a full theme system: a small set of curated
// gradient pairs applied to a few expressive surfaces (readiness meter, status
// pill, settings preview), so the user personalises ORBII without ever
// breaking the warm cream base or the safety-critical reds/greens.
export type AccentId = 'peach' | 'lavender' | 'sage' | 'gold';

export type Accent = {
  id: AccentId;
  label: string;
  soft: string; // gradient start / soft fill
  deep: string; // gradient end / text + bar colour
};

export const ACCENTS: Record<AccentId, Accent> = {
  peach: { id: 'peach', label: 'Peach', soft: '#F6CBA5', deep: '#C97B4A' },
  lavender: { id: 'lavender', label: 'Lavender', soft: '#D9CBF2', deep: '#7C5FB0' },
  sage: { id: 'sage', label: 'Sage', soft: '#BFE0C4', deep: '#3F7A50' },
  gold: { id: 'gold', label: 'Gold', soft: '#F2D98A', deep: '#B98A2F' },
};

export const ACCENT_LIST: Accent[] = Object.values(ACCENTS);

export function accentOf(id: string | undefined | null): Accent {
  return ACCENTS[(id as AccentId) ?? 'peach'] ?? ACCENTS.peach;
}
