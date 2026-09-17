export type RngDomain = "war" | "market" | "economy" | "spies" | "skin" | "worldgen";

export const DOMAIN_XOR = {
  war: 0x57410000,
  market: 0x4d410000,
  economy: 0x45430000,
  spies: 0x53500000,
  skin: 0x70cc1e,
  worldgen: 0x00000000,
} as const;

export function hashString(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function mulberry32(seed: number): () => number {
  return () => {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function stream(seed: string, domain: RngDomain): () => number {
  const seedHash = hashString(seed);
  const domainSeed = (seedHash ^ DOMAIN_XOR[domain]) >>> 0;
  return mulberry32(domainSeed);
}

export function at(seed: string, salt: string, currentMonth: number): number {
  let hash = 2166136261;
  const value = `${seed}:${salt}:${currentMonth}`;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967295;
}

export function randomAt(x: number, y: number, seed: number): number {
  let h = seed ^ Math.imul(x, 374761393) ^ Math.imul(y, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
