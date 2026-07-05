// User-selectable app accent. Not a full theme system: a small set of curated
// gradient pairs applied to a few expressive surfaces (readiness meter, status
// pill, settings preview), so the user personalises ORBII without ever
// breaking the warm cream base or the safety-critical reds/greens.
export type AccentId = 'peach' | 'rose' | 'sage' | 'gold';

export type Accent = {
  id: AccentId;
  label: string;
  soft: string; // gradient start / soft fill
  deep: string; // gradient end / text + bar colour
};

// Warm, natural tones only: no neons and no purples, per the brand rules.
export const ACCENTS: Record<AccentId, Accent> = {
  peach: { id: 'peach', label: 'Peach', soft: '#F6CBA5', deep: '#C97B4A' },
  rose: { id: 'rose', label: 'Rose', soft: '#F4C7CE', deep: '#B85C6E' },
  sage: { id: 'sage', label: 'Sage', soft: '#BFE0C4', deep: '#3F7A50' },
  gold: { id: 'gold', label: 'Gold', soft: '#F2D98A', deep: '#B98A2F' },
};

export const ACCENT_LIST: Accent[] = Object.values(ACCENTS);

export function accentOf(id: string | undefined | null): Accent {
  return ACCENTS[(id as AccentId) ?? 'peach'] ?? ACCENTS.peach;
}
