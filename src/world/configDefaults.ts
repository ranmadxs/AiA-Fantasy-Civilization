import type { ConstructionKind } from "./construction";

export { type ConstructionKind } from "./construction";

export const ERA_LIST = [
  "stone",
  "ancient", 
  "medieval",
  "dark_medieval",
  "modern",
  "contemporary",
] as const;

export type EraName = typeof ERA_LIST[number];

export const BUILDING_LIST: ConstructionKind[] = [
  "obra",
  "barracks",
  "stable",
  "mina_carbon",
  "aserradero",
  "mina_hierro",
  "fabrica_armas",
  "ciudad",
  "reino",
  "carreta",
];

// Costos BASE de construcción (sin era): el costo real es base × factor de era.
// Claves crudas (wood/stone/steel se normalizan al cobrar: timber/coal/iron).
export const BASE_CONSTRUCTION_COSTS: Record<ConstructionKind, Record<string, number>> = {
  obra: { wood: 10, stone: 5 },
  barracks: { wood: 12, stone: 6 },
  stable: { wood: 20, stone: 10 },
  mina_carbon: { wood: 50, gold: 20 },
  aserradero: { wood: 40, gold: 15 },
  mina_hierro: { wood: 55, gold: 22 },
  fabrica_armas: { wood: 60, gold: 30, iron: 20 },
  ciudad: { wood: 45, stone: 20, gold: 25 },
  reino: { wood: 120, gold: 80, iron: 40 },
  carreta: { gold: 1, wood: 120, coal: 10 },
};

// Duración fija por edificio (la obra varía por era: ver ERA_CONFIGS.buildTime).
export const FIXED_CONSTRUCTION_TURNS: Record<Exclude<ConstructionKind, "obra">, number> = {
  barracks: 3,
  stable: 4,
  mina_carbon: 2,
  aserradero: 2,
  mina_hierro: 2,
  fabrica_armas: 3,
  ciudad: 3,
  reino: 4,
  carreta: 1,
};

// Defaults de mantenimiento (oro por turno por edificio terminado)
export const DEFAULT_MAINTENANCE_COSTS: Record<ConstructionKind, number> = {
  obra: 0,
  barracks: 10,
  stable: 0.5,
  mina_carbon: 2,
  aserradero: 1,
  mina_hierro: 2,
  fabrica_armas: 10,
  ciudad: 5,
  reino: 15,
  carreta: 0,
};

// Huella en tiles por construcción: pueblo 1, ciudad 15, reino y minas 20.
// A más nivel, los tiles crecen vía construcción (ver tilesFor en levelCaps).
export const BUILDING_TILE_FOOTPRINT: Record<ConstructionKind, number> = {
  obra: 1,
  barracks: 1,
  stable: 1,
  mina_carbon: 20,
  aserradero: 1,
  mina_hierro: 20,
  fabrica_armas: 1,
  ciudad: 15,
  reino: 20,
  carreta: 0,
};

// Nombres amigables
export const BUILDING_LABELS: Record<ConstructionKind, string> = {
  obra: "Obra Civil - Pueblo",
  barracks: "Cuartel",
  stable: "Establo",
  mina_carbon: "Mina de Carbón",
  aserradero: "Aserradero",
  mina_hierro: "Mina de Hierro",
  fabrica_armas: "Fábrica de Armas",
  ciudad: "Obra Civil - Ciudad",
  reino: "Obra Civil - Reino",
  carreta: "Carreta",
};

export const ERA_LABELS: Record<EraName, string> = {
  stone: "Piedra",
  ancient: "Antigua",
  medieval: "Medieval",
  dark_medieval: "Medieval Oscuro",
  modern: "Moderna",
  contemporary: "Contemporánea",
};