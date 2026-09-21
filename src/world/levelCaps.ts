import { getConstructionSpec, type ConstructionKind } from "./construction";

export type PuebloCiudad = "pueblo" | "ciudad" | "reino";

export const PUEBLO_MAX_LEVEL: Record<string, number> = {
  stone: 2,
  ancient: 3,
  medieval: 4,
  dark_medieval: 4,
  modern: 5,
  contemporary: 5,
};

export const CIUDAD_MAX_LEVEL: Record<string, number> = {
  stone: 0,
  ancient: 0,
  medieval: 3,
  dark_medieval: 4,
  modern: 5,
  contemporary: 6,
};

export function maxLevelOf(tipo: PuebloCiudad, era: string): number {
  if (tipo === "pueblo") return PUEBLO_MAX_LEVEL[era] ?? 2;
  return CIUDAD_MAX_LEVEL[era] ?? 0;
}

/** Tiles por defecto: pueblo 1, ciudad 15, reino 20; +1 por cada nivel extra vía construcción. */
export function tilesFor(tipo: PuebloCiudad, level: number): number {
  const lv = Math.max(1, level);
  const base = tipo === "ciudad" ? 15 : tipo === "reino" ? 20 : 1;
  return base + (lv - 1);
}

/** Costo proporcional N→N+1: base × N vía servicio genérico de construcción. */
export function levelUpCost(
  kind: ConstructionKind,
  level: number,
  era: string,
  isCapital: boolean,
): { cost: Record<string, number>; turns: number } {
  const base = getConstructionSpec(kind, era, isCapital);
  const factor = Math.max(1, level);
  const cost: Record<string, number> = {};
  for (const [k, v] of Object.entries(base.cost)) cost[k] = Math.round((v ?? 0) * factor);
  return { cost, turns: base.turns };
}
