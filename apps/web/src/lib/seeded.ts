// A small seeded random generator. Every member's browser is given the same seed for a roll, so
// every browser draws the same covers in the same places and the same animation.

export function mulberry32(seed: number): () => number {
  let a = seed | 0;

  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;

    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// A number made from text, so a roll's time and party code can become its seed.
export function hashString(text: string): number {
  let hash = 2166136261;

  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
}

export function shuffled<T>(list: readonly T[], random: () => number): T[] {
  const deck = [...list];

  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }

  return deck;
}
