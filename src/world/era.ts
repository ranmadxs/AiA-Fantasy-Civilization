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
  unlockCities: number;
  buildTime: number;
  unitFactor: number;
};

export const ERA_CONFIGS: Record<string, EraConfig> = {
  stone: {
    name: "stone",
    unlockCities: 0,
    buildTime: 1,
    unitFactor: 1.0,
  },
  ancient: {
    name: "ancient",
    unlockCities: 3,
    buildTime: 1,
    unitFactor: 1.1,
  },
  medieval: {
    name: "medieval",
    unlockCities: 6,
    buildTime: 2,
    unitFactor: 1.3,
  },
  dark_medieval: {
    name: "dark_medieval",
    unlockCities: 8,
    buildTime: 2,
    unitFactor: 1.4,
  },
  modern: {
    name: "modern",
    unlockCities: 12,
    buildTime: 3,
    unitFactor: 1.6,
  },
  contemporary: {
    name: "contemporary",
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

// ================================================================
// Era como buff: la era ya NO fija costos de construcción.
// Costo real = costo BASE (BASE_CONSTRUCTION_COSTS, editable en panel
// Configuración) × factor de era (ERA_COST_FACTOR). Cambiar de era
// cuesta oro y es decisión (policy `era`), no automático.
// ================================================================

export const ERA_CHAIN = [
  "stone",
  "ancient",
  "medieval",
  "dark_medieval",
  "modern",
  "contemporary",
] as const;

/** Costo en oro por entrar a cada era (la piedra es inicial, sin costo). */
export const ERA_CHANGE_COST_GOLD: Record<string, number> = {
  ancient: 10,
  medieval: 100,
  dark_medieval: 1000,
  modern: 10000,
  contemporary: 100000,
};

/** Multiplicador de costos de construcción por era (+20% por avance). */
export const ERA_COST_FACTOR: Record<string, number> = {
  stone: 1,
  ancient: 1.2,
  medieval: 1.44,
  dark_medieval: 1.728,
  modern: 2.0736,
  contemporary: 2.48832,
};

/** Bonus de producción de edificios (mina/aserradero/hierro) por era. */
export const ERA_PRODUCTION_BONUS: Record<string, number> = {
  stone: 0,
  ancient: 0.01,
  medieval: 0.02,
  dark_medieval: 0.03,
  modern: 0.04,
  contemporary: 0.08,
};

/** Descuento al oro de expansión pacífica por era (apilable con establo). */
export const ERA_EXPLORE_DISCOUNT: Record<string, number> = {
  stone: 1,
  ancient: 0.95,
  medieval: 0.9025,
  dark_medieval: 0.857375,
  modern: 0.81450625,
  contemporary: 0.7737809375,
};

/** Construcciones desbloqueadas al llegar a cada era (acumulativo). */
export const ERA_UNLOCKS: Record<string, string[]> = {
  ancient: ["mina_hierro", "fabrica_armas"],
  medieval: ["ciudad", "reino"],
};

/** Reino solo disponible en medieval y medieval oscuro. */
export function isReinoEra(era: string): boolean {
  return era === "medieval" || era === "dark_medieval";
}

export function eraIndex(era: string): number {
  const index = (ERA_CHAIN as readonly string[]).indexOf(era);
  return index < 0 ? 0 : index;
}

export function nextEra(era: string): string | undefined {
  const next = ERA_CHAIN[eraIndex(era) + 1];
  return next;
}

/** Destino de transición según policy: advance_era sigue la cadena;
 * skip_dark salta la era oscura (medieval → modern), opcional para IA/LLM. */
export function eraTransitionTarget(currentEra: string, policy: string): string | undefined {
  if (policy === "advance_era") return nextEra(currentEra);
  if (policy === "skip_dark" && currentEra === "medieval") return "modern";
  return undefined;
}

export function eraCostFactor(era: string): number {
  return ERA_COST_FACTOR[era] ?? 1;
}

export function eraBirthBonus(era: string): number {
  return Math.pow(1.10, eraIndex(era));
}

export function eraProductionBonus(era: string): number {
  return ERA_PRODUCTION_BONUS[era] ?? 0;
}

export function eraExploreDiscount(era: string): number {
  return ERA_EXPLORE_DISCOUNT[era] ?? 1;
}

/** Emoji por era para la GUI (Detalle de Nación, etc.). */
export const ERA_EMOJI: Record<string, string> = {
  stone: "🗿",
  ancient: "🏺",
  medieval: "🏰",
  dark_medieval: "🌑",
  modern: "🏭",
  contemporary: "🌐",
};

export function formatEraEmoji(era: string): string {
  return ERA_EMOJI[era] ?? "🗿";
}

/** Etiqueta legible de era (en inglés, la localización la traduce). */
export const ERA_LABEL: Record<string, string> = {
  stone: "Stone",
  ancient: "Ancient",
  medieval: "Medieval",
  dark_medieval: "Dark Medieval",
  modern: "Modern",
  contemporary: "Contemporary",
};

export function formatEraLabel(era: string): string {
  return ERA_LABEL[era] ?? era;
}

export function eraChangeCost(targetEra: string): number {
  return ERA_CHANGE_COST_GOLD[targetEra] ?? Number.POSITIVE_INFINITY;
}

/** Kinds construibles en la era dada (base siempre + desbloqueos acumulados). */
export function eraUnlockedKinds(era: string): string[] {
  const index = eraIndex(era);
  const unlocked = new Set<string>(["obra", "barracks", "stable", "mina_carbon", "aserradero", "carreta"]);
  for (let i = 1; i <= index; i += 1) {
    for (const kind of ERA_UNLOCKS[ERA_CHAIN[i]] ?? []) unlocked.add(kind);
  }
  return [...unlocked];
}

export function isKindUnlockedByEra(kind: string, era: string): boolean {
  if (kind === "reino" && !isReinoEra(era)) return false;
  return eraUnlockedKinds(era).includes(kind);
}
