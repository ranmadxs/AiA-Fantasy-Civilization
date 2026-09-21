import { taggedEvents, type EventSource, type GameEvent } from "./events";
import { ev, type EventLang } from "./eventText";
import { buildInitialDiplomacyState, evaluateDiplomaticProposalsWithEvents, executeDiplomacyPoliciesWithEvents, executePeacefulExpansion } from "./diplomacy";
import { consumeResources, type HungerState } from "./hunger";
import { isNationActive, checkDominationVictory, getDomination } from "./nationStatus";
import { debug, flushLogs } from "./debugLog";
import { advanceNationPolicies, buildInitialNationPolicies, type NationPolicyState } from "./policyAI";
import { buildInitialNationRelations, type NationRelations } from "./relationships";
import { applyPopulationDynamics, buildInitialNationStockpiles, settleNationStockpiles, type NationStockpile } from "./settlement";
import { advanceSpyNetwork, buildInitialSpyNetworkWithEvents, type SpyNetwork } from "./spies";
import {
  buildInitialMarketState,
  executeTransactions,
  generateOffers,
  type MarketState,
} from "./market";
import { buildInitialCurrencyState, type CurrencyState } from "./currency";
import { buildInitialEraStates, eraCostFactor, eraChangeCost, eraProductionBonus, eraTransitionTarget, getNationEra, isKindUnlockedByEra, nextEra, checkEraRequirements, type EraState, ERA_CONFIGS } from "./era";
import {
  canAffordFirstQuota,
  caravanaOutcome,
  createConstructionProject,
  findAdjacentFreeTiles,
  formatConstructionBudget,
  getConstructionSpec,
  GRANJA_MAX_NIVEL,
  granjaOutput,
  granjaUpgradeEligible,
  indexFabricas,
  indexProvinceBuildings,
  isTileOccupied,
  missingQuota,
  POZO_MAX_NIVEL,
  pozoOutput,
  pozoSpotEligible,
  pozoUpgradeEligible,
  progressConstruction,
  resolveProvinceRef,
  stableUpgrade3Eligible,
  stableUpgradeEligible,
  trasladoOutcome,
  type ConstructionKind,
  type ConstructionProject,
  type MinaDeCarbon,
  type Aserradero,
  type FabricaArmas,
  type Granja,
  type Pozo,
  type Reino,
} from "./construction";
import { isReinoEra } from "./era";
import { densityPerTile, habitableTilesOf } from "./density";
import { maxLevelOf, tilesFor } from "./levelCaps";
import { BUILDING_LIST, BUILDING_TILE_FOOTPRINT, MAX_PROJECTS_PER_NATION } from "./configDefaults";
import {
  CART_INTERNAL_COST_GOLD,
  CART_UPKEEP_WOOD,
  affordableUnits,
  cartsNeededForUnits,
  provinceCartNeed,
  provinceHops,
  shipmentTravelMonths,
  validateCartMove,
  validateCartOffer,
} from "./carts";
import type { CartOffer, Shipment } from "./carts";
import { getLiveMaintenanceCosts } from "./constructionConfig";
import { buildInitialChatState, type ChatState } from "./chat";
import { enforceProvinceMilitaryLimits, handleDeserters } from "./provinceLimits";
import type { World } from "./types";
import { advanceArmyGroups, advanceMilitaryEconomy, advanceWarSystem, buildInitialMilitaryState, type LlmArmyOrders, type MilitaryState, type MoveOrder, type MusterOrder } from "./war";

export type GameOverRecord = {
  victorNationId: string;
  month: number;
  share: number;
};

export type SimulationState = {
  defeatedNations: Record<string, DefeatedNationRecord>;
  diplomacy: ReturnType<typeof buildInitialDiplomacyState>;
  elapsedMonths: number;
  events: GameEvent[];
  mapRevision: number;
  military: MilitaryState;
  nationPolicies: Record<string, NationPolicyState>;
  nationRelations: NationRelations;
  nationStockpiles: Record<string, NationStockpile>;
  spies: SpyNetwork;
  marketState: MarketState;
  hungerState: HungerState;
  eraState: Record<string, EraState>;
  constructionProjects: ConstructionProject[];
  minasDeCarbon: MinaDeCarbon[];
  aserraderos: Aserradero[];
  minasDeHierro: MinaDeCarbon[];
  granjas: Granja[];
  pozos: Pozo[];
  fabricasArmas: FabricaArmas[];
  reinos: Reino[];
  cartShipments: Shipment[];
  cartOffers: CartOffer[];
  /** IDs de proyectos terminados sin mantención pagada (pierden buffs). */
  unmaintainedProjects: string[];
  chatLog: ChatState;
  currencyState: CurrencyState;
  gameOver?: GameOverRecord;
};

export type DefeatedNationRecord = {
  defeatedAtMonth: number;
  defeatedNationId: string;
  victorNationId: string;
};

export type NationTurnContext = {
  nationId: string;
  turnNumber: number;
  world: World;
  simulation: Readonly<SimulationState>;
};

export type TurnProgress = {
  turnNumber: number;
  activeNationId?: string;
  completedNationIds: string[];
  totalNations: number;
  phase: "idle" | "acting" | "resolving";
};

export type NationTurnExecutor = (context: NationTurnContext) => Promise<void>;

export function createInitialSimulationState(world: World): SimulationState {
  const nationRelations = buildInitialNationRelations(world);
  const nationStockpiles = buildInitialNationStockpiles(world);
  const nationPolicies = buildInitialNationPolicies(world, nationRelations, nationStockpiles, 0);
  const initialSpies = buildInitialSpyNetworkWithEvents(world, nationPolicies);
  return {
    defeatedNations: {},
    diplomacy: buildInitialDiplomacyState(world),
    elapsedMonths: 0,
    events: taggedEvents(initialSpies.events, "init"),
    mapRevision: 0,
    military: buildInitialMilitaryState(world),
    nationPolicies,
    nationRelations,
    nationStockpiles,
    spies: initialSpies.spyNetwork,
    marketState: buildInitialMarketState(0),
    hungerState: {
      globalFoodConsumption: 0,
      globalWaterConsumption: 0,
      totalDeaths: 0,
      provincesAtRisk: [],
    },
    eraState: buildInitialEraStates(world),
    constructionProjects: [],
    minasDeCarbon: [],
    aserraderos: [],
    minasDeHierro: [],
    granjas: [],
    pozos: [],
    fabricasArmas: [],
    reinos: [],
    cartShipments: [],
    cartOffers: [],
    unmaintainedProjects: [],
    chatLog: buildInitialChatState(),
    currencyState: buildInitialCurrencyState(world),
  };
}

export async function advanceSimulationTurn(
  world: World,
  current: SimulationState,
  executeNationAction: NationTurnExecutor = async () => undefined,
  onProgress?: (progress: TurnProgress) => void,
  lang?: EventLang,
): Promise<SimulationState> {
  const turnNumber = current.elapsedMonths + 1;
  const activeNations = world.nations.filter((nation) => isNationActive(world, nation.id));
  const completedNationIds: string[] = [];

  const marketStartState = {
    ...current,
    marketState: {
      ...current.marketState,
      currentPhase: "MARKET_START" as const,
      currentTurn: turnNumber,
      offers: generateOffers(
        current.marketState.offers,
        world.nations.map((n) => n.id),
        turnNumber,
        world.seed,
      ),
    },
  };

  for (const nation of activeNations) {
    onProgress?.({ turnNumber, activeNationId: nation.id, completedNationIds: [...completedNationIds], totalNations: activeNations.length, phase: "acting" });
    try {
      await executeNationAction({ nationId: nation.id, turnNumber, world, simulation: marketStartState });
    } catch (error) {
      // Ningún executor puede tumbar el turno: la nación no actúa,
      // el mantenimiento sigue en resolveTurn y el loop continúa.
      const cause = error instanceof Error ? error.message : String(error);
      debug.tag("turnSimulation").error(`turno ${turnNumber} executor de ${nation.id} falló: ${cause} — sin acciones.`);
    }
    completedNationIds.push(nation.id);
  }

  const afterHunger = processHunger(world, marketStartState, lang);
  onProgress?.({ turnNumber, completedNationIds: [...completedNationIds], totalNations: activeNations.length, phase: "resolving" });
  return resolveTurn(world, afterHunger, turnNumber, lang);
}

function processHunger(
  world: World,
  current: SimulationState,
  lang?: EventLang,
): SimulationState {
  const consumption = consumeResources(world, current.nationStockpiles, current.elapsedMonths);
  const totalDeaths = consumption.deaths;
  const provincesAtRisk = consumption.provincesAtRisk;

  return {
    ...current,
    hungerState: {
      globalFoodConsumption: consumption.globalFoodConsumption ?? 0,
      globalWaterConsumption: consumption.globalWaterConsumption ?? 0,
      totalDeaths,
      provincesAtRisk,
    },
    events: [...current.events, ...(totalDeaths > 0 ? [{
      id: `event-hunger-${current.elapsedMonths}`,
      month: current.elapsedMonths,
      kind: "hunger" as const,
      title: ev(lang, "Starvation", "Hambruna"),
      description: ev(lang,
        `${totalDeaths} people died from lack of resources.`,
        `${totalDeaths} personas murieron por falta de recursos.`),
      nationIds: provincesAtRisk,
      source: "hunger" as EventSource,
      ...(lang ? { lang } : {}),
    }] : [])],
  };
}

/**
 * Construcción (Ingeniería): nación activa con policy `construction` y fondos
 * arranca 1 obra en su capital (costo de tabla tal cual); cada turno se cobra
 * la cuota y al terminar sube nivel la ciudad + chequea era. Todo con eventos
 * con budget (🚧 inicio con costo, ✅ finished, 🏛️ era).
 */
/** Exportada para tests: un turno de construcción (selección + progreso + cobro). */
export function advanceConstruction(
  world: World,
  current: SimulationState,
  nationPolicies: Record<string, NationPolicyState>,
  stockpiles: Record<string, NationStockpile>,
  eraState: Record<string, EraState>,
  nextMonth: number,
): {
  projects: ConstructionProject[];
  stockpiles: Record<string, NationStockpile>;
  eraState: Record<string, EraState>;
  events: GameEvent[];
  minasDeCarbon: MinaDeCarbon[];
  aserraderos: Aserradero[];
  minasDeHierro: MinaDeCarbon[];
  granjas: Granja[];
  pozos: Pozo[];
  fabricasArmas: FabricaArmas[];
  reinos: Reino[];
  unmaintainedProjects: string[];
  /** Obras terminadas este turno (para refrescar el mapa). */
  completedCount: number;
} {
  const events: GameEvent[] = [];
  let projects = [...current.constructionProjects];
  const minasDeCarbon = [...current.minasDeCarbon];
  const aserraderos = [...current.aserraderos];
  let minasDeHierro = [...current.minasDeHierro];
  const granjas = [...(current.granjas ?? [])];
  const pozos = [...(current.pozos ?? [])];
  let fabricasArmas = [...current.fabricasArmas];
  let reinos = [...(current.reinos ?? [])];
  let nextEraState = eraState;

  const kindLabel: Record<ConstructionKind, string> = {
    obra: "pueblo",
    barracks: "cuartel",
    granja: "granja",
    stable: "establo",
    mina_carbon: "mina de carbón",
    aserradero: "aserradero",
    pozo: "pozo de agua",
    mina_hierro: "mina de hierro",
    fabrica_armas: "fábrica de armas",
    ciudad: "ciudad",
    reino: "reino 👑",
    carreta: "carreta 🛒",
  };
  const findFreeTile = (provinceId: string): { x: number; y: number } | undefined => {
    const tiles = world.tiles.filter((t) => t.provinceId === provinceId && !t.reservedBy);
    for (const t of tiles) {
      if (!isTileOccupied(world, t.x, t.y)) return { x: t.x, y: t.y };
    }
    return undefined;
  };
  /** Reserva hasta n tiles libres en la provincia (huella de construcción). */
  const reserveTiles = (provinceId: string, n: number, marker: string): number => {
    let reserved = 0;
    const tiles = world.tiles.filter((t) => t.provinceId === provinceId && !t.reservedBy);
    for (const t of tiles) {
      if (reserved >= n) break;
      if (isTileOccupied(world, t.x, t.y)) continue;
      t.reservedBy = marker;
      reserved += 1;
    }
    return reserved;
  };
  const recentEvent = (match: (e: GameEvent) => boolean, months: number): boolean =>
    current.events.some((e) => e.month > nextMonth - months && match(e));

  // Fábricas perdidas en conquista: la provincia ya no es de su dueño.
  const lostFabricas = fabricasArmas.filter((f) => {
    const province = world.provinceById.get(f.provinceId);
    return !province || province.nationId !== f.nationId;
  });
  if (lostFabricas.length > 0) {
    fabricasArmas = fabricasArmas.filter((f) => !lostFabricas.includes(f));
    for (const lost of lostFabricas) {
      events.push({
        id: `event-fabrica-lost-${lost.id}-${nextMonth}`,
        month: nextMonth,
        kind: "construction",
        title: "📉 Fábrica de armas perdida",
        description: `${world.nationById.get(lost.nationId)?.name ?? lost.nationId} perdió su fábrica de armas en ${world.provinceById.get(lost.provinceId)?.name ?? lost.provinceId} por conquista.`,
        nationIds: [lost.nationId],
      });
    }
  }

  // Transiciones de era: decisión por policy (LLM o motor), se paga el costo.
  // La era oscura es opcional: skip_dark salta de medieval a modern.
  // Dispara una sola vez por decisión (decidedAtMonth === nextMonth).
  for (const nation of world.nations) {
    if (!isNationActive(world, nation.id)) continue;
    const eraPolicy = nationPolicies[nation.id]?.era;
    if (!eraPolicy || (eraPolicy.policy !== "advance_era" && eraPolicy.policy !== "skip_dark") || eraPolicy.decidedAtMonth !== nextMonth) continue;
    const currentEra = getNationEra(nation.id, nextEraState);
    const upcoming = eraTransitionTarget(currentEra, eraPolicy.policy);
    if (!upcoming) continue;
    const skipped = eraPolicy.policy === "skip_dark";
    const cost = eraChangeCost(upcoming);
    const stock = stockpiles[nation.id];
    // Requisitos no-oro primero (pueblos/vivos/reinos; skip_dark valida los de modern).
    const reqResult = checkEraRequirements(upcoming, world, nation.id, reinos);
    if (!reqResult.met) {
      // 🚫 requisitos incumplidos (1 vez por episodio de 6 meses, sin descontar oro).
      if (!recentEvent((e) => e.id === `event-era-requirements-${nation.id}`, 6)) {
        events.push({
          id: `event-era-requirements-${nation.id}`,
          month: nextMonth,
          kind: "era",
          title: "🚫 Requisitos de era no cumplidos",
          description: `${nation.name} no puede avanzar a la era ${upcoming}: ${reqResult.faltan.join("; ")}.`,
          nationIds: [nation.id],
        });
      }
    } else if ((stock?.gold ?? 0) >= cost) {
      stock.gold -= cost;
      nextEraState = {
        ...nextEraState,
        [nation.id]: { ...nextEraState[nation.id], currentEra: upcoming as EraState["currentEra"], unlockedAt: nextMonth },
      };
      nationPolicies[nation.id] = {
        ...nationPolicies[nation.id],
        era: { policy: "stay", label: "Stay in Era", rationale: `Advanced to ${upcoming}; holding.`, decidedAtMonth: nextMonth, nextDecisionMonth: nextMonth + 2 },
      };
      events.push({
        id: `event-era-${nation.id}-${upcoming}-${nextMonth}`,
        month: nextMonth,
        kind: "era",
        title: skipped ? "⏭️ Era oscura saltada" : "🏛️ Era desbloqueada",
        description: skipped
          ? `${nation.name} saltó la era oscura opcional y entró en la era ${upcoming} pagando ${cost} oro. Costos ×${eraCostFactor(upcoming)}.`
          : `${nation.name} entró en la era ${upcoming} pagando ${cost} oro. Costos ×${eraCostFactor(upcoming)}.`,
        nationIds: [nation.id],
      });
    } else if (!recentEvent((e) => e.id === `event-era-blocked-${nation.id}`, 6)) {
      events.push({
        id: `event-era-blocked-${nation.id}`,
        month: nextMonth,
        kind: "era",
        title: "🚫 Cambio de era bloqueado",
        description: `${nation.name} no pudo entrar en la era ${upcoming}: faltan ${Math.round(cost - (stock?.gold ?? 0))} oro (cuesta ${cost}).`,
        nationIds: [nation.id],
      });
    }
  }

  for (const nation of world.nations) {
    if (!isNationActive(world, nation.id)) continue;
    // Repoblamiento (supervivencia, sin importar la policy económica):
    // ciudad propia con <10 hab recibe caravana de la ciudad con más
    // gente. El donante conserva piso 50 (sin ping-pong).
    if (!projects.some((p) => p.nationId === nation.id && p.status === "building")) {
      const emptyCity = world.cities
        .filter((c) => c.nationId === nation.id && c.population < 10)
        .sort((a, b) => a.population - b.population)[0];
      const donor = world.cities
        .filter((c) => c.nationId === nation.id && c.population >= 60 && (!emptyCity || c.id !== emptyCity.id))
        .sort((a, b) => b.population - a.population)[0];
      if (emptyCity && donor) {
        const sent = Math.min(100, donor.population - 50);
        donor.population -= sent;
        const outcome = caravanaOutcome(world.seed, `repopulate-${donor.id}-${emptyCity.id}`, nextMonth, sent);
        emptyCity.population += outcome.arrival;
        if (outcome.deserters > 0) {
          const tile = world.tiles.find((t) => t.x === emptyCity.x && t.y === emptyCity.y);
          if (tile) tile.populationOnTile = (tile.populationOnTile ?? 0) + outcome.deserters;
        }
        events.push({
          id: `event-repopulate-${donor.id}-${emptyCity.id}-${nextMonth}`,
          month: nextMonth,
          kind: "construction",
          title: "🚚 Caravana de repoblamiento",
          description: `${nation.name} envió ${sent} colonos de ${donor.name} a ${emptyCity.name}: llegaron ${outcome.arrival} (${outcome.deaths} muertos, ${outcome.deserters} desertores en el viaje).`,
          nationIds: [nation.id],
        });
        continue;
      }
    }
    // Traslado por sobrepoblación: lo decide la IA (explícito) o el motor
    // por necesidad (>10% sobre el tope, al destino con cupo más cercano).
    // Vale con cualquier policy; cuesta 1 oro por tramo.
    const tryTraslado = (fromId: string, toId: string, colonos: number): boolean => {
      const from = world.cities.find((c) => c.id === fromId && c.nationId === nation.id);
      const to = world.cities.find((c) => c.id === toId && c.nationId === nation.id);
      if (!from || !to || from.id === to.id) return false;
      const n = Math.floor(colonos);
      if (!(n >= 1) || from.population < n) return false;
      const hops = provinceHops(world, from.provinceId, to.provinceId);
      if (!Number.isFinite(hops)) return false;
      const stock = stockpiles[nation.id];
      if (!stock || stock.gold < hops) return false;
      from.population -= n;
      stock.gold -= hops;
      const outcome = trasladoOutcome(world.seed, `traslado-${from.id}-${to.id}`, nextMonth, n, hops);
      to.population += outcome.arrival;
      if (outcome.deserters > 0) {
        const tile = world.tiles.find((t) => t.x === to.x && t.y === to.y);
        if (tile) tile.populationOnTile = (tile.populationOnTile ?? 0) + outcome.deserters;
      }
      events.push({
        id: `event-traslado-${from.id}-${to.id}-${nextMonth}`,
        month: nextMonth,
        kind: "construction",
        title: "🚚 Traslado de colonos",
        description: `${nation.name} trasladó ${n} colonos de ${from.name} a ${to.name} (${hops} tramo${hops === 1 ? "" : "s"} por ${hops} oro): llegaron ${outcome.arrival} (${outcome.deaths} muertos, ${outcome.deserters} desertores).`,
        nationIds: [nation.id],
      });
      return true;
    };
    const explicitTraslado = (nationPolicies[nation.id] as unknown as { traslado?: { fromCityId: string; toCityId: string; colonos: number } } | undefined)?.traslado;
    if (explicitTraslado) {
      if (tryTraslado(explicitTraslado.fromCityId, explicitTraslado.toCityId, explicitTraslado.colonos)) continue;
    } else {
      const eraN = getNationEra(nation.id, nextEraState);
      const over = world.cities
        .filter((c) => {
          if (c.nationId !== nation.id) return false;
          const cap = habitableTilesOf(c.provinceId, world) * densityPerTile(eraN);
          return cap > 0 && c.population > cap * 1.1 && c.population - cap >= 10;
        })
        .map((c) => {
          const cap = habitableTilesOf(c.provinceId, world) * densityPerTile(eraN);
          return { c, excess: c.population - cap };
        })
        .sort((a, b) => b.excess - a.excess)[0];
      if (over) {
        const dest = world.cities
          .filter((c) => {
            if (c.nationId !== nation.id || c.id === over.c.id) return false;
            const cap = habitableTilesOf(c.provinceId, world) * densityPerTile(eraN);
            return c.population < cap;
          })
          .map((c) => {
            const cap = habitableTilesOf(c.provinceId, world) * densityPerTile(eraN);
            return { c, room: cap - c.population, hops: provinceHops(world, over.c.provinceId, c.provinceId) };
          })
          .filter((d) => d.room >= 1 && Number.isFinite(d.hops))
          .sort((a, b) => a.hops - b.hops || b.room - a.room)[0];
        if (dest && tryTraslado(over.c.id, dest.c.id, Math.min(over.excess, dest.room))) continue;
      }
    }
    if (nationPolicies[nation.id]?.economy?.policy !== "construction") continue;
    if (projects.filter((p) => p.nationId === nation.id && p.status === "building").length >= MAX_PROJECTS_PER_NATION) continue;
    // Cadena automática por prioridad: cuartel → granja → establo → obra →
    // mina carbón → aserradero → pozo → mina hierro → fábrica armas.
    // Hasta MAX_PROJECTS_PER_NATION en paralelo, sin repetir provincia en el turno.
    // Órdenes explícitas LLM (upgrade/buildOrders) van primero, validadas.
    const ownedProvinces = world.provinces.filter((p) => p.nationId === nation.id);
    const nationEra = getNationEra(nation.id, nextEraState);
    const withCity = (p: { id: string }) =>
      world.cities.some((c) => c.provinceId === p.id && c.nationId === nation.id);
    const hasComplete = (provinceId: string, kind: ConstructionKind): boolean =>
      projects.some((p) => p.nationId === nation.id && p.provinceId === provinceId && p.kind === kind && p.status === "complete");
    const hasFabrica = (provinceId: string): boolean =>
      hasComplete(provinceId, "fabrica_armas") ||
      fabricasArmas.some((f) => f.provinceId === provinceId && f.nationId === nation.id);
    const hasReino = (provinceId: string): boolean =>
      reinos.some((r) => r.provinceIds.includes(provinceId) && r.nationId === nation.id && r.activo);
    const canReino = (provinceId: string): boolean => {
      if (!isReinoEra(nationEra)) return false;
      if (hasReino(provinceId)) return false;
      const nationCities = world.cities.filter((c) => c.nationId === nation.id).length;
      if (nationCities < 10) return false;
      const provinceCities = world.cities.filter((c) => c.provinceId === provinceId && c.nationId === nation.id).length;
      if (provinceCities < 2) return false;
      return true;
    };
    const intent = ((nationPolicies[nation.id] as unknown as { constructionIntent?: string })?.constructionIntent ?? "auto") as string;
    const chain: ConstructionKind[] = ["barracks", "granja", "stable", "obra", "mina_carbon", "aserradero", "pozo", "mina_hierro", "fabrica_armas", "ciudad", "reino", "carreta"];
    const orderedChain: ConstructionKind[] = intent === "pueblo" ? ["obra", ...chain.filter((k) => k !== "obra")]
      : intent === "ciudad" ? ["ciudad", ...chain.filter((k) => k !== "ciudad")]
      : intent === "reino" ? ["reino", ...chain.filter((k) => k !== "reino")]
      : chain;
    const buildingCount = () =>
      projects.filter((p) => p.nationId === nation.id && p.status === "building").length;    const usedProvinces = new Set<string>(
      projects.filter((p) => p.nationId === nation.id && p.status === "building").map((p) => p.provinceId),
    );
    // Era ya actualizada este turno (nextEraState), no la vieja.
    const era = getNationEra(nation.id, nextEraState);
    const nationGroups = current.military?.[nation.id]?.armyGroups ?? [];

    const rejectedBuildOrder = (provinceId: string, reason: string): GameEvent => ({
      id: `event-order-rejected-${nation.id}-${provinceId}-${nextMonth}`,
      month: nextMonth,
      kind: "construction",
      title: "🚫 Orden rechazada",
      description: `${nation.name} ordenó obra en ${world.provinceById.get(provinceId)?.name ?? provinceId} pero fue rechazada: ${reason}.`,
      nationIds: [nation.id],
    });

    const launchProject = (
      targetKind: ConstructionKind,
      targetProvinceId: string,
      isStableUpgrade: boolean,
      upgradeFrom: number,
      cartQuantity: number,
    ): boolean => {
      const isCapital = targetProvinceId === nation.capitalProvinceId;
      const spec = getConstructionSpec(targetKind, era, isCapital);
      // Carretas: N = mín(necesidad, pagables), costo N×unitario en 1 turno.
      if (targetKind === "carreta") {
        const need = provinceCartNeed(nationGroups, targetProvinceId);
        cartQuantity = Math.min(need, affordableUnits(spec.cost, stockpiles[nation.id] ?? { gold: 0, resources: {} }));
        if (cartQuantity < 1) return false;
      }
      if (!canAffordFirstQuota(spec.cost, spec.turns, stockpiles[nation.id])) {
        // 🚫 no iniciada por falta de fondos (1 vez por episodio de 6 meses).
        if (!recentEvent((e) => e.kind === "construction" && e.id.startsWith(`event-construction-blocked-${nation.id}-`), 6)) {
          events.push({
            id: `event-construction-blocked-${nation.id}-${nextMonth}`,
            month: nextMonth,
            kind: "construction",
            title: "🚫 Obra no iniciada",
            description: `${nation.name} no pudo iniciar ${kindLabel[targetKind]} ${era} en ${world.provinceById.get(targetProvinceId)?.name ?? targetProvinceId}: ${missingQuota(spec.cost, spec.turns, stockpiles[nation.id])}. La obra espera fondos.`,
            nationIds: [nation.id],
          });
        }
        return false;
      }
      // Pueblo fundador exige origen con ≥100 hab; salen mín(100, pob-50)
      // (el origen conserva piso 50, sin ping-pong).
      // Si es desarrollo (provincia ya con ciudad), no descuenta.
      let caravanOriginId: string | undefined;
      let caravanColonos = 0;
      if (targetKind === "obra") {
        const hasCity = world.cities.some((c) => c.nationId === nation.id && c.provinceId === targetProvinceId);
        if (!hasCity) {
          const origin = world.cities
            .filter((c) => c.nationId === nation.id)
            .sort((a, b) => b.population - a.population)[0];
          if (!origin || origin.population < 100) return false;
          caravanColonos = Math.min(100, origin.population - 50);
          if (caravanColonos < 10) return false;
          origin.population -= caravanColonos;
          caravanOriginId = origin.id;
        }
      }
      const project = createConstructionProject(nation.id, targetProvinceId, era, isCapital, world.seed, nextMonth, targetKind);
      if (caravanOriginId) {
        project.cityId = caravanOriginId;
        project.quantity = caravanColonos;
      }
      if (isStableUpgrade) {
        // Mejora: costo ×2 (niv.2) o ×3 (niv.3), 6 meses fijos.
        const factor = upgradeFrom >= 2 ? 3 : 2;
        const scaled: Record<string, number> = {};
        for (const [k, v] of Object.entries(project.cost)) scaled[k] = Math.round((v ?? 0) * factor);
        project.cost = scaled;
        project.totalTurns = 6;
        project.remainingTurns = 6;
      }
      if (targetKind === "carreta") {
        // N carretas en 1 turno: costo unitario × N.
        const scaled: Record<string, number> = {};
        for (const [k, v] of Object.entries(project.cost)) scaled[k] = Math.round((v ?? 0) * cartQuantity);
        project.cost = scaled;
        project.totalTurns = 1;
        project.remainingTurns = 1;
        project.quantity = cartQuantity;
      }
      // Reserva de huella en tiles (mina 20, ciudad 15, reino 20, resto 1).
      if (targetKind === "mina_carbon" || targetKind === "mina_hierro" || targetKind === "aserradero" || targetKind === "granja" || targetKind === "pozo" || targetKind === "obra" || targetKind === "ciudad" || targetKind === "reino") {
        reserveTiles(targetProvinceId, BUILDING_TILE_FOOTPRINT[targetKind] ?? 1, project.id);
      }
      projects.push(project);
      usedProvinces.add(targetProvinceId);
      const province = world.provinceById.get(targetProvinceId);
      events.push({
        id: `event-construction-started-${project.id}`,
        month: nextMonth,
        kind: "construction",
        title: caravanOriginId ? "🚚 Caravana en marcha" : "🚧 Construcción iniciada",
        description: caravanOriginId
          ? `${nation.name} envió ${caravanColonos} colonos de ${world.cityById.get(caravanOriginId)?.name ?? caravanOriginId} a fundar pueblo en ${province?.name ?? targetProvinceId} por ${formatConstructionBudget(project.cost)} (${project.remainingTurns} meses de viaje/obra).`
          : `${nation.name} mandó a construir ${kindLabel[targetKind]} ${era} en ${province?.name ?? targetProvinceId} por ${formatConstructionBudget(project.cost)} (${project.remainingTurns} meses).`,
        nationIds: [nation.id],
      });
      return true;
    };

    const validateExplicitBuild = (
      kind: ConstructionKind,
      ref: string,
    ): { ok: true; upgrade: boolean; upgradeFrom: number; provinceId: string } | { ok: false; reason: string } => {
      // Acepta provinceId o cityId propia (el LLM a veces manda ciudad).
      const resolvedId = resolveProvinceRef(world, nation.id, ref);
      const province = resolvedId ? ownedProvinces.find((p) => p.id === resolvedId) : undefined;
      if (!province) return { ok: false, reason: "provincia ajena o inexistente" };
      const provinceId = province.id;
      if (!isKindUnlockedByEra(kind, nationEra)) return { ok: false, reason: `${kind} bloqueado en era ${nationEra}` };
      if (usedProvinces.has(provinceId)) return { ok: false, reason: "provincia ocupada este turno" };
      if (projects.some((pr) => pr.nationId === nation.id && pr.provinceId === provinceId && pr.kind === kind && pr.status === "building")) {
        return { ok: false, reason: "obra en curso" };
      }
      if (kind === "stable") {
        const up2 = stableUpgradeEligible(world, nation.id, provinceId, aserraderos);
        if (up2) return { ok: true, provinceId, upgrade: true, upgradeFrom: 1 };
        const up3 = stableUpgrade3Eligible(world, nation.id, provinceId, aserraderos);
        if (up3) return { ok: true, provinceId, upgrade: true, upgradeFrom: 2 };
        if (withCity(province) && !hasComplete(provinceId, "stable")) return { ok: true, provinceId, upgrade: false, upgradeFrom: 1 };
        return { ok: false, reason: "establo al máximo o sin sitio" };
      }
      if (kind === "pozo") {
        if (pozoUpgradeEligible(nation.id, provinceId, pozos)) return { ok: true, provinceId, upgrade: false, upgradeFrom: 1 };
        if (withCity(province) && pozoSpotEligible(world, provinceId)) return { ok: true, provinceId, upgrade: false, upgradeFrom: 1 };
        return { ok: false, reason: "pozo sin sitio" };
      }
      if (kind === "reino" && !canReino(provinceId)) return { ok: false, reason: "reino no permitido aquí" };
      if (kind !== "carreta" && kind !== "obra" && hasComplete(provinceId, kind)) {
        return { ok: false, reason: "ya construido" };
      }
      if ((kind === "obra" || kind === "ciudad") && !withCity(province) && !findFreeTile(provinceId)) {
        return { ok: false, reason: "sin tile libre" };
      }
      return { ok: true, provinceId, upgrade: false, upgradeFrom: 1 };
    };

    const pickChainTarget = (): { kind: ConstructionKind; provinceId: string; isStableUpgrade: boolean; upgradeFrom: number } | undefined => {
      for (const kind of orderedChain) {
        if (!isKindUnlockedByEra(kind, nationEra)) continue;
        // Carretas: provincia propia con establo niv.3 + necesidad. Repetible.
        if (kind === "carreta") {
          const target = ownedProvinces.find((p) => {
            if (usedProvinces.has(p.id)) return false;
            const hasStable3 = aserraderos.some(
              (a) => a.nationId === nation.id && a.provinceId === p.id && a.activa && (a.nivel ?? 1) >= 3,
            );
            return hasStable3 && provinceCartNeed(nationGroups, p.id) > 0;
          });
          if (target) {
            return { kind, provinceId: target.id, isStableUpgrade: false, upgradeFrom: 1 };
          }
          continue;
        }
        if (kind === "reino") {
          const capitalOk = canReino(nation.capitalProvinceId);
          if (!capitalOk) {
            const target = ownedProvinces.find((p) => !usedProvinces.has(p.id) && withCity(p) && canReino(p.id));
            if (target) {
              return { kind, provinceId: target.id, isStableUpgrade: false, upgradeFrom: 1 };
            }
            continue;
          }
        }
        // Mejora granja: exige 1 tile adyacente libre (1 tile/nivel, máx niv.10).
        if (kind === "granja") {
          const up = ownedProvinces
            .filter((p) => !usedProvinces.has(p.id))
            .map((p) => ({ p, elig: granjaUpgradeEligible(world, nation.id, p.id, granjas) }))
            .find(({ elig }) => elig !== undefined);
          if (up?.elig) {
            return { kind, provinceId: up.p.id, isStableUpgrade: false, upgradeFrom: 1 };
          }
        }
        // Pozo: provincia propia con ciudad y tile libre sin veta (era antigua+).
        if (kind === "pozo") {
          const target = ownedProvinces.find((p) => {
            if (usedProvinces.has(p.id)) return false;
            if (!withCity(p)) return false;
            if (projects.some((pr) => pr.nationId === nation.id && pr.provinceId === p.id && pr.kind === "pozo" && pr.status === "building")) return false;
            const existing = pozos.find((z) => z.nationId === nation.id && z.provinceId === p.id && z.activa);
            if (existing && (existing.nivel ?? 1) >= POZO_MAX_NIVEL) return false;
            if (pozoUpgradeEligible(nation.id, p.id, pozos)) return true;
            return pozoSpotEligible(world, p.id) !== undefined;
          });
          if (target) {
            return { kind, provinceId: target.id, isStableUpgrade: false, upgradeFrom: 1 };
          }
          continue;
        }
        // Mejora establo a niv.2 (luego niv.3): ciudad niv.2+/3+ y tiles adyacentes.
        if (kind === "stable") {
          const up2 = ownedProvinces
            .filter((p) => !usedProvinces.has(p.id))
            .map((p) => ({ p, elig: stableUpgradeEligible(world, nation.id, p.id, aserraderos) }))
            .find(({ elig }) => elig !== undefined);
          if (up2?.elig) {
            return { kind, provinceId: up2.p.id, isStableUpgrade: true, upgradeFrom: 1 };
          }
          const up3 = ownedProvinces
            .filter((p) => !usedProvinces.has(p.id))
            .map((p) => ({ p, elig: stableUpgrade3Eligible(world, nation.id, p.id, aserraderos) }))
            .find(({ elig }) => elig !== undefined);
          if (up3?.elig) {
            return { kind, provinceId: up3.p.id, isStableUpgrade: true, upgradeFrom: 2 };
          }
        }
        // Obra fundadora: provincia propia sin ciudad de la nación (caravana).
        if (kind === "obra") {
          const empty = ownedProvinces.find((p) => !usedProvinces.has(p.id) && !withCity(p) && findFreeTile(p.id));
          const origin = world.cities
            .filter((c) => c.nationId === nation.id)
            .sort((a, b) => b.population - a.population)[0];
          if (empty && origin && origin.population >= 100) {
            return { kind, provinceId: empty.id, isStableUpgrade: false, upgradeFrom: 1 };
          }
        }
        const target = ownedProvinces.find((p) =>
          !usedProvinces.has(p.id) && withCity(p) && (kind === "fabrica_armas" ? !hasFabrica(p.id) : !hasComplete(p.id, kind)),
        );
        if (target) {
          // Pueblo no puede ir en tile ocupado por mina/aserradero: exige tile libre.
          if ((kind === "obra" || kind === "ciudad") && !findFreeTile(target.id)) continue;
          return { kind, provinceId: target.id, isStableUpgrade: false, upgradeFrom: 1 };
        }
      }
      return undefined;
    };

    // 1) Órdenes explícitas LLM (upgrade + buildOrders), validadas y one-shot.
    const sidecar = nationPolicies[nation.id] as unknown as {
      upgradeOrder?: { provinceId: string; kind: string };
      buildOrdersList?: Array<{ provinceId: string; kind: string }>;
    } | undefined;
    const explicitOrders: Array<{ kind: ConstructionKind; provinceId: string }> = [];
    if (sidecar?.upgradeOrder) {
      explicitOrders.push({ kind: "stable", provinceId: sidecar.upgradeOrder.provinceId });
      sidecar.upgradeOrder = undefined;
    }
    for (const b of sidecar?.buildOrdersList ?? []) {
      explicitOrders.push({ kind: b.kind as ConstructionKind, provinceId: b.provinceId });
    }
    if (sidecar) sidecar.buildOrdersList = undefined;
    for (const explicit of explicitOrders) {
      if (buildingCount() >= MAX_PROJECTS_PER_NATION) break;
      if (!BUILDING_LIST.includes(explicit.kind)) {
        events.push(rejectedBuildOrder(explicit.provinceId, "kind desconocido"));
        continue;
      }
      const check = validateExplicitBuild(explicit.kind, explicit.provinceId);
      if (!check.ok) {
        events.push(rejectedBuildOrder(explicit.provinceId, check.reason));
        continue;
      }
      launchProject(explicit.kind, check.provinceId, check.upgrade, check.upgradeFrom, 0);
    }
    // 2) Cadena automática hasta completar cupo (máx 3, sin repetir provincia).
    while (buildingCount() < MAX_PROJECTS_PER_NATION) {
      const pick = pickChainTarget();
      if (!pick) break;
      if (!launchProject(pick.kind, pick.provinceId, pick.isStableUpgrade, pick.upgradeFrom, 0)) break;
    }
  }

  const progressed = progressConstruction(projects, stockpiles, nextMonth);
  projects = progressed.projects;
  for (const stalled of progressed.stalled) {
    // ⏸️ detenida por falta de fondos (1 vez por episodio de 3 meses).
    if (recentEvent((e) => e.id === `event-construction-stalled-${stalled.id}`, 3)) continue;
    const nation = world.nationById.get(stalled.nationId);
    events.push({
      id: `event-construction-stalled-${stalled.id}`,
      month: nextMonth,
      kind: "construction",
      title: "⏸️ Obra detenida",
      description: `${nation?.name ?? stalled.nationId} detuvo ${kindLabel[stalled.kind]} ${stalled.era} en ${world.provinceById.get(stalled.provinceId)?.name ?? stalled.provinceId}: ${missingQuota(stalled.cost, stalled.totalTurns, stockpiles[stalled.nationId])}. Se retoma al haber fondos.`,
      nationIds: [stalled.nationId],
    });
  }
  for (const done of progressed.completed) {
    const nation = world.nationById.get(done.nationId);
    const kindName = kindLabel[done.kind];
    // Solo la obra civil sube nivel la ciudad; cuartel/establo habilitan (ver war.ts).
    // Ciudad mejora pueblo; reino crea vasallo aparte.
    // Obra en provincia sin ciudad = fundación con caravana (llegan 90-100).
    let developedLabel = "sin ciudad";
    if (done.kind === "obra" && !world.cities.some((c) => c.nationId === done.nationId && c.provinceId === done.provinceId)) {
      const sent = done.quantity ?? 100;
      const outcome = caravanaOutcome(world.seed, done.id, nextMonth, sent);
      const spot = findFreeTile(done.provinceId) ?? { x: 0, y: 0 };
      const province = world.provinceById.get(done.provinceId);
      const newId = `city-founded-${done.nationId}-${done.provinceId}-${nextMonth}`;
      const originName = (done.cityId ? world.cityById.get(done.cityId)?.name : undefined) ?? done.nationId;
      const founded = {
        id: newId,
        name: `Pueblo de ${province?.name ?? done.provinceId}`,
        nameEn: `Village of ${province?.nameEn ?? done.provinceId}`,
        nameZh: `${province?.nameZh ?? done.provinceId}村`,
        nameEs: `Pueblo de ${province?.nameEs ?? done.provinceId}`,
        nameId: newId,
        nationId: done.nationId,
        provinceId: done.provinceId,
        x: spot.x,
        y: spot.y,
        isCapital: false,
        population: outcome.arrival,
        level: 1,
        tipo: "pueblo" as const,
        tiles: 1,
      };
      world.cities.push(founded);
      world.cityById.set(newId, founded);
      // La huella queda a nombre de la ciudad (no del proyecto): re-sella
      // los tiles reservados por la obra + el tile del pueblo.
      for (const t of world.tiles) {
        if (t.provinceId === done.provinceId && t.reservedBy === done.id) {
          t.reservedBy = newId;
        }
      }
      const homeTile = world.tiles.find((t) => t.x === spot.x && t.y === spot.y);
      if (homeTile && !homeTile.reservedBy) {
        homeTile.reservedBy = newId;
      }
      if (outcome.deserters > 0) {
        const tile = world.tiles.find((t) => t.x === spot.x && t.y === spot.y);
        if (tile) tile.populationOnTile = (tile.populationOnTile ?? 0) + outcome.deserters;
      }
      developedLabel = `${founded.name} (${outcome.arrival} hab)`;
      events.push({
        id: `event-pueblo-founded-${newId}`,
        month: nextMonth,
        kind: "construction",
        title: "🏘️ Pueblo fundado",
        description: `${nation?.name ?? done.nationId} fundó ${founded.name} con ${outcome.arrival} colonos de ${originName} (${outcome.deaths} muertos, ${outcome.deserters} desertores en el viaje).`,
        nationIds: [done.nationId],
      });
    } else if (done.kind === "obra" || done.kind === "ciudad") {
      const series = world.cities
        .filter((c) => c.nationId === done.nationId)
        .sort((a, b) => a.level - b.level || a.population - b.population);
      const inProvince = series.find((c) => c.provinceId === done.provinceId);
      const developed = inProvince ?? series[0];
      // El nivel máximo lo da el tope por era (levelCaps); a más nivel, más tiles vía construcción.
      const newTipo = (done.kind === "ciudad" ? "ciudad" : (developed?.tipo ?? "pueblo")) as "pueblo" | "ciudad";
      const capLevel = developed ? maxLevelOf(newTipo, done.era) : 0;
      if (developed && developed.level < capLevel) {
        developed.level += 1;
        developed.tipo = newTipo;
        developed.population = Math.round(developed.population * 1.08);
        // Crece en tiles con el nivel: reserva la diferencia en la provincia.
        const wanted = tilesFor(newTipo, developed.level);
        const current = developed.tiles ?? 1;
        if (wanted > current) {
          const got = reserveTiles(developed.provinceId, wanted - current, developed.id);
          developed.tiles = current + got;
        }
        developedLabel = `${developed.name} (nivel ${developed.level}, ${developed.tiles ?? wanted} tiles)`;
        // Exceso permitido pero avisado: producción al 10%, mover o agrandar.
        const cap = habitableTilesOf(developed.provinceId, world) * densityPerTile(done.era);
        if (developed.population > cap) {
          events.push({
            id: `event-overpop-${developed.id}-${nextMonth}`,
            month: nextMonth,
            kind: "hunger",
            title: "⚠️ Sobrepoblación",
            description: `${developed.name} supera su tope (${developed.population} vs ${cap} hab): producción al 10%. Mueve colonos o agranda el pueblo.`,
            nationIds: [done.nationId],
          });
        }
      } else if (developed) {
        developedLabel = `${developed.name} (nivel máximo era)`;
      }
    } else if (done.kind === "reino") {
      const reinoId = `reino-${done.nationId}-${done.provinceId}-${nextMonth}`;
      if (!reinos.some((r) => r.provinceIds.includes(done.provinceId) && r.nationId === done.nationId && r.activo)) {
        const capital = world.cities.find((c) => c.nationId === done.nationId && c.provinceId === done.provinceId);
        const footprint = BUILDING_TILE_FOOTPRINT.reino;
        reserveTiles(done.provinceId, footprint, reinoId);
        reinos.push({ id: reinoId, nationId: done.nationId, provinceIds: [done.provinceId], capitalCityId: capital?.id, era: done.era, activo: true, tiles: footprint });
        events.push({
          id: `event-reino-created-${reinoId}`,
          month: nextMonth,
          kind: "construction",
          title: "👑 Reino vasallo fundado",
          description: `${nation?.name ?? done.nationId} fundó un reino vasallo en ${world.provinceById.get(done.provinceId)?.name ?? done.provinceId} (era ${done.era}).`,
          nationIds: [done.nationId],
        });
      }
      const city = world.cities.find((c) => c.nationId === done.nationId && c.provinceId === done.provinceId);
      developedLabel = city?.name ?? done.provinceId;
    } else {
      const city = world.cities.find((c) => c.nationId === done.nationId && c.provinceId === done.provinceId);
      developedLabel = city?.name ?? done.provinceId;
    }
    events.push({
      id: `event-construction-finished-${done.id}`,
      month: nextMonth,
      kind: "construction",
      title: "✅ Construcción terminada",
      description: `finished: ${nation?.name ?? done.nationId} terminó ${kindName} ${done.era} en ${developedLabel} por ${formatConstructionBudget(done.cost)}.`,
      nationIds: [done.nationId],
    });
    const eraEntry = nextEraState[done.nationId];
    if (eraEntry && !eraEntry.citiesBuiltInEra.includes(done.provinceId)) {
      eraEntry.citiesBuiltInEra = [...eraEntry.citiesBuiltInEra, done.provinceId];
    }
    // NOTA: el cambio de era ya no es automático (era policy `era` con costo).

    // Crear Mina de Carbón o Aserradero al completar (con ubicación x,y como capitales + huella).
    if (done.kind === "mina_carbon") {
      const minaId = `mina-${done.nationId}-${done.provinceId}-${nextMonth}`;
      const reserved = world.tiles.find((t) => t.reservedBy === done.id);
      const spot = reserved ?? findFreeTile(done.provinceId);
      reserveTiles(done.provinceId, BUILDING_TILE_FOOTPRINT.mina_carbon, minaId);
      if (spot) {
        const tile = world.tiles.find((t) => t.x === spot.x && t.y === spot.y);
        if (tile) tile.reservedBy = minaId;
      }
      minasDeCarbon.push({
        id: minaId,
        nationId: done.nationId,
        provinceId: done.provinceId,
        era: done.era,
        activa: true,
        nivel: 1,
        x: spot?.x,
        y: spot?.y,
        tileCount: 20,
      });
      events.push({
        id: `event-mina-created-${minaId}`,
        month: nextMonth,
        kind: "construction",
        title: "⛏️ Mina de Carbón Operativa",
        description: `${nation?.name ?? done.nationId} puso en marcha una mina de carbón en ${world.provinceById.get(done.provinceId)?.name ?? done.provinceId} (era ${done.era}). Produce carbón cada turno.`,
        nationIds: [done.nationId],
      });
    } else if (done.kind === "aserradero") {
      const existing = aserraderos.find(
        (a) => a.nationId === done.nationId && a.provinceId === done.provinceId && a.activa && (a.nivel ?? 1) < 2,
      );
      if (existing) {
        // Mejora a niv.2: 4 tiles adyacentes, caballería garantizada 1/4.
        const anchor = existing.x !== undefined && existing.y !== undefined
          ? { x: existing.x, y: existing.y }
          : (findFreeTile(done.provinceId) ?? { x: 0, y: 0 });
        const extra = findAdjacentFreeTiles(world, anchor.x, anchor.y, done.provinceId, 3);
        for (const s of extra) {
          const tile = world.tiles.find((t) => t.x === s.x && t.y === s.y);
          if (tile) tile.reservedBy = existing.id;
        }
        existing.nivel = 2;
        existing.tiles = 1 + extra.length;
        events.push({
          id: `event-aserradero-upgraded-${existing.id}-${nextMonth}`,
          month: nextMonth,
          kind: "construction",
          title: "🐴 Establo nivel 2",
          description: `${nation?.name ?? done.nationId} amplió su establo en ${world.provinceById.get(done.provinceId)?.name ?? done.provinceId} a nivel 2 (${existing.tiles} tiles): caballería garantizada 1 de cada 4 reclutas.`,
          nationIds: [done.nationId],
        });
      } else {
      const aserraderoId = `aserradero-${done.nationId}-${done.provinceId}-${nextMonth}`;
      const reserved = world.tiles.find((t) => t.reservedBy === done.id);
      const spot = reserved ?? findFreeTile(done.provinceId);
      if (spot) {
        const tile = world.tiles.find((t) => t.x === spot.x && t.y === spot.y);
        if (tile) tile.reservedBy = aserraderoId;
      }
      aserraderos.push({
        id: aserraderoId,
        nationId: done.nationId,
        provinceId: done.provinceId,
        era: done.era,
        activa: true,
        nivel: 1,
        x: spot?.x,
        y: spot?.y,
        tiles: 1,
      });
      events.push({
        id: `event-aserradero-created-${aserraderoId}`,
        month: nextMonth,
        kind: "construction",
        title: "🪵 Aserradero Operativo",
          description: `${nation?.name ?? done.nationId} puso en marcha un aserradero en ${world.provinceById.get(done.provinceId)?.name ?? done.provinceId} (era ${done.era}). Produce madera cada turno.`,
          nationIds: [done.nationId],
        });
      }
    } else if (done.kind === "granja") {
      const existing = granjas.find(
        (g) => g.nationId === done.nationId && g.provinceId === done.provinceId && g.activa && (g.nivel ?? 1) < GRANJA_MAX_NIVEL,
      );
      if (existing) {
        // Mejora: +1 nivel y 1 tile adyacente (1 tile/nivel).
        const anchor = existing.x !== undefined && existing.y !== undefined
          ? { x: existing.x, y: existing.y }
          : (findFreeTile(done.provinceId) ?? { x: 0, y: 0 });
        const extra = findAdjacentFreeTiles(world, anchor.x, anchor.y, done.provinceId, 1);
        for (const s of extra) {
          const tile = world.tiles.find((t) => t.x === s.x && t.y === s.y);
          if (tile) tile.reservedBy = existing.id;
        }
        existing.nivel = (existing.nivel ?? 1) + 1;
        existing.tiles = (existing.tiles ?? 1) + extra.length;
        events.push({
          id: `event-granja-upgraded-${existing.id}-${nextMonth}`,
          month: nextMonth,
          kind: "construction",
          title: "🌾 Granja ampliada",
          description: `${nation?.name ?? done.nationId} amplió su granja en ${world.provinceById.get(done.provinceId)?.name ?? done.provinceId} a nivel ${existing.nivel} (${existing.tiles} tiles): +${granjaOutput(existing.nivel)} grano/mes.`,
          nationIds: [done.nationId],
        });
      } else {
        const granjaId = `granja-${done.nationId}-${done.provinceId}-${nextMonth}`;
        const reserved = world.tiles.find((t) => t.reservedBy === done.id);
        const spot = reserved ?? findFreeTile(done.provinceId);
        if (spot) {
          const tile = world.tiles.find((t) => t.x === spot.x && t.y === spot.y);
          if (tile) tile.reservedBy = granjaId;
        }
        granjas.push({
          id: granjaId,
          nationId: done.nationId,
          provinceId: done.provinceId,
          era: done.era,
          activa: true,
          nivel: 1,
          x: spot?.x,
          y: spot?.y,
          tiles: 1,
        });
        events.push({
          id: `event-granja-created-${granjaId}`,
          month: nextMonth,
          kind: "construction",
          title: "🌾 Granja operativa",
          description: `${nation?.name ?? done.nationId} puso en marcha una granja en ${world.provinceById.get(done.provinceId)?.name ?? done.provinceId} (era ${done.era}). Produce ${granjaOutput(1)} grano cada turno.`,
          nationIds: [done.nationId],
        });
      }
    } else if (done.kind === "pozo") {
      const existing = pozos.find(
        (p) => p.nationId === done.nationId && p.provinceId === done.provinceId && p.activa && (p.nivel ?? 1) < POZO_MAX_NIVEL,
      );
      if (existing) {
        // Mejora: +1 nivel, 1 tile fijo (sin tiles extra).
        existing.nivel = (existing.nivel ?? 1) + 1;
        events.push({
          id: `event-pozo-upgraded-${existing.id}-${nextMonth}`,
          month: nextMonth,
          kind: "construction",
          title: "💧 Pozo ampliado",
          description: `${nation?.name ?? done.nationId} amplió su pozo en ${world.provinceById.get(done.provinceId)?.name ?? done.provinceId} a nivel ${existing.nivel}: +${pozoOutput(existing.nivel)} agua/mes.`,
          nationIds: [done.nationId],
        });
      } else {
        const spot = pozoSpotEligible(world, done.provinceId);
        if (spot) {
          const pozoId = `pozo-${done.nationId}-${done.provinceId}-${nextMonth}`;
          const tile = world.tiles.find((t) => t.x === spot.x && t.y === spot.y);
          if (tile) tile.reservedBy = pozoId;
          pozos.push({
            id: pozoId,
            nationId: done.nationId,
            provinceId: done.provinceId,
            era: done.era,
            activa: true,
            nivel: 1,
            x: spot.x,
            y: spot.y,
            tiles: 1,
          });
          events.push({
            id: `event-pozo-created-${pozoId}`,
            month: nextMonth,
            kind: "construction",
            title: "💧 Pozo operativo",
            description: `${nation?.name ?? done.nationId} puso en marcha un pozo en ${world.provinceById.get(done.provinceId)?.name ?? done.provinceId} (era ${done.era}). Produce ${pozoOutput(1)} agua cada turno.`,
            nationIds: [done.nationId],
          });
        }
      }
    } else if (done.kind === "stable") {
      // Establo: crea entrada niv.1 o sube la existente (máx niv.3 → carretas).
      const existing = aserraderos.find(
        (a) => a.nationId === done.nationId && a.provinceId === done.provinceId && a.activa && (a.nivel ?? 1) < 3,
      );
      if (existing) {
        const from = existing.nivel ?? 1;
        const wantTiles = from === 1 ? 3 : 5;
        const anchor = existing.x !== undefined && existing.y !== undefined
          ? { x: existing.x, y: existing.y }
          : (findFreeTile(done.provinceId) ?? { x: 0, y: 0 });
        const extra = findAdjacentFreeTiles(world, anchor.x, anchor.y, done.provinceId, wantTiles);
        for (const s of extra) {
          const tile = world.tiles.find((t) => t.x === s.x && t.y === s.y);
          if (tile) tile.reservedBy = existing.id;
        }
        existing.nivel = from + 1;
        existing.tiles = (existing.tiles ?? 1) + extra.length;
        events.push({
          id: `event-establo-upgraded-${existing.id}-${nextMonth}`,
          month: nextMonth,
          kind: "construction",
          title: `🐴 Establo nivel ${existing.nivel}`,
          description: `${nation?.name ?? done.nationId} amplió su establo en ${world.provinceById.get(done.provinceId)?.name ?? done.provinceId} a nivel ${existing.nivel} (${existing.tiles} tiles).` +
            (existing.nivel >= 3 ? " Carretas desbloqueadas." : " Caballería garantizada 1 de cada 4 reclutas."),
          nationIds: [done.nationId],
        });
      } else {
        const stableId = `establo-${done.nationId}-${done.provinceId}-${nextMonth}`;
        const reserved = world.tiles.find((t) => t.reservedBy === done.id);
        const spot = reserved ?? findFreeTile(done.provinceId);
        if (spot) {
          const tile = world.tiles.find((t) => t.x === spot.x && t.y === spot.y);
          if (tile) tile.reservedBy = stableId;
        }
        aserraderos.push({
          id: stableId,
          nationId: done.nationId,
          provinceId: done.provinceId,
          era: done.era,
          activa: true,
          nivel: 1,
          x: spot?.x,
          y: spot?.y,
          tiles: 1,
        });
        events.push({
          id: `event-establo-created-${stableId}`,
          month: nextMonth,
          kind: "construction",
          title: "🐴 Establo operativo",
          description: `${nation?.name ?? done.nationId} puso en marcha un establo en ${world.provinceById.get(done.provinceId)?.name ?? done.provinceId} (era ${done.era}). Caballería con establo.`,
          nationIds: [done.nationId],
        });
      }
    } else if (done.kind === "mina_hierro") {
      const minaId = `mina-hierro-${done.nationId}-${done.provinceId}-${nextMonth}`;
      const reserved = world.tiles.find((t) => t.reservedBy === done.id);
      const spot = reserved ?? findFreeTile(done.provinceId);
      reserveTiles(done.provinceId, BUILDING_TILE_FOOTPRINT.mina_hierro, minaId);
      if (spot) {
        const tile = world.tiles.find((t) => t.x === spot.x && t.y === spot.y);
        if (tile) tile.reservedBy = minaId;
      }
      minasDeHierro.push({
        id: minaId,
        nationId: done.nationId,
        provinceId: done.provinceId,
        era: done.era,
        activa: true,
        nivel: 1,
        x: spot?.x,
        y: spot?.y,
        tileCount: BUILDING_TILE_FOOTPRINT.mina_hierro,
      });
      events.push({
        id: `event-mina-hierro-created-${minaId}`,
        month: nextMonth,
        kind: "construction",
        title: "⛏️ Mina de Hierro Operativa",
        description: `${nation?.name ?? done.nationId} puso en marcha una mina de hierro en ${world.provinceById.get(done.provinceId)?.name ?? done.provinceId} (era ${done.era}). Produce hierro cada turno.`,
        nationIds: [done.nationId],
      });
    } else if (done.kind === "fabrica_armas") {
      const fabricaId = `fabrica-${done.nationId}-${done.provinceId}-${nextMonth}`;
      fabricasArmas.push({
        id: fabricaId,
        nationId: done.nationId,
        provinceId: done.provinceId,
        era: done.era,
        activa: true,
      });
      events.push({
        id: `event-fabrica-created-${fabricaId}`,
        month: nextMonth,
        kind: "construction",
        title: "🏭 Fábrica de Armas Operativa",
        description: `${nation?.name ?? done.nationId} puso en marcha una fábrica de armas en ${world.provinceById.get(done.provinceId)?.name ?? done.provinceId} (era ${done.era}). +1% ataque a sus soldados.`,
        nationIds: [done.nationId],
      });
    } else if (done.kind === "carreta") {
      // N carretas al pool del establo niv.3 (el reparto a grupos va en resolveTurn).
      const qty = done.quantity ?? 1;
      const stable = aserraderos.find(
        (a) => a.nationId === done.nationId && a.provinceId === done.provinceId && a.activa,
      );
      if (stable) stable.carts = (stable.carts ?? 0) + qty;
      events.push({
        id: `event-carreta-built-${done.id}`,
        month: nextMonth,
        kind: "construction",
        title: "🛒 Carretas fabricadas",
        description: `${nation?.name ?? done.nationId} fabricó ${qty} carreta${qty > 1 ? "s" : ""} en ${world.provinceById.get(done.provinceId)?.name ?? done.provinceId} (50 a pie c/u).`,
        nationIds: [done.nationId],
      });
    }
  }

  // Mantención de edificios terminados (barracks/stable/fábrica/ciudad/reino vía
  // proyectos; minas/aserraderos pagan en el loop de producción).
  // Sin fondos: proyectos sin mantener pierden buffs hasta pagar.
  const maintenance = getLiveMaintenanceCosts();
  const unmaintained: string[] = [];
  const maintenancePaidNations = new Set<string>();
  for (const nation of world.nations) {
    if (!isNationActive(world, nation.id)) continue;
    const complete = projects.filter((p) => p.nationId === nation.id && p.status === "complete"
      && (p.kind === "barracks" || p.kind === "stable" || p.kind === "fabrica_armas" || p.kind === "ciudad" || p.kind === "reino"));
    let due = 0;
    for (const p of complete) due += maintenance[p.kind] ?? 0;
    const stock = stockpiles[nation.id];
    if (due <= 0 || (stock && stock.gold >= due)) {
      if (stock && due > 0) stock.gold -= due;
      maintenancePaidNations.add(nation.id);
      continue;
    }
    for (const p of complete) unmaintained.push(p.id);
    if (!recentEvent((e) => e.id === `event-maintenance-unpaid-${nation.id}`, 6)) {
      events.push({
        id: `event-maintenance-unpaid-${nation.id}`,
        month: nextMonth,
        kind: "construction",
        title: "🔧 Sin mantenimiento",
        description: `${nation.name} no pudo pagar ${Math.round(due)} oro de mantención: sus edificios pierden buffs hasta pagar.`,
        nationIds: [nation.id],
      });
    }
  }
  for (const fabrica of fabricasArmas) {
    fabrica.activa = maintenancePaidNations.has(fabrica.nationId);
  }
  for (const reino of reinos) {
    reino.activo = maintenancePaidNations.has(reino.nationId);
  }

  return { projects, stockpiles, eraState: nextEraState, events, minasDeCarbon, aserraderos, minasDeHierro, granjas, pozos, fabricasArmas, reinos, unmaintainedProjects: unmaintained, completedCount: progressed.completed.length };
}

/** Comercio de carretas decidido por la IA según necesidad (interno + externo). */
export function advanceCartTrade(args: {
  world: World;
  military: MilitaryState;
  stockpiles: Record<string, NationStockpile>;
  aserraderos: Aserradero[];
  policies: Record<string, NationPolicyState>;
  shipments: Shipment[];
  offers: CartOffer[];
  diplomacy: { wars: Array<{ attackerNationId: string; defenderNationId: string }> };
  nationRelations: NationRelations;
  nextMonth: number;
}): { shipments: Shipment[]; offers: CartOffer[]; events: GameEvent[] } {
  const { world, military, stockpiles, aserraderos, policies, diplomacy, nextMonth } = args;
  let shipments = [...args.shipments];
  let offers = [...args.offers];
  const events: GameEvent[] = [];
  void args.nationRelations;
  const nameOf = (id: string): string => world.nationById.get(id)?.name ?? id;
  const provinceName = (id: string): string => world.provinceById.get(id)?.name ?? id;
  const atWar = (a: string, b: string): boolean =>
    diplomacy.wars.some((w) =>
      (w.attackerNationId === a && w.defenderNationId === b) ||
      (w.attackerNationId === b && w.defenderNationId === a),
    );
  const activeStables = (nationId: string): Aserradero[] =>
    aserraderos.filter((a) => a.nationId === nationId && a.activa);
  const poolOf = (nationId: string, provinceId: string): Aserradero | undefined =>
    activeStables(nationId).find((a) => a.provinceId === provinceId && (a.carts ?? 0) > 0);
  const groupsOf = (nationId: string) => military[nationId]?.armyGroups ?? [];
  const unmetNeed = (nationId: string): number => {
    const pools = activeStables(nationId).reduce((s, a) => s + (a.carts ?? 0), 0);
    const need = groupsOf(nationId).reduce((s, g) => s + cartsNeededForUnits(g.units, g.carts ?? 0), 0);
    return Math.max(0, need - pools);
  };
  const dropLoot = (provinceId: string, n: number): void => {
    if (n <= 0) return;
    const tile = world.tiles.find((t) => t.provinceId === provinceId);
    if (tile) tile.lostCarts = (tile.lostCarts ?? 0) + n;
  };

  // 1. Expiran ofertas viejas.
  offers = offers.filter((o) => o.expiresMonth >= nextMonth);

  // 2. Llegadas.
  const pending: Shipment[] = [];
  for (const s of shipments) {
    if (s.arrivesMonth > nextMonth) {
      pending.push(s);
      continue;
    }
    if (s.pricePerCart > 0) {
      // Externa: el comprador paga al recibir (o se devuelve).
      const buyer = stockpiles[s.toNationId ?? ""];
      const total = s.carts * s.pricePerCart;
      const sellerName = nameOf(s.nationId);
      if (buyer && buyer.gold >= total) {
        buyer.gold -= total;
        const seller = stockpiles[s.nationId];
        if (seller) seller.gold += total;
        const dest = (s.toNationId && poolStableOf(s.toNationId, s.toProvinceId)) ?? firstStable(s.toNationId ?? "");
        if (dest) {
          dest.carts = (dest.carts ?? 0) + s.carts;
          events.push(marketEvent(`event-cart-arrived-${s.id}`, `${sellerName} entregó ${s.carts} carretas a ${nameOf(s.toNationId ?? "")} en ${provinceName(s.toProvinceId)} por ${total} oro.`, [s.nationId, s.toNationId ?? ""]));
        } else {
          returnToSeller(s);
          events.push(marketEvent(`event-cart-nodest-${s.id}`, `${nameOf(s.toNationId ?? "")} pagó ${total} oro pero no tiene establo: las ${s.carts} carretas volvieron a ${sellerName}.`, [s.nationId, s.toNationId ?? ""]));
        }
      } else {
        returnToSeller(s);
        events.push(marketEvent(`event-cart-unpaid-${s.id}`, `${nameOf(s.toNationId ?? "")} no pudo pagar ${total} oro: las ${s.carts} carretas volvieron a ${nameOf(s.nationId)}.`, [s.nationId, s.toNationId ?? ""]));
      }
    } else {
      // Interna: al pool destino (o de vuelta al origen).
      const dest = poolStableOf(s.nationId, s.toProvinceId) ?? activeStables(s.nationId).find((a) => a.provinceId === s.toProvinceId);
      if (dest) {
        dest.carts = (dest.carts ?? 0) + s.carts;
        events.push(marketEvent(`event-cart-arrived-${s.id}`, `${nameOf(s.nationId)} recibió ${s.carts} carretas en ${provinceName(s.toProvinceId)}.`, [s.nationId]));
      } else {
        const back = firstStable(s.nationId);
        if (back) back.carts = (back.carts ?? 0) + s.carts;
        else dropLoot(s.toProvinceId, s.carts);
        events.push(marketEvent(`event-cart-lostdest-${s.id}`, `${nameOf(s.nationId)} perdió el destino de ${s.carts} carretas: volvieron al pool.`, [s.nationId]));
      }
    }
  }
  shipments = pending;

  function marketEvent(id: string, description: string, nationIds: string[]): GameEvent {
    return { id, month: nextMonth, kind: "market", title: "🛒 Comercio de carretas", description, nationIds };
  }
  function poolStableOf(nationId: string, provinceId: string): Aserradero | undefined {
    return activeStables(nationId).find((a) => a.provinceId === provinceId);
  }
  function firstStable(nationId: string): Aserradero | undefined {
    return activeStables(nationId)[0];
  }
  function returnToSeller(s: Shipment): void {
    const back = firstStable(s.nationId);
    if (back) back.carts = (back.carts ?? 0) + s.carts;
    else dropLoot(s.fromProvinceId, s.carts);
  }

  // 3. Nuevos traslados internos (decisión IA explícita o motor por necesidad).
  for (const nation of world.nations) {
    if (!isNationActive(world, nation.id)) continue;
    const explicit = (policies[nation.id] as unknown as { cartMove?: { fromProvinceId: string; toProvinceId: string; carts: number } } | undefined)?.cartMove;
    if (explicit) {
      const from = world.provinceById.get(explicit.fromProvinceId);
      const to = world.provinceById.get(explicit.toProvinceId);
      const src = poolOf(nation.id, explicit.fromProvinceId);
      const problem = validateCartMove({
        ownSource: from?.nationId === nation.id,
        ownDest: to?.nationId === nation.id,
        pool: src ? (src.carts ?? 0) : 0,
        carts: explicit.carts,
        gold: stockpiles[nation.id]?.gold ?? 0,
      });
      if (!problem && src && to) {
        const n = Math.floor(explicit.carts);
        src.carts = (src.carts ?? 0) - n;
        const stock = stockpiles[nation.id];
        if (stock) stock.gold -= n * CART_INTERNAL_COST_GOLD;
        const hops = provinceHops(world, explicit.fromProvinceId, explicit.toProvinceId);
        shipments.push({
          id: `ship-${nation.id}-${explicit.fromProvinceId}-${explicit.toProvinceId}-${nextMonth}`,
          nationId: nation.id,
          fromProvinceId: explicit.fromProvinceId,
          toProvinceId: explicit.toProvinceId,
          carts: n,
          departsMonth: nextMonth,
          arrivesMonth: nextMonth + shipmentTravelMonths(Number.isFinite(hops) ? hops : 6),
          pricePerCart: 0,
        });
        events.push(marketEvent(`event-cart-sent-${nation.id}-${nextMonth}`, `${nameOf(nation.id)} envió ${n} carretas de ${provinceName(explicit.fromProvinceId)} a ${provinceName(explicit.toProvinceId)}.`, [nation.id]));
      }
      continue;
    }
    // Motor por necesidad: del pool con más sobrante a la provincia con más necesidad.
    const stock = stockpiles[nation.id];
    if (!stock) continue;
    type Surplus = { stable: Aserradero; extra: number };
    const surplus: Surplus[] = activeStables(nation.id)
      .map((a) => ({ stable: a, extra: (a.carts ?? 0) - provinceCartNeed(groupsOf(nation.id), a.provinceId) }))
      .filter((s) => s.extra > 0)
      .sort((a, b) => b.extra - a.extra);
    const needy = world.provinces
      .filter((p) => p.nationId === nation.id && poolStableOf(nation.id, p.id) !== undefined)
      .map((p) => ({ p, need: provinceCartNeed(groupsOf(nation.id), p.id) }))
      .filter((x) => x.need > 0)
      .sort((a, b) => b.need - a.need);
    for (const sink of needy) {
      // El sobrante local lo cubre el reparto (paso 6): solo se envía entre provincias.
      const src = surplus.find((s) => s.extra > 0 && s.stable.provinceId !== sink.p.id);
      if (!src) break;
      const n = Math.min(sink.need, src.extra, Math.floor(stock.gold / CART_INTERNAL_COST_GOLD));
      if (n < 1) break;
      src.extra -= n;
      src.stable.carts = (src.stable.carts ?? 0) - n;
      stock.gold -= n * CART_INTERNAL_COST_GOLD;
      const hops = provinceHops(world, src.stable.provinceId, sink.p.id);
      shipments.push({
        id: `ship-${nation.id}-${src.stable.provinceId}-${sink.p.id}-${nextMonth}`,
        nationId: nation.id,
        fromProvinceId: src.stable.provinceId,
        toProvinceId: sink.p.id,
        carts: n,
        departsMonth: nextMonth,
        arrivesMonth: nextMonth + shipmentTravelMonths(Number.isFinite(hops) ? hops : 6),
        pricePerCart: 0,
      });
      events.push(marketEvent(`event-cart-sent-${nation.id}-${sink.p.id}-${nextMonth}`, `${nameOf(nation.id)} envió ${n} carretas de ${provinceName(src.stable.provinceId)} a ${provinceName(sink.p.id)}.`, [nation.id]));
    }
  }

  // 4. Ofertas externas (IA explícita o motor por necesidad: sobrante + falta oro).
  for (const nation of world.nations) {
    if (!isNationActive(world, nation.id)) continue;
    const explicit = (policies[nation.id] as unknown as { cartOffer?: { targetNationId: string; carts: number; pricePerCart: number } } | undefined)?.cartOffer;
    const makeOffer = (targetId: string, carts: number, price: number): void => {
      const target = world.nationById.get(targetId);
      const poolTotal = activeStables(nation.id).reduce((s, a) => s + (a.carts ?? 0), 0);
      const problem = validateCartOffer({
        sellerPool: poolTotal,
        carts: Math.floor(carts),
        pricePerCart: price,
        targetOk: !!target && targetId !== nation.id && isNationActive(world, targetId) && !atWar(nation.id, targetId),
        duplicate: offers.some((o) => o.sellerNationId === nation.id && o.targetNationId === targetId),
      });
      if (problem) return;
      offers.push({
        id: `offer-${nation.id}-${targetId}-${nextMonth}`,
        sellerNationId: nation.id,
        targetNationId: targetId,
        carts: Math.floor(carts),
        pricePerCart: Math.floor(price),
        createdMonth: nextMonth,
        expiresMonth: nextMonth + 6,
      });
      events.push(marketEvent(`event-cart-offer-${nation.id}-${targetId}-${nextMonth}`, `${nameOf(nation.id)} ofrece ${Math.floor(carts)} carretas a ${nameOf(targetId)} por ${Math.floor(price)} oro c/u.`, [nation.id, targetId]));
    };
    if (explicit) {
      makeOffer(explicit.targetNationId, explicit.carts, explicit.pricePerCart);
      continue;
    }
    // Motor: vende sobrante si le falta oro.
    const stock = stockpiles[nation.id];
    if (!stock || stock.gold >= 1000) continue;
    const surplusTotal = activeStables(nation.id).reduce((s, a) => s + (a.carts ?? 0), 0) -
      groupsOf(nation.id).reduce((s, g) => s + cartsNeededForUnits(g.units, g.carts ?? 0), 0) - 2;
    if (surplusTotal < 1) continue;
    const buyer = world.nations
      .filter((n) => n.id !== nation.id && isNationActive(world, n.id) && !atWar(nation.id, n.id))
      .map((n) => ({ n, need: unmetNeed(n.id) }))
      .filter((x) => x.need > 0)
      .sort((a, b) => b.need - a.need)[0];
    if (buyer) makeOffer(buyer.n.id, Math.min(surplusTotal, buyer.need), 3);
  }

  // 5. Aceptaciones (IA explícita o motor por necesidad).
  for (const nation of world.nations) {
    if (!isNationActive(world, nation.id)) continue;
    const incoming = offers
      .filter((o) => o.targetNationId === nation.id && isNationActive(world, o.sellerNationId) && !atWar(nation.id, o.sellerNationId))
      .sort((a, b) => a.pricePerCart - b.pricePerCart);
    if (incoming.length === 0) continue;
    const explicitId = (policies[nation.id] as unknown as { acceptCartOfferId?: string } | undefined)?.acceptCartOfferId;
    const chosen = explicitId ? incoming.find((o) => o.id === explicitId) : undefined;
    const accept = (o: (typeof incoming)[number]): void => {
      const stock = stockpiles[nation.id];
      const total = o.carts * o.pricePerCart;
      if (!stock || stock.gold - total < 100) return;
      const src = activeStables(o.sellerNationId)
        .filter((a) => (a.carts ?? 0) > 0)
        .sort((a, b) => (b.carts ?? 0) - (a.carts ?? 0))[0];
      if (!src || (src.carts ?? 0) < o.carts) return;
      src.carts = (src.carts ?? 0) - o.carts;
      offers = offers.filter((x) => x.id !== o.id);
      // Destino: estable del comprador en la provincia con más necesidad.
      const needy = world.provinces
        .filter((p) => p.nationId === nation.id && poolStableOf(nation.id, p.id) !== undefined)
        .map((p) => ({ id: p.id, need: provinceCartNeed(groupsOf(nation.id), p.id) }))
        .sort((a, b) => b.need - a.need)[0];
      const destProvince = needy && needy.need > 0 ? needy.id : (firstStable(nation.id)?.provinceId ?? "");
      const hops = provinceHops(world, src.provinceId, destProvince);
      shipments.push({
        id: `ship-${o.sellerNationId}-${nation.id}-${nextMonth}`,
        nationId: o.sellerNationId,
        fromProvinceId: src.provinceId,
        toProvinceId: destProvince,
        toNationId: nation.id,
        carts: o.carts,
        departsMonth: nextMonth,
        arrivesMonth: nextMonth + shipmentTravelMonths(Number.isFinite(hops) ? hops : 6),
        pricePerCart: o.pricePerCart,
      });
      events.push(marketEvent(`event-cart-accept-${o.id}`, `${nameOf(nation.id)} aceptó ${o.carts} carretas de ${nameOf(o.sellerNationId)} por ${total} oro al recibir.`, [nation.id, o.sellerNationId]));
    };
    if (chosen) {
      accept(chosen);
      continue;
    }
    if (explicitId) continue;
    // Motor: acepta la más barata si hay necesidad real y caja con colchón.
    const need = unmetNeed(nation.id);
    if (need < 1) continue;
    for (const o of incoming) {
      if (o.pricePerCart > 6) continue;
      const total = o.carts * o.pricePerCart;
      if ((stockpiles[nation.id]?.gold ?? 0) - total < 100) continue;
      accept(o);
      break;
    }
  }

  // 6. Reparto pool → grupos (chicos primero) + convoy.
  for (const nation of world.nations) {
    if (!isNationActive(world, nation.id)) continue;
    const groups = groupsOf(nation.id)
      .slice()
      .sort((a, b) => (a.units.militia + a.units.infantry + a.units.levy) - (b.units.militia + b.units.infantry + b.units.levy));
    for (const g of groups) {
      const need = cartsNeededForUnits(g.units, g.carts ?? 0);
      if (need < 1) {
        if ((g.carts ?? 0) >= 2) g.convoy = true;
        continue;
      }
      const pool = poolOf(nation.id, g.locationProvinceId);
      if (!pool) continue;
      const take = Math.min(need, pool.carts ?? 0);
      if (take < 1) continue;
      pool.carts = (pool.carts ?? 0) - take;
      const wasConvoy = g.convoy ?? (g.carts ?? 0) >= 2;
      g.carts = (g.carts ?? 0) + take;
      g.convoy = g.carts >= 2;
      if (g.convoy && !wasConvoy) {
        events.push(marketEvent(`event-convoy-${g.id}-${nextMonth}`, `${nameOf(nation.id)} formó convoy (${g.carts} carretas) en ${provinceName(g.locationProvinceId)}.`, [nation.id]));
      }
    }
  }

  // 7. Mantención madera (10 por carreta): impagas se pierden y caen como botín.
  for (const nation of world.nations) {
    if (!isNationActive(world, nation.id)) continue;
    const stock = stockpiles[nation.id];
    if (!stock) continue;
    const pools = activeStables(nation.id).filter((a) => (a.carts ?? 0) > 0);
    const cartsGroups = groupsOf(nation.id).filter((g) => (g.carts ?? 0) > 0);
    const total = pools.reduce((s, a) => s + (a.carts ?? 0), 0) + cartsGroups.reduce((s, g) => s + (g.carts ?? 0), 0);
    if (total < 1) continue;
    const timber = stock.resources.timber ?? 0;
    const keep = Math.min(total, Math.floor(timber / CART_UPKEEP_WOOD));
    stock.resources.timber = timber - keep * CART_UPKEEP_WOOD;
    let toLose = total - keep;
    if (toLose > 0) {
      for (const a of pools) {
        if (toLose < 1) break;
        const lose = Math.min(toLose, a.carts ?? 0);
        a.carts = (a.carts ?? 0) - lose;
        toLose -= lose;
        const tile = a.x !== undefined ? world.tiles.find((t) => t.x === a.x && t.y === a.y) : world.tiles.find((t) => t.provinceId === a.provinceId);
        if (tile) tile.lostCarts = (tile.lostCarts ?? 0) + lose;
      }
      for (const g of cartsGroups) {
        if (toLose < 1) break;
        const lose = Math.min(toLose, g.carts ?? 0);
        g.carts = (g.carts ?? 0) - lose;
        if ((g.carts ?? 0) < 2) g.convoy = false;
        toLose -= lose;
        dropLoot(g.locationProvinceId, lose);
      }
      events.push(marketEvent(`event-carts-lost-${nation.id}-${nextMonth}`, `${nameOf(nation.id)} perdió ${total - keep} carretas por falta de madera (botín en el suelo).`, [nation.id]));
    }
  }

  return { shipments, offers, events };
}

export function resolveTurn(world: World, current: SimulationState, nextMonth: number, lang?: EventLang): SimulationState {
  const currentMonth = current.elapsedMonths;
  const nationStockpiles = settleNationStockpiles(world, current.nationStockpiles, 1);
  const nationPolicies = advanceNationPolicies(world, current.nationRelations, nationStockpiles, current.nationPolicies, currentMonth, nextMonth, current.eraState);
  // Edificios terminados hasta el turno pasado (cuarteles/establos gatean y buffean).
  // Sin mantención pagada pierden buffs.
  const provinceBuildings = indexProvinceBuildings(current.constructionProjects, new Set(current.unmaintainedProjects ?? []));
  // Niveles de establo por provincia (para el slot 4 de caballería).
  const stableLevels: Record<string, number> = {};
  for (const a of [...current.aserraderos]) {
    if (!a.activa) continue;
    stableLevels[a.provinceId] = Math.max(stableLevels[a.provinceId] ?? 0, a.nivel ?? 1);
  }
  const militaryEconomy = advanceMilitaryEconomy(world, current.military, nationStockpiles, nationPolicies, current.diplomacy, nextMonth, 1, provinceBuildings, stableLevels, lang);
  const spyUpdate = advanceSpyNetwork(current.spies, nationPolicies, current.nationRelations, world, nextMonth);
  const execution = executeDiplomacyPoliciesWithEvents(current.diplomacy, nationPolicies, world, nextMonth);
  const evaluation = evaluateDiplomaticProposalsWithEvents(execution.diplomacy, world, spyUpdate.relations, nextMonth);
  const peacefulResult = executePeacefulExpansion(world, nationPolicies, nationStockpiles, nextMonth, provinceBuildings, current.eraState, lang);
  const peacefulEvents = peacefulResult.events;
  const peacefulMapChanged = peacefulResult.mapChanged;
  // Órdenes LLM one-shot de ejército (se consumen este turno).
  const armyOrdersByNation: Record<string, LlmArmyOrders | undefined> = {};
  for (const nation of world.nations) {
    const sidecar = nationPolicies[nation.id] as unknown as { musterOrders?: MusterOrder[]; moveOrders?: MoveOrder[] } | undefined;
    if (sidecar?.musterOrders !== undefined || sidecar?.moveOrders !== undefined) {
      armyOrdersByNation[nation.id] = { muster: sidecar.musterOrders, move: sidecar.moveOrders };
      sidecar.musterOrders = undefined;
      sidecar.moveOrders = undefined;
    }
  }
  const movementUpdate = advanceArmyGroups(world, evaluation.diplomacy, militaryEconomy.military, nextMonth, militaryEconomy.stockpiles, provinceBuildings, lang, armyOrdersByNation);
  const warUpdate = advanceWarSystem(world, evaluation.diplomacy, movementUpdate.military, spyUpdate.relations, spyUpdate.spyNetwork, militaryEconomy.stockpiles, nextMonth, indexFabricas(current.fabricasArmas ?? []), {
    minasDeCarbon: current.minasDeCarbon ?? [],
    minasDeHierro: current.minasDeHierro ?? [],
    aserraderos: current.aserraderos ?? [],
    granjas: current.granjas ?? [],
    pozos: current.pozos ?? [],
    reinos: current.reinos ?? [],
    projects: current.constructionProjects ?? [],
  }, nationPolicies, lang);
  applyPopulationDynamics(world, warUpdate.diplomacy, nextMonth, current.eraState, warUpdate.military);

  let updatedMilitary = warUpdate.military;
  const deserterUpdate = handleDeserters(world, updatedMilitary, nextMonth);
  updatedMilitary = deserterUpdate.military;

  const constructionUpdate = advanceConstruction(
    world,
    current,
    nationPolicies,
    warUpdate.stockpiles,
    current.eraState,
    nextMonth,
  );

  // ==== PRODUCCIÓN Y MANTENIMIENTO DE MINAS Y ASERRADEROS ====
  // Producción = 100 × curva de era × (1 + bonus de era). Mantención viva.
  const updatedMinas = [...constructionUpdate.minasDeCarbon];
  const updatedAserraderos = [...constructionUpdate.aserraderos];
  const updatedMinasHierro = [...constructionUpdate.minasDeHierro];
  const updatedGranjas = [...(constructionUpdate.granjas ?? [])];
  const updatedPozos = [...(constructionUpdate.pozos ?? [])];
  const updatedFabricas = [...constructionUpdate.fabricasArmas];
  const updatedReinos = [...(constructionUpdate.reinos ?? [])];
  const updatedStockpiles = { ...constructionUpdate.stockpiles };
  const liveMaintenance = getLiveMaintenanceCosts();

  const produceInstallation = (
    mina: { nationId: string; activa: boolean },
    resource: "coal" | "timber" | "iron",
    maintKind: ConstructionKind,
  ): void => {
    if (!mina.activa) return;
    const nationStockpile = updatedStockpiles[mina.nationId];
    if (!nationStockpile) return;
    const eraActual = getNationEra(mina.nationId, constructionUpdate.eraState);
    const curve = ERA_CONFIGS[eraActual]?.unitFactor ?? 1.0;
    const produccion = Math.floor(100 * curve * (1 + eraProductionBonus(eraActual)));
    const costoMantenimiento = liveMaintenance[maintKind] ?? 0;
    if (nationStockpile.gold < costoMantenimiento) {
      (mina as { activa: boolean }).activa = false;
      return;
    }
    nationStockpile.gold -= costoMantenimiento;
    nationStockpile.resources[resource] = (nationStockpile.resources[resource] ?? 0) + produccion;
  };

  // Produce minas de carbón
  for (const mina of updatedMinas) {
    produceInstallation(mina, "coal", "mina_carbon");
  }

  // Produce aserraderos
  for (const aserradero of updatedAserraderos) {
    produceInstallation(aserradero, "timber", "aserradero");
  }

  // Produce minas de hierro
  for (const mina of updatedMinasHierro) {
    produceInstallation(mina, "iron", "mina_hierro");
  }

  // Producen granjas (grano 4/nivel, mantención viva)
  for (const granja of updatedGranjas) {
    if (!granja.activa) continue;
    const stock = updatedStockpiles[granja.nationId];
    if (!stock) continue;
    const costo = liveMaintenance.granja ?? 1;
    if (stock.gold < costo) {
      granja.activa = false;
      continue;
    }
    stock.gold -= costo;
    stock.resources.grain = (stock.resources.grain ?? 0) + granjaOutput(granja.nivel ?? 1);
  }

  // Producen pozos (agua 30/nivel, mantención viva)
  for (const pozo of updatedPozos) {
    if (!pozo.activa) continue;
    const stock = updatedStockpiles[pozo.nationId];
    if (!stock) continue;
    const costo = liveMaintenance.pozo ?? 1;
    if (stock.gold < costo) {
      pozo.activa = false;
      continue;
    }
    stock.gold -= costo;
    stock.water = (stock.water ?? 0) + pozoOutput(pozo.nivel ?? 1);
  }
  // ================================================================

  // ==== COMERCIO DE CARRETAS (decisión IA por necesidad) ====
  const cartUpdate = advanceCartTrade({
    world,
    military: updatedMilitary,
    stockpiles: updatedStockpiles,
    aserraderos: updatedAserraderos,
    policies: nationPolicies,
    shipments: current.cartShipments ?? [],
    offers: current.cartOffers ?? [],
    diplomacy: warUpdate.diplomacy,
    nationRelations: warUpdate.relations,
    nextMonth,
  });

  const marketEndResult = executeTransactions(current.marketState, nextMonth, lang);

  const newEvents = [
    ...taggedEvents(militaryEconomy.events, "militaryEconomy"),
    ...taggedEvents(spyUpdate.events, "spyUpdate"),
    ...taggedEvents(execution.events, "diplomacyExecution"),
    ...taggedEvents(evaluation.events, "diplomacyEvaluation"),
    ...taggedEvents(movementUpdate.events, "warMovement"),
    ...taggedEvents(warUpdate.events, "warSystem"),
    ...taggedEvents(peacefulEvents, "peacefulExpansion"),
    ...taggedEvents(deserterUpdate.events, "deserters"),
    ...taggedEvents(constructionUpdate.events, "construction"),
    ...taggedEvents(cartUpdate.events, "cartTrade"),
    ...taggedEvents(marketEndResult.events, "market"),
  ];

  const marketState = marketEndResult.marketState;

  const newDefeatedNations = collectDefeatedNationRecords(current.defeatedNations, newEvents);
  const gameOver = current.gameOver ?? (() => {
    const victorNationId = checkDominationVictory(world);
    if (!victorNationId) {
      return undefined;
    }
    const { shares } = getDomination(world);
    const victoryEvent: GameEvent = {
      id: `event-domination-victory-${victorNationId}-${nextMonth}`,
      month: nextMonth,
      kind: "nation_defeated",
      title: ev(lang, "World Dominated", "Mundo Dominado"),
      description: ev(lang,
        `${world.nationById.get(victorNationId)?.name ?? victorNationId} dominates ${Math.round((shares[victorNationId] ?? 0) * 100)}% of claimed land and wins the game.`,
        `${world.nationById.get(victorNationId)?.nameEs ?? world.nationById.get(victorNationId)?.name ?? victorNationId} domina el ${Math.round((shares[victorNationId] ?? 0) * 100)}% de la tierra reclamada y gana el juego.`),
      nationIds: [victorNationId],
      source: "domination",
      ...(lang ? { lang } : {}),
    };
    newEvents.push(victoryEvent);
    return { victorNationId, month: nextMonth, share: shares[victorNationId] ?? 0 };
  })();
  logTurnToDisk(world, warUpdate.diplomacy, newEvents, nextMonth, gameOver);
  void flushLogs();
  return {
    defeatedNations: newDefeatedNations,
    diplomacy: warUpdate.diplomacy,
    elapsedMonths: nextMonth,
    events: [...current.events, ...newEvents],
    mapRevision: current.mapRevision + (warUpdate.mapChanged || movementUpdate.mapChanged || peacefulMapChanged || constructionUpdate.completedCount > 0 ? 1 : 0),
    military: updatedMilitary,
    nationPolicies,
    nationRelations: warUpdate.relations,
    nationStockpiles: updatedStockpiles,
    spies: spyUpdate.spyNetwork,
    marketState,
    hungerState: current.hungerState,
    eraState: constructionUpdate.eraState,
    constructionProjects: constructionUpdate.projects,
    minasDeCarbon: updatedMinas,
    aserraderos: updatedAserraderos,
    minasDeHierro: updatedMinasHierro,
    granjas: updatedGranjas,
    pozos: updatedPozos,
    fabricasArmas: updatedFabricas,
    reinos: updatedReinos,
    cartShipments: cartUpdate.shipments,
    cartOffers: cartUpdate.offers,
    unmaintainedProjects: constructionUpdate.unmaintainedProjects,
    chatLog: current.chatLog,
    currencyState: current.currencyState,
    gameOver,
  };
}

/** Resumen del turno + espejo de eventos al log de disco (para tail -f). */
function logTurnToDisk(
  world: World,
  diplomacy: ReturnType<typeof buildInitialDiplomacyState>,
  newEvents: GameEvent[],
  nextMonth: number,
  gameOver: GameOverRecord | undefined,
): void {
  const counts = new Map<string, number>();
  for (const event of newEvents) {
    counts.set(event.kind, (counts.get(event.kind) ?? 0) + 1);
  }
  const kinds = [...counts.entries()].map(([kind, count]) => `${kind}×${count}`).join(", ");
  const log = debug.tag("turno");
  log.info(`mes ${nextMonth}: ${newEvents.length} eventos (${kinds || "sin eventos"}) · guerras activas ${diplomacy.wars.length}${gameOver ? ` · GAME OVER: ${world.nationById.get(gameOver.victorNationId)?.name ?? gameOver.victorNationId}` : ""}`);
  for (const event of newEvents) {
    debug.tag("evento").info(`[M${event.month}] ${event.kind} — ${event.title}: ${event.description}`);
  }
}

function collectDefeatedNationRecords(  currentRecords: Record<string, DefeatedNationRecord>,
  events: GameEvent[],
) {
  let records = currentRecords;
  for (const event of events) {
    if (event.kind !== "nation_defeated" || event.nationIds.length < 2) {
      continue;
    }
    const [victorNationId, defeatedNationId] = event.nationIds;
    if (records[defeatedNationId]) {
      continue;
    }
    records = {
      ...records,
      [defeatedNationId]: { defeatedAtMonth: event.month, defeatedNationId, victorNationId },
    };
  }
  return records;
}
