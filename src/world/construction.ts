import type { City, Resource, World } from "./types";
import {
  ERA_CHAIN,
  ERA_CHANGE_COST_GOLD,
  ERA_COST_FACTOR,
  ERA_EXPLORE_DISCOUNT,
  ERA_PRODUCTION_BONUS,
  ERA_UNLOCKS,
  eraCostFactor,
  getBuildTime,
  type EraState,
  ERA_CONFIGS,
} from "./era";
import { at } from "./rngService";
import { BUILDING_LABELS, BUILDING_TILE_FOOTPRINT, FIXED_CONSTRUCTION_TURNS } from "./configDefaults";
import { getLiveBaseCosts, getLiveMaintenanceCosts } from "./constructionConfig";

export type ConstructionKind =
  | "obra"
  | "barracks"
  | "stable"
  | "mina_carbon"
  | "aserradero"
  | "mina_hierro"
  | "fabrica_armas"
  | "ciudad"
  | "reino"
  | "carreta";

export type ConstructionProject = {
  id: string;
  cityId?: string;
  nationId: string;
  provinceId: string;
  era: string;
  kind: ConstructionKind;
  cost: Record<string, number>;
  totalTurns: number;
  remainingTurns: number;
  status: "building" | "complete" | "abandoned";
  startedAt: number;
  /** Cantidad (p.ej. carretas N×costo en 1 turno). */
  quantity?: number;
};

/** Costo y duración por tipo: costo BASE × factor de era (capital ×0.8). */
export function getConstructionSpec(
  kind: ConstructionKind,
  era: string,
  isCapital: boolean,
): { cost: Record<string, number>; turns: number } {
  const base = getLiveBaseCosts()[kind] ?? {};
  const factor = eraCostFactor(era) * (isCapital ? 0.8 : 1);
  const scaled: Record<string, number> = {};
  for (const [key, amount] of Object.entries(base)) {
    if (amount) scaled[key] = Math.round((amount ?? 0) * factor);
  }
  // Salida normalizada (wood→timber, stone→coal, steel→iron), como antes.
  const { gold, resources } = normalizeConstructionCost(scaled);
  const cost: Record<string, number> = {};
  if (gold > 0) cost.gold = gold;
  for (const [resource, amount] of Object.entries(resources)) {
    if (amount) cost[resource] = amount ?? 0;
  }
  const turns = kind === "obra" ? getBuildTime(era) : FIXED_CONSTRUCTION_TURNS[kind];
  return { cost, turns };
}

export function createConstructionProject(
  nationId: string,
  provinceId: string,
  era: string,
  isCapital: boolean,
  seed: string,
  currentMonth: number,
  kind: ConstructionKind = "obra",
): ConstructionProject {
  const spec = getConstructionSpec(kind, era, isCapital);
  return {
    id: `${kind}-${nationId}-${provinceId}-${at(seed, `construction:${kind}:${provinceId}`, currentMonth)}`,
    nationId,
    provinceId,
    era,
    kind,
    cost: spec.cost,
    totalTurns: spec.turns,
    remainingTurns: spec.turns,
    status: "building",
    startedAt: currentMonth,
  };
}

export function progressConstruction(
  projects: ConstructionProject[],
  stockpiles: Record<string, { gold: number; resources: Record<string, number> }>,
  currentMonth: number,
): { projects: ConstructionProject[]; completed: ConstructionProject[]; stalled: ConstructionProject[] } {
  const completed: ConstructionProject[] = [];
  const stalled: ConstructionProject[] = [];

  for (const project of projects) {
    if (project.status !== "building") continue;

    // Sin fondos para la cuota del turno: la obra se para (no avanza).
    if (!chargeConstructionTurn(project, stockpiles[project.nationId])) {
      stalled.push(project);
      continue;
    }
    void currentMonth;
    project.remainingTurns -= 1;
    if (project.remainingTurns <= 0) {
      project.status = "complete";
      completed.push(project);
    }
  }

  return { projects, completed, stalled };
}

/**
 * La tabla de eras usa nombres (wood/stone/steel) que no existen en
 * Resource (grain/timber/iron/coal/oil). Se mapean 1:1 para que las obras
 * sean pagables con los valores de la tabla tal cual:
 * wood→timber (lo mismo), stone→coal, steel→iron. El oro va aparte.
 * Claves desconocidas se ignoran (no bloquean la obra).
 */
const RESOURCE_ALIASES: Record<string, string> = {
  wood: "timber",
  stone: "coal",
  steel: "iron",
};

export function normalizeConstructionCost(cost: Record<string, number>): {
  gold: number;
  resources: Partial<Record<Resource, number>>;
} {
  let gold = 0;
  const resources: Partial<Record<Resource, number>> = {};
  for (const [key, amount] of Object.entries(cost)) {
    if (!amount) continue;
    if (key === "gold") {
      gold += amount;
      continue;
    }
    const mapped = RESOURCE_ALIASES[key] ?? key;
    if (mapped === "grain" || mapped === "timber" || mapped === "iron" || mapped === "coal" || mapped === "oil") {
      resources[mapped] = (resources[mapped] ?? 0) + amount;
    }
  }
  return { gold, resources };
}

export type MinaDeCarbon = {
  id: string;
  nationId: string;
  provinceId: string;
  era: string;
  activa: boolean;
  nivel: number; // 1-6 (era actual al construir)
  x?: number;
  y?: number;
  tileCount?: number;
};

export type Aserradero = {
  id: string;
  nationId: string;
  provinceId: string;
  era: string;
  activa: boolean;
  nivel: number;
  x?: number;
  y?: number;
  /** Tiles ocupados (niv.1 = 1, niv.2 = 4 adyacentes). */
  tiles?: number;
  /** Pool de carretas del establo (provincia). */
  carts?: number;
};

export type FabricaArmas = {
  id: string;
  nationId: string;
  provinceId: string;
  era: string;
  activa: boolean;
};

/** Edificios terminados por provincia (para gates y buffs en war.ts/policyAI.ts). */
export type ProvinceBuildings = Record<string, {
  barracks: number;
  stable: boolean;
  minasCarb: number;
  aserraderos: number;
  fabricaArmas: boolean;
}>;

const EMPTY_BUILDINGS = { barracks: 0, stable: false, minasCarb: 0, aserraderos: 0, fabricaArmas: false };

export function indexProvinceBuildings(projects: ConstructionProject[], inactiveIds: Set<string> = new Set()): ProvinceBuildings {
  const index: ProvinceBuildings = {};
  for (const project of projects) {
    if (project.status !== "complete" || inactiveIds.has(project.id)) continue;
    const entry = index[project.provinceId] ?? { ...EMPTY_BUILDINGS };
    if (project.kind === "barracks") entry.barracks += 1;
    if (project.kind === "stable") entry.stable = true;
    if (project.kind === "mina_carbon") entry.minasCarb += 1;
    if (project.kind === "aserradero") entry.aserraderos += 1;
    if (project.kind === "fabrica_armas") entry.fabricaArmas = true;
    index[project.provinceId] = entry;
  }
  return index;
}

/** Provincia → nación dueña de la fábrica activa (para el buff de ataque). */
export function indexFabricas(fabricas: FabricaArmas[]): Record<string, string> {
  const index: Record<string, string> = {};
  for (const fabrica of fabricas) {
    if (fabrica.activa) index[fabrica.provinceId] = fabrica.nationId;
  }
  return index;
}

/** "650 oro + 120 grano + 50 hierro" para descripciones con budget. */
export function formatConstructionBudget(cost: Record<string, number>): string {
  const { gold, resources } = normalizeConstructionCost(cost);
  const parts: string[] = [];
  if (gold > 0) parts.push(`${Math.round(gold)} oro`);
  for (const [resource, amount] of Object.entries(resources)) {
    if (amount) parts.push(`${Math.round(amount)} ${resource}`);
  }
  return parts.length > 0 ? parts.join(" + ") : "sin costo";
}

/** ¿Alcanza para arrancar la obra (costo total)? */
export function canStartConstruction(
  cost: Record<string, number>,
  stockpile: { gold: number; resources: Record<string, number> } | undefined,
): boolean {
  if (!stockpile) return false;
  const { gold, resources } = normalizeConstructionCost(cost);
  if (stockpile.gold < gold) return false;
  for (const [resource, amount] of Object.entries(resources)) {
    if ((stockpile.resources[resource] ?? 0) < (amount ?? 0)) return false;
  }
  return true;
}

/** ¿Alcanza para la primera cuota (costo total / turnos)? Puerta de arranque. */
export function canAffordFirstQuota(
  cost: Record<string, number>,
  totalTurns: number,
  stockpile: { gold: number; resources: Record<string, number> } | undefined,
): boolean {
  if (!stockpile) return false;
  const turns = Math.max(1, totalTurns);
  const { gold, resources } = normalizeConstructionCost(cost);
  if (stockpile.gold < gold / turns) return false;
  for (const [resource, amount] of Object.entries(resources)) {
    if ((stockpile.resources[resource] ?? 0) < (amount ?? 0) / turns) return false;
  }
  return true;
}

/** "faltan 6 timber + 3 coal" para eventos de obra detenida/no iniciada. */
export function missingQuota(
  cost: Record<string, number>,
  totalTurns: number,
  stockpile: { gold: number; resources: Record<string, number> } | undefined,
): string {
  const turns = Math.max(1, totalTurns);
  const { gold, resources } = normalizeConstructionCost(cost);
  const missing: string[] = [];
  const goldShare = gold / turns;
  if ((stockpile?.gold ?? 0) < goldShare && goldShare > 0) {
    missing.push(`faltan ${Math.round(goldShare - (stockpile?.gold ?? 0))} oro`);
  }
  for (const [resource, amount] of Object.entries(resources)) {
    const share = (amount ?? 0) / turns;
    if ((stockpile?.resources[resource] ?? 0) < share && share > 0) {
      missing.push(`faltan ${Math.round(share - (stockpile?.resources[resource] ?? 0))} ${resource}`);
    }
  }
  return missing.length > 0 ? missing.join(" + ") : "sin fondos";
}

/** Cobra la cuota del turno (costo total / turnos del proyecto). False = obra parada. */
function chargeConstructionTurn(
  project: ConstructionProject,
  stockpile: { gold: number; resources: Record<string, number> } | undefined,
): boolean {
  if (!stockpile) return false;
  const totalTurns = Math.max(1, project.totalTurns);
  const { gold, resources } = normalizeConstructionCost(project.cost);
  const goldShare = gold / totalTurns;
  if (stockpile.gold < goldShare) return false;
  for (const [resource, amount] of Object.entries(resources)) {
    if ((stockpile.resources[resource] ?? 0) < (amount ?? 0) / totalTurns) return false;
  }
  stockpile.gold -= goldShare;
  for (const [resource, amount] of Object.entries(resources)) {
    stockpile.resources[resource] = (stockpile.resources[resource] ?? 0) - (amount ?? 0) / totalTurns;
  }
  return true;
}

/** Caravana fundadora: de N colonos, pierden 0-10% en el viaje (mitad muertes, mitad deserción). Determinista por seed. */
export function caravanaOutcome(seed: string, projectId: string, month: number, colonos = 100): { arrival: number; deaths: number; deserters: number } {
  const rate = at(seed, `caravana-loss:${projectId}`, month) * 0.10;
  const loss = Math.min(colonos, Math.round(colonos * rate));
  const deserters = Math.floor(loss / 2);
  const deaths = loss - deserters;
  return { arrival: colonos - loss, deaths, deserters };
}

/** Traslado entre ciudades: base caravana + 2% por tramo (tope total 25%). 0 tramos = caravana. */
export function trasladoOutcome(seed: string, id: string, month: number, colonos: number, hops: number): { arrival: number; deaths: number; deserters: number } {
  const base = caravanaOutcome(seed, id, month, colonos);
  const baseLoss = colonos - base.arrival;
  const extra = Math.min(
    Math.floor(colonos * 0.02 * Math.max(0, hops)),
    Math.max(0, Math.ceil(colonos * 0.25) - baseLoss),
  );
  const extraDeserters = Math.floor(extra / 2);
  const extraDeaths = extra - extraDeserters;
  return { arrival: base.arrival - extra, deaths: base.deaths + extraDeaths, deserters: base.deserters + extraDeserters };
}

/** Fase 1: fundación simple de pueblo (densidad queda para fase 2). */
export function checkNewCity(
  city: City,
  world: World,
  _eraStates: Record<string, EraState>,
): boolean {
  void _eraStates;
  const origin = world.cities.find((c) => c.id === city.id) ?? city;
  if (origin.population < 100) return false;
  return true;
}

/** ¿Tile ocupado por ciudad/mina/aserradero? (pueblo no puede ir ahí). */
export function isTileOccupied(world: World, x: number, y: number): boolean {
  if (world.cities.some((c) => c.x === x && c.y === y)) return true;
  const tile = world.tiles.find((t) => t.x === x && t.y === y);
  if (tile?.reservedBy) return true;
  return false;
}

/** BFS 4-vecinos desde (x,y): hasta n tiles libres de la misma provincia, saltando ocupados. */
export function findAdjacentFreeTiles(
  world: World,
  x: number,
  y: number,
  provinceId: string,
  n: number,
): { x: number; y: number }[] {
  const found: { x: number; y: number }[] = [];
  if (n <= 0) return found;
  const tileByCoord = new Map(world.tiles.map((t) => [`${t.x},${t.y}`, t]));
  const visited = new Set<string>([`${x},${y}`]);
  const queue: { x: number; y: number }[] = [{ x, y }];
  while (queue.length > 0 && found.length < n) {
    const cur = queue.shift()!;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = cur.x + dx;
      const ny = cur.y + dy;
      const key = `${nx},${ny}`;
      if (visited.has(key)) continue;
      visited.add(key);
      const tile = tileByCoord.get(key);
      if (!tile || tile.provinceId !== provinceId) continue;
      // Solo se atraviesan tiles libres: el bloque queda contiguo.
      if (isTileOccupied(world, nx, ny)) continue;
      queue.push({ x: nx, y: ny });
      found.push({ x: nx, y: ny });
      if (found.length >= n) break;
    }
  }
  return found;
}

/** Gate mejora establo a niv.2: establo niv.1 activo + ciudad niv.2 + 3 adyacentes libres. */
export function stableUpgradeEligible(
  world: World,
  nationId: string,
  provinceId: string,
  aserraderos: Aserradero[],
): { stable: Aserradero; city: City; spots: { x: number; y: number }[] } | undefined {
  const stable = aserraderos.find(
    (a) => a.nationId === nationId && a.provinceId === provinceId && a.activa && (a.nivel ?? 1) < 2,
  );
  if (!stable) return undefined;
  const city = world.cities.find((c) => c.nationId === nationId && c.provinceId === provinceId && c.level >= 2);
  if (!city) return undefined;
  const anchor = stable.x !== undefined && stable.y !== undefined ? { x: stable.x, y: stable.y } : { x: city.x, y: city.y };
  const spots = findAdjacentFreeTiles(world, anchor.x, anchor.y, provinceId, 3);
  if (spots.length < 3) return undefined;
  return { stable, city, spots };
}

/** Reino vasallo: edificio aparte, 1 por provincia, puede anexar 2da adyacente. */
export type Reino = {
  id: string;
  nationId: string;
  provinceIds: string[];
  capitalCityId?: string;
  era: string;
  activo: boolean;
  /** Tiles ocupados (base 20, +1 por nivel vía construcción). */
  tiles?: number;
};

// ================================================================
// Tablas de configuración (fuente única para la GUI: Era / Civiles /
// Militares). Los costos son BASE (× factor de era en juego).
// ================================================================

export type EraConfigRow = {
  era: string;
  label: string;
  changeCostGold: number | null;
  costFactor: number;
  productionBonusPct: number;
  exploreDiscountGold: number;
  unlocks: string[];
};

export type BuildingConfigRow = {
  kind: ConstructionKind;
  label: string;
  baseCost: Record<string, number>;
  turns: number | string;
  tiles: number;
  production: string;
  restriction: string;
  maintenanceGold: number;
};

const BUILDING_PRODUCTION: Record<ConstructionKind, string> = {
  obra: "funda pueblo niv.1 (100 colonos)",
  barracks: "14–50 reclutas/ciudad",
  stable: "— (caballería, +25% vel.)",
  mina_carbon: "100 carbón",
  aserradero: "100 madera",
  mina_hierro: "100 hierro",
  fabrica_armas: "— (×1.01 ataque)",
  ciudad: "pueblo→ciudad (+1 niv, +8% pob)",
  reino: "vasallo 👑 +defensa/reclutas",
  carreta: "50 a pie a 90% jinete",
};

const BUILDING_RESTRICTIONS: Record<ConstructionKind, string> = {
  obra: "origen ≥100 hab · tile libre",
  barracks: "sin cuartel no hay soldados",
  stable: "sin establo no hay caballería · niv.2: ciudad niv.2 + 3 tiles adyacentes",
  mina_carbon: "20 tiles",
  aserradero: "—",
  mina_hierro: "era antigua · 20 tiles",
  fabrica_armas: "era antigua · máx 1/provincia",
  ciudad: "era medieval · sobre pueblo",
  reino: "medieval/dark · 10 nación + 2 provincia · 1/provincia",
  carreta: "establo niv.3 · 0 tiles · 1 turno",
};

export function getEraConfigTable(): EraConfigRow[] {
  return (ERA_CHAIN as readonly string[]).map((era) => ({
    era,
    label: era,
    changeCostGold: era === "stone" ? null : (ERA_CHANGE_COST_GOLD[era] ?? null),
    costFactor: ERA_COST_FACTOR[era] ?? 1,
    productionBonusPct: Math.round((ERA_PRODUCTION_BONUS[era] ?? 0) * 100),
    exploreDiscountGold: Math.round((ERA_EXPLORE_DISCOUNT[era] ?? 1) * 100) / 100,
    unlocks: [...(ERA_UNLOCKS[era] ?? [])],
  }));
}

export function getBuildingConfigRows(kinds: ConstructionKind[]): BuildingConfigRow[] {
  const base = getLiveBaseCosts();
  const maintenance = getLiveMaintenanceCosts();
  return kinds.map((kind) => ({
    kind,
    label: BUILDING_LABELS[kind] ?? kind,
    baseCost: { ...(base[kind] ?? {}) },
    turns: kind === "obra" ? "1–5 (por era)" : getConstructionSpec(kind, "stone", false).turns,
    tiles: BUILDING_TILE_FOOTPRINT[kind] ?? 1,
    production: BUILDING_PRODUCTION[kind] ?? "—",
    restriction: BUILDING_RESTRICTIONS[kind] ?? "—",
    maintenanceGold: maintenance[kind] ?? 0,
  }));
}
