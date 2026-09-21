import type { City, World } from "./types";
import { ERA_CHAIN } from "./era";

/** Densidad por era (hab/tile). Tabla vigente acordada. */
export const DEFAULT_DENSITY_PER_TILE: Record<string, number> = {
  stone: 100,
  ancient: 1000,
  medieval: 10000,
  dark_medieval: 500,
  modern: 10000,
  contemporary: 100000,
};

export const DENSITY_ERAS: readonly string[] = ERA_CHAIN;

let liveDensity: Record<string, number> = { ...DEFAULT_DENSITY_PER_TILE };

export function getLiveDensity(): Record<string, number> {
  return liveDensity;
}

function isDensityRecord(value: unknown): value is Record<string, number> {
  if (typeof value !== "object" || value === null) return false;
  return Object.values(value).every((v) => typeof v === "number" && Number.isFinite(v) && v >= 0);
}

/** Valida y aplica tabla (retorna false si el formato no sirve). */
export function setLiveDensity(density: unknown): boolean {
  if (typeof density !== "object" || density === null) return false;
  const record = density as Record<string, unknown>;
  const next = { ...DEFAULT_DENSITY_PER_TILE };
  for (const era of ERA_CHAIN as readonly string[]) {
    const entry = record[era];
    if (entry === undefined) continue;
    if (typeof entry !== "number" || !Number.isFinite(entry) || entry < 0) return false;
    next[era] = entry;
  }
  liveDensity = next;
  return true;
}

/** Restaura defaults (tests). */
export function resetLiveDensity(): void {
  liveDensity = { ...DEFAULT_DENSITY_PER_TILE };
}

export function getDensityRows(): { era: string; density: number }[] {
  return (ERA_CHAIN as readonly string[]).map((era) => ({ era, density: liveDensity[era] ?? DEFAULT_DENSITY_PER_TILE[era] ?? 0 }));
}

export function densityPerTile(era: string): number {
  return liveDensity[era] ?? DEFAULT_DENSITY_PER_TILE[era] ?? 100;
}

/** Tiles habitables: con ciudad/pueblo/reino/capital o reservados. Mina de faena no suma como vivienda salvo reserva. */
export function habitableTilesOf(provinceId: string, world: World): number {
  const cities = world.cities.filter((c) => c.provinceId === provinceId);
  const tiles = world.tiles.filter((t) => t.provinceId === provinceId);
  if (tiles.length === 0) return cities.length;
  let count = 0;
  for (const t of tiles) {
    const hasCity = cities.some((c) => c.x === t.x && c.y === t.y);
    if (hasCity || t.reservedBy) count += 1;
  }
  // Al menos 1 por ciudad aunque el tile exacto no calce (migraciones viejas).
  return Math.max(count, Math.min(cities.length, tiles.length));
}

export function maxPopulationOf(city: City, era: string, world: World): number {
  return habitableTilesOf(city.provinceId, world) * densityPerTile(era);
}
