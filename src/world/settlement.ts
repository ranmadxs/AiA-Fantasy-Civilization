import { at } from "./rngService";
import { calculateNationCityEconomy } from "./cityEconomy";
import {
  addYield,
  getTileYield,
  getDynamicFoodYield,
  getDynamicMetalYield,
  getDynamicOilYield,
  isWaterTile,
  resourceTypes,
  type ResourceTotals,
} from "./economy";
import { densityPerTile, habitableTilesOf } from "./density";
import { ERA_CHAIN, eraBirthBonus } from "./era";
import type { EraState } from "./era";
import type { DiplomacyState } from "./diplomacy";
import { isNationActive } from "./nationStatus";
import type { Resource, World } from "./types";

export type NationStockpile = {
  gold: number;
  water: number;
  resources: ResourceTotals;
};

export type NationStockpiles = Record<string, NationStockpile>;

export type NationMonthlyIncome = {
  gold: number;
  water: number;
  resources: ResourceTotals;
};

export function buildInitialNationStockpiles(world: World): NationStockpiles {
  return Object.fromEntries(
    world.nations.map((nation) => {
      const income = calculateNationMonthlyIncome(world, nation.id);
      const resources = initialResourcesForNation(world, nation.id);
      return [
        nation.id,
        {
          gold: Math.round(income.gold * 3),
          water: Math.round(income.water * 3),
          resources,
        },
      ];
    }),
  );
}

function initialResourcesForNation(world: World, nationId: string): Record<string, number> {
  const cities = world.cities.filter((c) => c.nationId === nationId);
  const grain = cities.reduce((sum, city) => {
    const maxCapacity = habitableTilesOf(city.provinceId, world) * densityPerTile("stone") * 2;
    const startPercent = 0.40 + Math.random() * 0.10;
    const pop = Math.round(maxCapacity * startPercent);
    return sum + pop * 0.01 * 3;
  }, 0);
  const timber = cities.reduce((sum, city) => {
    const tiles = world.tiles.filter((t) => t.provinceId === city.provinceId && !t.reservedBy).length;
    return sum + Math.max(0, tiles * 5);
  }, 0);
  const coal = cities.reduce((sum, city) => {
    const tiles = world.tiles.filter((t) => t.provinceId === city.provinceId && !t.reservedBy).length;
    return sum + Math.max(0, tiles * 10);
  }, 0);
  return { grain: Math.round(grain), timber: Math.round(timber), coal: Math.round(coal), iron: 0, oil: 0 };
}

export function calculateNationMonthlyIncome(world: World, nationId: string, era = "stone"): NationMonthlyIncome {
  const provinceIds = new Set(
    world.provinces
      .filter((province) => province.nationId === nationId)
      .map((province) => province.id),
  );
  const resources = emptyResources();
  let totalWater = 0;

  for (const tile of world.tiles) {
    if (!tile.provinceId || !provinceIds.has(tile.provinceId)) {
      continue;
    }

    const yieldValue = getTileYield(tile);
    if (yieldValue) {
      const provinceCities = world.cities.filter((c) => c.provinceId === tile.provinceId);
      const provincePopulation = provinceCities.reduce((sum, c) => sum + c.population, 0);
      const maxPopulation = tile.provinceId ? habitableTilesOf(tile.provinceId, world) * densityPerTile(era) : 1;
      const overpopRatio = maxPopulation > 0 ? Math.max(0, provincePopulation - maxPopulation) / maxPopulation : 0;
      const multiplier = Math.max(0.10, 1 - overpopRatio);
      addYield(resources, { ...yieldValue, amount: yieldValue.amount * multiplier });
    }

    if (isWaterTile(tile.terrain)) {
      totalWater += 120;
    }
  }

  return {
    gold: calculateNationCityEconomy(nationId, world).monthlyGold,
    water: totalWater,
    resources,
  };
}

export function settleNationStockpiles(
  world: World,
  currentStockpiles: NationStockpiles,
  months: number,
): NationStockpiles {
  return Object.fromEntries(
    world.nations.map((nation) => {
      const current = currentStockpiles[nation.id] ?? {
        gold: 0,
        water: 0,
        resources: emptyResources(),
      };
      if (!isNationActive(world, nation.id)) {
        return [nation.id, { gold: 0, water: 0, resources: emptyResources() }];
      }

      const income = calculateNationMonthlyIncome(world, nation.id);

      return [
        nation.id,
        {
          gold: Math.max(0, current.gold + income.gold * months),
          water: Math.max(0, current.water + income.water * months),
          resources: addResourceTotals(current.resources, income.resources, months),
        },
      ];
    }),
  );
}

/** Aplica natalidad/mortalidad: mortalidad de paz en todas partes;
 * natalidad baja solo en provincias con enemigos dentro (nunca atrición
 * fantasma por guerras sin contacto). Bonus ×1.10^era a la natalidad. */
export function applyPopulationDynamics(
  world: World,
  diplomacy: DiplomacyState,
  currentMonth: number,
  eraStates?: Record<string, EraState>,
  military?: Record<string, { armyGroups: Array<{ locationProvinceId: string; units: Record<string, number> }> }>,
): void {
  for (const nation of world.nations) {
    const era = eraStates?.[nation.id]?.currentEra ?? "stone";
    const bonus = eraBirthBonus(era);
    for (const city of world.cities.filter((city) => city.nationId === nation.id)) {
      const atWarHere = isProvinceAtWar(world, diplomacy, military, city.provinceId, nation.id);
      const deathRate = clampRate(0.10, 0.02, world.seed, `death:${city.id}:${currentMonth}`, currentMonth);
      const baseBirth = atWarHere
        ? 0.002 + at(world.seed, `birth:${city.id}:${currentMonth}`, currentMonth) * 0.018
        : clampRate(0.15, 0.02, world.seed, `birth:${city.id}:${currentMonth}`, currentMonth);
      const birthRate = baseBirth * bonus;
      city.population = Math.max(
        0,
        Math.round(city.population * (1 - deathRate + birthRate)),
      );
    }
  }
}

/** Provincia en guerra = hay grupos enemigos (de nación en guerra declarada) dentro. */
export function isProvinceAtWar(
  world: World,
  diplomacy: DiplomacyState,
  military: Record<string, { armyGroups: Array<{ locationProvinceId: string; units: Record<string, number> }> }> | undefined,
  provinceId: string,
  nationId: string,
): boolean {
  if (!military) return false;
  const enemies = new Set<string>();
  for (const war of diplomacy.wars) {
    if (war.attackerNationId === nationId) enemies.add(war.defenderNationId);
    else if (war.defenderNationId === nationId) enemies.add(war.attackerNationId);
  }
  if (enemies.size === 0) return false;
  for (const enemyId of enemies) {
    const groups = military[enemyId]?.armyGroups ?? [];
    for (const g of groups) {
      if (g.locationProvinceId !== provinceId) continue;
      const total = Object.values(g.units ?? {}).reduce((s, v) => s + (v ?? 0), 0);
      if (total > 0) return true;
    }
  }
  void world;
  return false;
}

function clampRate(base: number, variance: number, seed: string, salt: string, currentMonth: number): number {
  const value = base + (at(seed, salt, currentMonth) - 0.5) * 2 * variance;
  return Math.max(0, value);
}

export type EraVitalityRow = {
  era: string;
  birthPeace: string;
  birthWar: string;
  deathPeace: string;
  deathWar: string;
};

const fmt1 = (n: number): string => {
  const r = Math.round(n * 10) / 10;
  return Number.isInteger(r) ? String(r) : String(r).replace(".", ".");
};

/** Tabla natalidad/mortalidad por era con rangos ±2 (solo lectura, tab Densidad). */
export function getEraVitalityRows(): EraVitalityRow[] {
  return (ERA_CHAIN as readonly string[]).map((era) => {
    const bonus = eraBirthBonus(era);
    return {
      era,
      birthPeace: `${fmt1(13 * bonus)}–${fmt1(17 * bonus)}%`,
      birthWar: `${fmt1(0.2 * bonus)}–${fmt1(2 * bonus)}%`,
      deathPeace: "8–12%",
      deathWar: "8–12%",
    };
  });
}

function addResourceTotals(
  current: ResourceTotals,
  monthlyIncome: ResourceTotals,
  months: number,
) {
  return Object.fromEntries(
    resourceTypes.map((resource) => [
      resource,
      (current[resource] ?? 0) + (monthlyIncome[resource] ?? 0) * months,
    ]),
  ) as ResourceTotals;
}

function emptyResources() {
  return Object.fromEntries(resourceTypes.map((resource) => [resource, 0])) as Record<Resource, number>;
}
