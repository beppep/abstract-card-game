// Seeded random numbers (mulberry32). The cursor lives in GameState so a seed replays exactly.

export function nextRandom(state: { rng: number }): number {
  let t = (state.rng = (state.rng + 0x6d2b79f5) | 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function randomInt(state: { rng: number }, below: number): number {
  return Math.floor(nextRandom(state) * below);
}

export function shuffleInPlace<T>(state: { rng: number }, items: T[]): void {
  for (let i = items.length - 1; i > 0; i--) {
    const j = randomInt(state, i + 1);
    [items[i], items[j]] = [items[j], items[i]];
  }
}
