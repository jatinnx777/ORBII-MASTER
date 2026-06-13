import { useEffect, useState } from 'react';

// The mascot's voice. Messages rotate so the guardian feels alive instead
// of repeating one static line. Ambient states (safe / voice ready) cycle
// on a gentle timer; action states (something missing) stay put so the
// prompt reads clearly.
export type GuardianContext =
  | 'safe'
  | 'voiceReady'
  | 'contactsMissing'
  | 'permissionMissing';

const POOLS: Record<GuardianContext, string[]> = {
  safe: [
    'Everything looks good.',
    "You're protected.",
    'Guardian mode active.',
    "I'm keeping watch.",
    'All systems ready.',
    "You're safe.",
    'Location secured.',
    'No alerts right now.',
    'Ready if you need me.',
    'Your circle is connected.',
  ],
  voiceReady: [
    'Listening for your phrase.',
    'Voice protection active.',
    'Ready to help.',
  ],
  contactsMissing: ["Let's build your safety circle."],
  permissionMissing: ['Location access needed.'],
};

const rotates = (c: GuardianContext) => c === 'safe' || c === 'voiceReady';

export function useGuardianMessage(context: GuardianContext, rotateMs = 8000): string {
  const pool = POOLS[context];
  const [index, setIndex] = useState(() => Math.floor(Math.random() * pool.length));

  // New random starting line whenever the context changes.
  useEffect(() => {
    setIndex(Math.floor(Math.random() * POOLS[context].length));
  }, [context]);

  // Cycle gently while in an ambient state.
  useEffect(() => {
    if (!rotates(context)) return;
    const id = setInterval(() => {
      setIndex((p) => (p + 1) % POOLS[context].length);
    }, rotateMs);
    return () => clearInterval(id);
  }, [context, rotateMs]);

  return pool[index % pool.length];
}
