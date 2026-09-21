/**
 * mongoSync — puente entre el juego (navegador) y MongoDB (vía plugin Vite).
 *
 * Todo es best-effort: si Mongo no responde, el juego sigue igual.
 * Ninguna función lanza excepciones hacia el caller.
 */
import type { GameEvent } from "./events";
import {
  COMBAT_EVENT_KINDS,
  DIPLOMACY_EVENT_KINDS,
  EXPANSION_EVENT_KINDS,
  INGENIERIA_EVENT_KINDS,
  LOGISTICS_EVENT_KINDS,
  SPY_EVENT_KINDS,
} from "./eventCategories";
import type { NationModelConfigs } from "./modelConfig";
import { calculateNationMonthlyIncome } from "./settlement";
import { isNationActive } from "./nationStatus";
import type { World } from "./types";
import type { SimulationState } from "./turnSimulation";
import type {
  EventDocument,
  NationDocument,
  NationMonthlyDocument,
  WorldMonthlyDocument,
} from "../server/mongo/models";

export type MongoRunCtx = { seed: string; runNumber: number };

/** Año simulado: 12 meses = 1 año (mes 0 → año 1, mes 1). */
export function simYearOf(simMonth: number): number {
  return Math.floor(simMonth / 12) + 1;
}

/** Mes dentro del año simulado (1-12). */
export function simMonthOfYear(simMonth: number): number {
  return (simMonth % 12) + 1;
}

function includes(haystack: readonly string[], needle: string): boolean {
  return (haystack as readonly string[]).includes(needle);
}

/** Tab/subtab de la GUI que corresponde a cada kind (para filtrar en Mongo). */
export function tabForKind(kind: GameEvent["kind"]): { topTab: EventDocument["topTab"]; subTab: string } {
  if (includes(COMBAT_EVENT_KINDS, kind)) return { topTab: "guerra", subTab: "combate" };
  if (includes(LOGISTICS_EVENT_KINDS, kind)) return { topTab: "guerra", subTab: "logistica" };
  if (includes(DIPLOMACY_EVENT_KINDS, kind)) return { topTab: "general", subTab: "diplomacia" };
  if (includes(SPY_EVENT_KINDS, kind)) return { topTab: "general", subTab: "espionaje" };
  if (includes(EXPANSION_EVENT_KINDS, kind)) return { topTab: "general", subTab: "expansiones" };
  if (includes(INGENIERIA_EVENT_KINDS, kind)) return { topTab: "general", subTab: "ingenieria" };
  if (kind === "market") return { topTab: "mercado", subTab: "transacciones" };
  return { topTab: "general", subTab: "todo" };
}

function nowIso(): string {
  return new Date().toISOString();
}

/** Eventos de un turno → documentos (sin runId: lo estampa el servidor). */
export function buildEventDocs(
  events: GameEvent[],
  seed: string,
): Array<Omit<EventDocument, "runId" | "_id">> {
  return events.map((event) => {
    const tab = tabForKind(event.kind);
    return {
      seed,
      source: event.source ?? "init",
      eventId: event.id,
      simMonth: event.month,
      simYear: simYearOf(event.month),
      simMonthOfYear: simMonthOfYear(event.month),
      kind: event.kind,
      topTab: tab.topTab,
      subTab: tab.subTab,
      title: event.title,
      description: event.description,
      nationIds: [...event.nationIds],
      ...(event.lang ? { lang: event.lang } : {}),
      createdAt: nowIso(),
    };
  });
}

/** Naciones del mundo + su config LLM → documentos. */
export function buildNationDocs(
  world: World,
  configs: NationModelConfigs,
  seed: string,
): Array<Omit<NationDocument, "runId" | "_id">> {
  return world.nations.map((nation) => {
    const config = configs[nation.id];
    return {
      seed,
      nationId: nation.id,
      name: nation.name,
      nameEs: nation.nameEs,
      nameEn: nation.nameEn,
      nameZh: nation.nameZh,
      color: nation.color,
      governmentFormId: nation.governmentFormId,
      capitalProvinceId: nation.capitalProvinceId,
      capitalCityId: nation.capitalCityId,
      llm: {
        provider: config?.providerName ?? "",
        model: config?.model ?? "",
        endpoint: config?.endpoint ?? "",
        enabled: config?.enabled ?? false,
        personalityPrompt: config?.personalityPrompt ?? "",
      },
      createdAt: nowIso(),
    };
  });
}

/** Oro + territorio por nación y mes. */
export function buildNationMonthlyDocs(
  world: World,
  simulation: SimulationState,
  seed: string,
  simMonth: number,
): Array<Omit<NationMonthlyDocument, "runId" | "_id">> {
  return world.nations.map((nation) => {
    const stockpile = simulation.nationStockpiles[nation.id];
    const income = calculateNationMonthlyIncome(world, nation.id);
    const provinces = world.provinces.filter((p) => p.nationId === nation.id);
    const provinceIds = new Set(provinces.map((p) => p.id));
    const tileCount = world.tiles.filter((t) => t.provinceId !== undefined && provinceIds.has(t.provinceId)).length;
    const cities = world.cities.filter((c) => c.nationId === nation.id);
    const population = cities.reduce((sum, c) => sum + c.population, 0);
    const era = simulation.eraState[nation.id]?.currentEra ?? "Unknown";
    return {
      seed,
      nationId: nation.id,
      simYear: simYearOf(simMonth),
      simMonthOfYear: simMonthOfYear(simMonth),
      simMonth,
      gold: stockpile?.gold ?? 0,
      water: stockpile?.water ?? 0,
      resources: { ...(stockpile?.resources ?? {}) } as Record<string, number>,
      monthlyIncome: { gold: income.gold, water: income.water },
      provinces: [...provinceIds],
      provinceCount: provinces.length,
      tileCount,
      capitalProvinceId: nation.capitalProvinceId,
      capitalCityId: nation.capitalCityId,
      cities: cities.map((c) => ({
        id: c.id,
        name: c.name,
        provinceId: c.provinceId,
        level: c.level,
        population: c.population,
        isCapital: c.isCapital,
      })),
      population,
      era: String(era),
      isActive: isNationActive(world, nation.id),
      createdAt: nowIso(),
    };
  });
}

/** Rollup del mundo para el mes (1 doc por mes). */
export function buildWorldMonthlyDoc(
  world: World,
  nationMonthly: Array<Omit<NationMonthlyDocument, "runId" | "_id">>,
  seed: string,
  simMonth: number,
): Omit<WorldMonthlyDocument, "runId" | "_id"> {
  const byNation = nationMonthly.map((n) => ({
    nationId: n.nationId,
    gold: n.gold,
    tiles: n.tileCount,
    provinces: n.provinceCount,
    cities: n.cities.length,
    population: n.population,
  }));
  const totals = {
    gold: byNation.reduce((s, n) => s + n.gold, 0),
    tilesClaimed: byNation.reduce((s, n) => s + n.tiles, 0),
    provincesClaimed: byNation.reduce((s, n) => s + n.provinces, 0),
    cities: byNation.reduce((s, n) => s + n.cities, 0),
    population: byNation.reduce((s, n) => s + n.population, 0),
    nationsActive: nationMonthly.filter((n) => n.isActive).length,
  };
  const cities = world.cities.map((c) => ({
    cityId: c.id,
    name: c.name,
    nationId: c.nationId,
    provinceId: c.provinceId,
    level: c.level,
    population: c.population,
    isCapital: c.isCapital,
  }));
  const capitals = cities
    .filter((c) => c.isCapital)
    .map((c) => ({
      nationId: c.nationId,
      cityId: c.cityId,
      cityName: c.name,
      provinceId: c.provinceId,
      level: c.level,
      population: c.population,
    }));
  return {
    seed,
    simYear: simYearOf(simMonth),
    simMonthOfYear: simMonthOfYear(simMonth),
    simMonth,
    totals,
    byNation,
    capitals,
    cities,
    createdAt: nowIso(),
  };
}

async function postJson(path: string, body: unknown): Promise<unknown> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} ${path}`);
  return (await response.json()) as unknown;
}

/** Crea el run en Mongo (+ naciones). Retorna null si Mongo no está disponible. */
export async function mongoNewRun(input: {
  seed: string;
  worldParams: { nationCount: number; cityCount: number; freeProvinceRatio: number };
  worldSummary: { nations: number; provinces: number; cities: number; tiles: number };
  llmNations: Array<{ nationId: string; provider: string; model: string; enabled: boolean }>;
  nations: Array<Omit<NationDocument, "runId" | "_id">>;
  createdBy: string;
}): Promise<MongoRunCtx | null> {
  try {
    const result = (await postJson("/__aia-mongo/run", input)) as { ok: boolean; runNumber?: number };
    if (!result.ok || typeof result.runNumber !== "number") {
      console.warn(`[mongoSync] /run rechazado para seed ${input.seed}`);
      return null;
    }
    return { seed: input.seed, runNumber: result.runNumber };
  } catch (error) {
    console.warn(`[mongoSync] /run falló para seed ${input.seed}:`, error instanceof Error ? error.message : error);
    return null;
  }
}

/** Envía un turno completo. Nunca lanza: best-effort. */
export async function mongoSendTurn(
  ctx: MongoRunCtx,
  payload: {
    eventDocs: Array<Omit<EventDocument, "runId" | "_id">>;
    nationMonthlyDocs: Array<Omit<NationMonthlyDocument, "runId" | "_id">>;
    worldMonthlyDoc: Omit<WorldMonthlyDocument, "runId" | "_id">;
    monthsSimulated: number;
    status?: "finished" | "gameover";
  },
): Promise<void> {
  try {
    await postJson("/__aia-mongo/turn", {
      seed: ctx.seed,
      runNumber: ctx.runNumber,
      eventDocs: payload.eventDocs,
      nationMonthlyDocs: payload.nationMonthlyDocs,
      worldMonthlyDocs: [payload.worldMonthlyDoc],
      monthsSimulated: payload.monthsSimulated,
      status: payload.status,
    });
  } catch (error) {
    // best-effort: el juego sigue aunque Mongo falle (queda rastro en consola)
    console.warn(`[mongoSync] /turn falló para seed ${ctx.seed} run ${ctx.runNumber}:`, error instanceof Error ? error.message : error);
  }
}
