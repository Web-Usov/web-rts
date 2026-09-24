/**
 * Seeded gameplay RNG. Callers must not use Math.random for game rules.
 * Implementation uses Mulberry32 for stable results within one runtime/version.
 */
export interface Rng {
  /** Uniform float in [0, 1). */
  next(): number;
  /** Uniform integer in [minInclusive, maxExclusive). */
  nextInt(minInclusive: number, maxExclusive: number): number;
}

export function createSeededRng(seed: number): Rng {
  let state = seed >>> 0;

  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  return {
    next,
    nextInt(minInclusive: number, maxExclusive: number): number {
      const span = maxExclusive - minInclusive;
      if (span <= 0) {
        throw new RangeError("nextInt requires maxExclusive > minInclusive");
      }
      return minInclusive + Math.floor(next() * span);
    },
  };
}
