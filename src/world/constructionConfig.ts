/**
 * constructionConfig — costos vivos de construcción/mantención.
 *
 * La simulación lee SIEMPRE por estos getters (nunca las constantes
 * directo), así lo editado en el panel Configuración aplica al juego.
 * Al arrancar se inicializa con los defaults; App lo sincroniza con
 * lo guardado en Mongo al montar y al guardar.
 */
import { BASE_CONSTRUCTION_COSTS, BUILDING_LIST, DEFAULT_MAINTENANCE_COSTS } from "./configDefaults";
import type { ConstructionKind } from "./construction";

function cloneCosts(): Record<ConstructionKind, Record<string, number>> {
  return Object.fromEntries(
    BUILDING_LIST.map((kind) => [kind, { ...(BASE_CONSTRUCTION_COSTS[kind] ?? {}) }]),
  ) as Record<ConstructionKind, Record<string, number>>;
}

let liveBaseCosts: Record<ConstructionKind, Record<string, number>> = cloneCosts();
let liveMaintenance: Record<ConstructionKind, number> = { ...DEFAULT_MAINTENANCE_COSTS };

export function getLiveBaseCosts(): Record<ConstructionKind, Record<string, number>> {
  return liveBaseCosts;
}

export function getLiveMaintenanceCosts(): Record<ConstructionKind, number> {
  return liveMaintenance;
}

function isCostRecord(value: unknown): value is Record<string, number> {
  if (typeof value !== "object" || value === null) return false;
  return Object.values(value).every((v) => typeof v === "number" && Number.isFinite(v) && v >= 0);
}

/** Valida y aplica una tabla base (retorna false si el formato no sirve). */
export function setLiveBaseCosts(costs: unknown): boolean {
  if (typeof costs !== "object" || costs === null) return false;
  const record = costs as Record<string, unknown>;
  const next = cloneCosts();
  for (const kind of BUILDING_LIST) {
    const entry = record[kind];
    if (entry === undefined) continue;
    if (!isCostRecord(entry)) return false;
    next[kind] = { ...entry };
  }
  liveBaseCosts = next;
  return true;
}

/** Valida y aplica mantenciones (retorna false si el formato no sirve). */
export function setLiveMaintenanceCosts(costs: unknown): boolean {
  if (typeof costs !== "object" || costs === null) return false;
  const record = costs as Record<string, unknown>;
  const next = { ...DEFAULT_MAINTENANCE_COSTS };
  for (const kind of BUILDING_LIST) {
    const entry = record[kind];
    if (entry === undefined) continue;
    if (typeof entry !== "number" || !Number.isFinite(entry) || entry < 0) return false;
    next[kind] = entry;
  }
  liveMaintenance = next;
  return true;
}

/** Restaura defaults (tests). */
export function resetLiveConstructionConfig(): void {
  liveBaseCosts = cloneCosts();
  liveMaintenance = { ...DEFAULT_MAINTENANCE_COSTS };
}
