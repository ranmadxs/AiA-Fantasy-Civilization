import type { World } from "./types";

export type EraState = {
  nationId: string;
  currentEra: "stone" | "ancient" | "medieval" | "dark_medieval" | "modern" | "contemporary";
  citiesBuiltInEra: string[];
  eraProgress: number;
  unlockedAt: number;
};

export type EraConfig = {
  name: "stone" | "ancient" | "medieval" | "dark_medieval" | "modern" | "contemporary";
  costs: Record<string, number>;
  unlockCities: number;
  buildTime: number;
  unitFactor: number;
};

export const ERA_CONFIGS: Record<string, EraConfig> = {
  stone: {
    name: "stone",
    costs: { wood: 10, stone: 5 },
    unlockCities: 0,
    buildTime: 1,
    unitFactor: 1.0,
  },
  ancient: {
    name: "ancient",
    costs: { wood: 15, stone: 10, gold: 5 },
    unlockCities: 3,
    buildTime: 1,
    unitFactor: 1.1,
  },
  medieval: {
    name: "medieval",
    costs: { wood: 20, iron: 10, gold: 5 },
    unlockCities: 6,
    buildTime: 2,
    unitFactor: 1.3,
  },
  dark_medieval: {
    name: "dark_medieval",
    costs: { wood: 15, iron: 15, gold: 10 },
    unlockCities: 8,
    buildTime: 2,
    unitFactor: 1.4,
  },
  modern: {
    name: "modern",
    costs: { wood: 30, iron: 25, gold: 15, steel: 10 },
    unlockCities: 12,
    buildTime: 3,
    unitFactor: 1.6,
  },
  contemporary: {
    name: "contemporary",
    costs: { iron: 30, gold: 20, steel: 15, oil: 10 },
    unlockCities: 18,
    buildTime: 5,
    unitFactor: 2.0,
  },
};

export function getNationEra(nationId: string, eraStates: Record<string, EraState>): string {
  const state = eraStates[nationId];
  return state ? state.currentEra : "stone";
}

export function checkEraUnlock(
  nationId: string,
  cityCount: number,
  currentEra: string,
  eraStates: Record<string, EraState>,
  allCitiesBuiltInEra: boolean,
): { unlocked: boolean; newEra?: string } {
  const chain = ["stone", "ancient", "medieval", "dark_medieval", "modern", "contemporary"];
  const currentIndex = chain.indexOf(currentEra);
  if (currentIndex < 0 || currentIndex >= chain.length - 1) {
    return { unlocked: false };
  }
  const nextEra = chain[currentIndex + 1];
  const nextConfig = ERA_CONFIGS[nextEra];
  if (cityCount >= nextConfig.unlockCities) {
    if (nextEra === "dark_medieval" || currentEra === "ancient" || currentEra === "medieval" || allCitiesBuiltInEra) {
      return { unlocked: true, newEra: nextEra };
    }
  }
  return { unlocked: false };
}

export function getBuildCost(era: string, isCapital: boolean): Record<string, number> {
  const config = ERA_CONFIGS[era];
  if (!config) return {};
  const cost = { ...config.costs };
  if (isCapital) {
    for (const key of Object.keys(cost)) {
      cost[key] = Math.round(cost[key] * 0.8);
    }
  }
  return cost;
}

export function getBuildTime(era: string): number {
  return ERA_CONFIGS[era]?.buildTime ?? 1;
}

export function buildInitialEraStates(world: World): Record<string, EraState> {
  return Object.fromEntries(
    world.nations.map((nation) => [
      nation.id,
      {
        nationId: nation.id,
        currentEra: "stone",
        citiesBuiltInEra: [],
        eraProgress: 0,
        unlockedAt: 0,
      } as EraState,
    ]),
  );
}
