import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import pkg from "../package.json";
import { type MapMode, WorldMap } from "./components/WorldMap";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { debug } from "./world/debugLog";
import { loadNationModelConfigs, fetchServerConfigs, saveNationModelConfigs, type NationModelConfigs } from "./world/modelConfig";
import { getModelIconForConfig } from "./resources/modelIcons";
import { ConnectionMonitor } from "./world/connectionMonitor";
import { OfflineOverlay } from "./components/OfflineOverlay";
import { MainMenu, DEFAULT_FREE_PROVINCE_RATIO, type NewGameSettings } from "./components/MainMenu";
import { LanguageSelector } from "./components/LanguageSelector";
import { NationModelConfiguration } from "./components/NationModelConfiguration";
import { buildDemoWorld, countCitiesByTipo } from "./world/buildDemoWorld";
import { calculateCityEconomy, calculateNationCityEconomy } from "./world/cityEconomy";
import { formatDecimal, formatInteger, formatPopulation } from "./world/formatPopulation";
import {
  evaluateDiplomaticProposalsWithEvents,
  executeDiplomacyPoliciesWithEvents,
  formatProposalType,
  getNationDiplomacySummary,
  getOtherTreatyNationId,
  type NationDiplomacySummary,
} from "./world/diplomacy";
import { addYield, formatResourceName, getTileMonthlyYield, type ResourceTotals } from "./world/economy";
import {
  sortEventsNewestFirst,
  filterEventsForNation,
  type GameEvent,
} from "./world/events";
import {
  getEventCacheKey,
  isCombatEventKind,
  isDiplomacyEventKind,
  isExpansionEventKind,
  isIngenieriaEventKind,
  isLogisticsEventKind,
  isSpyEventKind,
  type GuerraSubTab,
  type GeneralSubTab,
  type TopEventTab,
} from "./world/eventCategories";
import { formatConstructionBudget, getBuildingConfigRows, getEraConfigTable, type ConstructionProject, type MinaDeCarbon, type Aserradero } from "./world/construction";
import {
  BUILDING_LIST,
  ERA_LIST,
  BUILDING_LABELS,
  ERA_LABELS,
  type ConstructionKind,
} from "./world/configDefaults";
import {
  getLiveBaseCosts,
  getLiveMaintenanceCosts,
  setLiveBaseCosts,
  setLiveMaintenanceCosts,
} from "./world/constructionConfig";
import { getLiveDensity, setLiveDensity } from "./world/density";
import type { MarketOffer, MarketState, Transaction } from "./world/market";
import {
  advanceNationPolicies,
  type NationPolicyState,
} from "./world/policyAI";
import {
  getAttitudeLabel,
  getNationRelationsFor,
  otherNationId,
  type NationRelation,
  type NationRelations,
} from "./world/relationships";
import {
  calculateNationMonthlyIncome,
  getEraVitalityRows,
  type NationStockpile,
} from "./world/settlement";
import {
  advanceSpyNetwork,
  formatSpyMissionPolicy,
  getNationSpySummary,
  type NationSpySummary,
  type SpyNetwork,
} from "./world/spies";
import type { City, Nation, Resource, Terrain, Tile } from "./world/types";
import {
  getAllArmyGroups,
  getNationWarSummary,
  unitStats,
  unitTypes,
  type ArmyStance,
  type ArmyUnits,
  type MilitaryState,
  type NationWarSummary,
} from "./world/war";
import {
  advanceSimulationTurn,
  createInitialSimulationState,
  type SimulationState,
  type DefeatedNationRecord,
  type TurnProgress,
} from "./world/turnSimulation";
import {
  formatEraEmoji,
  formatEraLabel,
  getNationEra,
  type EraState,
} from "./world/era";
import {
  buildEventDocs,
  buildNationDocs,
  buildNationMonthlyDocs,
  buildWorldMonthlyDoc,
  mongoNewRun,
  mongoSendTurn,
  type MongoRunCtx,
} from "./world/mongoSync";
import { createLLMExecutor } from "./world/llmExecutor";
import { isNationDefeated } from "./world/nationStatus";
import { localizeText, type Language } from "./world/localization";

debug.installGlobalHandlers();
debug.time("app:buildDemoWorld inicial");
let world = buildDemoWorld("observer-world-001", { freeProvinceRatio: DEFAULT_FREE_PROVINCE_RATIO });
debug.timeEnd("app:buildDemoWorld inicial");
const mapModes: { id: MapMode; label: string }[] = [
  { id: "political", label: "Political" },
  { id: "terrain", label: "Terrain" },
  { id: "resources", label: "Resources" },
];
const speedOptions = [1, 2, 5] as const;
type SimulationSpeed = (typeof speedOptions)[number];
type AppSurface = "configuration" | "menu" | "world";

function buildAppShellClassName(isPanelOpen: boolean, isEventPanelOpen: boolean) {
  return [
    "appShell",
    isPanelOpen ? "" : "panelCollapsed",
    isEventPanelOpen ? "eventPanelOpen" : "eventPanelCollapsed",
  ]
    .filter(Boolean)
    .join(" ");
}

export default function App() {
  const appRootRef = useRef<HTMLElement>(null);
  const [language, setLanguage] = useState<Language>("es");
  const [activeSurface, setActiveSurface] = useState<AppSurface>("menu");
  const [worldRevision, setWorldRevision] = useState(0);
  const [mapMode, setMapMode] = useState<MapMode>("political");
  const [isRunning, setIsRunning] = useState(false);
  const [speed, setSpeed] = useState<SimulationSpeed>(1);
  const [eventLogMode, setEventLogMode] = useState<TopEventTab>("general");
  const [generalSub, setGeneralSub] = useState<GeneralSubTab>("todo");
  const [guerraSub, setGuerraSub] = useState<GuerraSubTab>("todos");
  const [eventNationId, setEventNationId] = useState<string | undefined>();
  const [isEventPanelOpen, setIsEventPanelOpen] = useState(true);
  const [isPanelOpen, setIsPanelOpen] = useState(true);
  const [dismissVictory, setDismissVictory] = useState(false);
  const [configMode, setConfigMode] = useState<"none" | "construction" | "maintenance" | "era" | "density">("none");
  const [configConstruction, setConfigConstruction] = useState<Record<ConstructionKind, Record<string, number>>>(() => JSON.parse(JSON.stringify(getLiveBaseCosts())));
  const [configMaintenance, setConfigMaintenance] = useState<Record<ConstructionKind, number>>(() => ({ ...getLiveMaintenanceCosts() }));
  const [configDensity, setConfigDensity] = useState<Record<string, number>>(() => ({ ...getLiveDensity() }));
  const [configLoading, setConfigLoading] = useState(false);
  const [configError, setConfigError] = useState<string | null>(null);
  const [nationConfigs, setNationConfigs] = useState(() => loadNationModelConfigs(world));
  const [isOffline, setIsOffline] = useState(false);
  const [simulation, setSimulation] = useState<SimulationState>(() => createInitialSimulationState(world));
  const simulationRef = useRef(simulation);
  const turnInProgressRef = useRef(false);
  const mongoRunRef = useRef<MongoRunCtx | null>(null);
  const [turnProgress, setTurnProgress] = useState<TurnProgress>({
    turnNumber: 1,
    completedNationIds: [],
    totalNations: world.nations.length,
    phase: "idle",
  });
  const [selectedCityId, setSelectedCityId] = useState<string | undefined>();
  const [cityReturnNationId, setCityReturnNationId] = useState<string | undefined>();
  const [selectedNationId, setSelectedNationId] = useState<string | undefined>();
  const [selectedProvinceId, setSelectedProvinceId] = useState<string | undefined>(
    world.provinces[0]?.id,
  );
  useDomLocalization(appRootRef, language);
  // Servidor manda: al montar, trae prefs en background y actualiza la caché local.
  useEffect(() => {
    void fetchServerConfigs(world).then((serverConfigs) => {
      if (serverConfigs) {
        saveNationModelConfigs(serverConfigs);
      }
    });
  }, []);
  const worldTime = useMemo(
    () => formatWorldTime(simulation.elapsedMonths),
    [simulation.elapsedMonths],
  );

  // ===== CONFIG LOAD/SAVE =====
  const loadConfig = async (key: "construction_costs" | "maintenance_costs" | "density") => {
    try {
      const res = await fetch(`/__aia-mongo/config?key=${key}`);
      if (res.ok) {
        const { config } = await res.json();
        return config.data;
      }
    } catch {}
    return null;
  };

  const saveConfig = async (key: "construction_costs" | "maintenance_costs" | "density", data: unknown) => {
    try {
      const res = await fetch("/__aia-mongo/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, data, updatedBy: "gui" }),
      });
      if (!res.ok) throw new Error("Error guardando");
      return true;
    } catch (e) {
      setConfigError(e instanceof Error ? e.message : "Error guardando");
      return false;
    }
  };

  const loadAllConfigs = async () => {
    setConfigLoading(true);
    setConfigError(null);
    try {
      const [construction, maintenance, density] = await Promise.all([
        loadConfig("construction_costs"),
        loadConfig("maintenance_costs"),
        loadConfig("density"),
      ]);
      if (construction && setLiveBaseCosts(construction)) {
        setConfigConstruction(JSON.parse(JSON.stringify(getLiveBaseCosts())));
      }
      if (maintenance && setLiveMaintenanceCosts(maintenance)) {
        setConfigMaintenance({ ...getLiveMaintenanceCosts() });
      }
      if (density && setLiveDensity(density)) {
        setConfigDensity({ ...getLiveDensity() });
      }
    } catch (e) {
      setConfigError(e instanceof Error ? e.message : "Error cargando");
    } finally {
      setConfigLoading(false);
    }
  };

  const saveAllConfigs = async (): Promise<void> => {
    setConfigLoading(true);
    setConfigError(null);
    setLiveBaseCosts(configConstruction);
    setLiveMaintenanceCosts(configMaintenance);
    setLiveDensity(configDensity);
    const ok1 = await saveConfig("construction_costs", configConstruction);
    const ok2 = await saveConfig("maintenance_costs", configMaintenance);
    const ok3 = await saveConfig("density", configDensity);
    setConfigLoading(false);
    if (!ok1 || !ok2 || !ok3) throw new Error("Error guardando configuración");
  };

  // Cargar configs al montar
  useEffect(() => {
    loadAllConfigs();
  }, []);
  const eventCachesRef = useRef<Record<string, GameEvent[]>>({
    "general-todo": [],
    "general-diplomacia": [],
    "general-expansiones": [],
    "general-espionaje": [],
    "general-ingenieria": [],
    "guerra-combate": [],
    "guerra-logistica": [],
    "nacion": [],
  });
  const lastEventCountRef = useRef(0);

  const currentCacheKey = (() => {
    switch (eventLogMode) {
      case "general":
        return `general-${generalSub}`;
      case "guerra":
        return `guerra-${guerraSub}`;
      case "nacion":
        return "nacion";
      default:
        return null;
    }
  })();

  if (simulation.events.length > lastEventCountRef.current) {
    const newEvents = simulation.events.slice(lastEventCountRef.current);
    for (const event of newEvents) {
      const key = getEventCacheKey(event.kind) ?? "general-todo";
      if (eventCachesRef.current[key]) {
        eventCachesRef.current[key] = [
          event,
          ...eventCachesRef.current[key],
        ];
      }
    }
    const allKeys = Object.keys(eventCachesRef.current);
    for (const key of allKeys) {
      eventCachesRef.current[key] = sortEventsNewestFirst(eventCachesRef.current[key]).slice(0, 800);
    }
    lastEventCountRef.current = simulation.events.length;
  }

  const activeEvents = (() => {
    if (currentCacheKey === "nacion") {
      return eventNationId
        ? filterEventsForNation(simulation.events, eventNationId, Math.max(0, simulation.elapsedMonths - 24))
        : [];
    }
    if (currentCacheKey === "guerra-todos") {
      const combat = eventCachesRef.current["guerra-combate"] ?? [];
      const logistics = eventCachesRef.current["guerra-logistica"] ?? [];
      return sortEventsNewestFirst([...combat, ...logistics]).slice(0, 800);
    }
    if (currentCacheKey) {
      const cached = eventCachesRef.current[currentCacheKey];
      if (cached && cached.length > 0) return cached;
      // Si la caché está vacía, reconstruir desde simulation.events
      return sortEventsNewestFirst(simulation.events).slice(0, 800);
    }
    return simulation.events;
  })();

  const marketOffers = useMemo<MarketOffer[]>(
    () => [...(simulation.marketState?.offers ?? [])].sort((a, b) => b.validFrom - a.validFrom).slice(0, 60),
    [simulation.marketState],
  );
  const marketTransactions = useMemo<Transaction[]>(
    () => [...(simulation.marketState?.transactions ?? [])].sort((a, b) => b.executedAt - a.executedAt).slice(0, 60),
    [simulation.marketState],
  );
  
  const visibleArmyGroups = useMemo(
    () => getAllArmyGroups(simulation.military),
    [simulation.military],
  );
  const selectedProvinceStats = useMemo(
    () => buildProvinceStats(selectedProvinceId),
    [selectedProvinceId, worldRevision],
  );
  const selectedNationStats = useMemo(
    () => buildNationStats(
      selectedNationId,
      simulation.nationStockpiles[selectedNationId ?? ""],
      simulation.nationPolicies[selectedNationId ?? ""],
      simulation.nationRelations,
      simulation.defeatedNations,
      simulation.diplomacy,
      simulation.military,
      simulation.spies,
      simulation.elapsedMonths,
      simulation.eraState,
    ),
    [selectedNationId, simulation],
  );
  const selectedCityStats = useMemo(
    () => buildCityStats(selectedCityId),
    [selectedCityId],
  );

  const runNextTurn = useCallback(async () => {
    if (turnInProgressRef.current) {
      return;
    }

    turnInProgressRef.current = true;
    try {
      // Executor fresco por turno desde lo guardado (servidor manda, local de caché):
      // lo que guardes aplica al turno siguiente sin hacer nada más.
      const llmExecutor = createLLMExecutor(loadNationModelConfigs(world));
      const prevEventCount = simulationRef.current.events.length;
      // Vía B: los eventos se generan en el idioma activo (ES) o inglés por defecto.
      const next = await advanceSimulationTurn(world, simulationRef.current, llmExecutor, setTurnProgress, language === "es" ? "es" : "en");
      simulationRef.current = next;
      setSimulation(next);
      // Mongo (best-effort, no bloquea): persiste el mes recién simulado.
      const mongoCtx = mongoRunRef.current;
      if (mongoCtx) {
        const newEvents = next.events.slice(prevEventCount);
        const simMonth = next.elapsedMonths;
        const nationMonthly = buildNationMonthlyDocs(world, next, mongoCtx.seed, simMonth);
        void mongoSendTurn(mongoCtx, {
          eventDocs: buildEventDocs(newEvents, mongoCtx.seed),
          nationMonthlyDocs: nationMonthly,
          worldMonthlyDoc: buildWorldMonthlyDoc(world, nationMonthly, mongoCtx.seed, simMonth),
          monthsSimulated: simMonth,
          status: next.gameOver ? "gameover" : undefined,
        });
      }
      if (next.gameOver) {
        setIsRunning(false);
      }
      setTurnProgress({
        turnNumber: next.elapsedMonths + 1,
        completedNationIds: [],
        totalNations: world.nations.length,
        phase: "idle",
      });
    } catch (error) {
      debug.tag("App").error("国家回合执行失败，本回合未推进：", error);
      setIsRunning(false);
    } finally {
      turnInProgressRef.current = false;
    }
  }, [language]);

  useEffect(() => {
    const monitor = ConnectionMonitor.getInstance();
    monitor.onChange((state) => setIsOffline(state === "disconnected"));
    monitor.start();
    return () => { monitor.stop(); };
  }, []);

  useEffect(() => {
    if (!isRunning) {
      return;
    }

    let cancelled = false;
    let timer: number | undefined;
    const loop = async () => {
      await runNextTurn();
      if (!cancelled) {
        timer = window.setTimeout(loop, Math.round(1000 / speed));
      }
    };
    void loop();
    return () => {
      cancelled = true;
      if (timer !== undefined) {
        window.clearTimeout(timer);
      }
    };
  }, [isRunning, runNextTurn, speed]);

  const handleSelectProvince = useCallback((provinceId: string | undefined) => {
    if (provinceId) {
      setSelectedProvinceId(provinceId);
      setSelectedCityId(undefined);
      setCityReturnNationId(undefined);
      setSelectedNationId(undefined);
    }
  }, []);
  const handleSelectCity = useCallback((cityId: string, returnNationId?: string) => {
    const city = world.cityById.get(cityId);
    if (!city) {
      return;
    }

    setSelectedCityId(cityId);
    setCityReturnNationId(returnNationId);
    setSelectedNationId(undefined);
    setSelectedProvinceId(city.provinceId);
  }, []);
  const handleSelectNation = useCallback((nationId: string) => {
    setSelectedCityId(undefined);
    setCityReturnNationId(undefined);
    setSelectedNationId(nationId);
  }, []);
  const handleBackFromCity = useCallback(() => {
    setSelectedCityId(undefined);
    if (cityReturnNationId) {
      setSelectedNationId(cityReturnNationId);
      setCityReturnNationId(undefined);
      return;
    }

    setSelectedNationId(undefined);
  }, [cityReturnNationId]);

  const handleStartGame = useCallback((settings: NewGameSettings) => {
    debug.time("app:buildDemoWorld nuevo juego");
    const nextWorld = buildDemoWorld(settings.seed, {
      cityCount: settings.cityCount,
      nationCount: settings.nationCount,
      freeProvinceRatio: settings.freeProvinceRatio,
    });
    debug.timeEnd("app:buildDemoWorld nuevo juego");
    const nextSimulation = createInitialSimulationState(nextWorld);
    world = nextWorld;
    // Servidor manda: sincroniza prefs en background para el mundo nuevo.
    void fetchServerConfigs(world).then((serverConfigs) => {
      if (serverConfigs) {
        saveNationModelConfigs(serverConfigs);
      }
    });
    simulationRef.current = nextSimulation;
    setSimulation(nextSimulation);
    setTurnProgress({
      turnNumber: 1,
      completedNationIds: [],
      totalNations: nextWorld.nations.length,
      phase: "idle",
    });
    setIsRunning(false);
    setEventNationId(undefined);
    setEventLogMode("general");
    setGeneralSub("todo");
    setGuerraSub("todos");
    setDismissVictory(false);
    setSelectedCityId(undefined);
    setCityReturnNationId(undefined);
    setSelectedNationId(undefined);
    setSelectedProvinceId(nextWorld.provinces[0]?.id);
    setWorldRevision((revision) => revision + 1);
    setActiveSurface("world");
    // Resetear caché de eventos para nuevo juego
    eventCachesRef.current = {
      "general-todo": [],
      "general-diplomacia": [],
      "general-expansiones": [],
      "general-espionaje": [],
      "general-ingenieria": [],
      "guerra-combate": [],
      "guerra-logistica": [],
      "nacion": [],
    };
    lastEventCountRef.current = 0;
    // Mongo (best-effort, no bloquea): crea el run + naciones con su LLM.
    const mongoConfigs = loadNationModelConfigs(nextWorld);
    void mongoNewRun({
      seed: settings.seed,
      worldParams: {
        nationCount: settings.nationCount,
        cityCount: settings.cityCount,
        freeProvinceRatio: settings.freeProvinceRatio,
      },
      worldSummary: {
        nations: nextWorld.nations.length,
        provinces: nextWorld.provinces.length,
        cities: nextWorld.cities.length,
        tiles: nextWorld.tiles.length,
      },
      llmNations: nextWorld.nations.map((nation) => {
        const config = mongoConfigs[nation.id];
        return {
          nationId: nation.id,
          provider: config?.providerName ?? "",
          model: config?.model ?? "",
          enabled: config?.enabled ?? false,
        };
      }),
      nations: buildNationDocs(nextWorld, mongoConfigs, settings.seed),
      createdBy: "gui",
    }).then((ctx) => {
      mongoRunRef.current = ctx;
    });
  }, []);

  return (
    <main
      className={activeSurface === "menu"
        ? "mainMenuSurface"
        : activeSurface === "configuration"
          ? "configurationSurface"
          : buildAppShellClassName(isPanelOpen, isEventPanelOpen)}
      ref={appRootRef}
      lang={language === "zh" ? "zh-CN" : language === "es" ? "es" : "en"}
    >
      {activeSurface === "menu" ? (
        <MainMenu
          language={language}
          onChangeLanguage={setLanguage}
          onStartGame={handleStartGame}
          onConfig={() => setConfigMode("construction")}
        />
      ) : activeSurface === "configuration" ? (
        <NationModelConfiguration
          language={language}
          onBack={() => { setNationConfigs(loadNationModelConfigs(world)); setActiveSurface("world"); }}
          world={world}
        />
      ) : (
        <>
      <aside className="eventPanel" aria-label="Event log">
        <button
          aria-label={isEventPanelOpen ? "Collapse event log" : "Expand event log"}
          className="eventPanelToggle"
          onClick={() => setIsEventPanelOpen((open) => !open)}
          title={isEventPanelOpen ? "Collapse event log" : "Expand event log"}
          type="button"
        >
          {isEventPanelOpen ? "<" : ">"}
        </button>
        {isEventPanelOpen && (
          <EventLogPanel
            eventLogMode={eventLogMode}
            generalSub={generalSub}
            guerraSub={guerraSub}
            onSelectGeneralSub={setGeneralSub}
            onSelectGuerraSub={setGuerraSub}
            eventNationId={eventNationId}
            nations={world.nations}
            activeEvents={activeEvents}
            onBackToNationList={() => setEventNationId(undefined)}
            onSelectMode={setEventLogMode}
            onSelectNation={setEventNationId}
            marketOffers={marketOffers}
            marketTransactions={marketTransactions}
            constructionProjects={simulation.constructionProjects}
            minasDeCarbon={simulation.minasDeCarbon}
            aserraderos={simulation.aserraderos}
            nationConfigs={nationConfigs}
          />
        )}
      </aside>
      <section className="mapArea" aria-label="World map">
        <div className="scFrame">
          <div className="scFrameTop">
            <span className="scCorner scCornerTL" />
            <span className="scCorner scCornerTR" />
          </div>
          <div className="scFrameBody">
            <div className="scFrameLeft" />
            <ErrorBoundary area="WorldMap">
            <WorldMap
              world={world}
              mapMode={mapMode}
              mapRevision={simulation.mapRevision}
              armyGroups={visibleArmyGroups}
              selectedCityId={selectedCityId}
              selectedProvinceId={selectedProvinceId}
              onSelectCity={handleSelectCity}
              onSelectProvince={handleSelectProvince}
              language={language}
              eraState={simulation.eraState}
              nationConfigs={nationConfigs}
            />
            </ErrorBoundary>
            <OfflineOverlay visible={isOffline} />
            <div className="scFrameRight" />
          </div>
          <div className="scFrameBottom">
            <span className="scCorner scCornerBL" />
            <span className="scCorner scCornerBR" />
            <span className="scWorldName">{world.seed}</span>
            <span className="scWorldTime">{worldTime}</span>
          </div>
        </div>
        {simulation.gameOver && !dismissVictory && (
          <div className="victoryOverlay" role="dialog" aria-modal="true" aria-label="Victory">
            <div className="victoryCard">
              <p className="eyebrow">Game Over</p>
              <h1>🏆 {world.nationById.get(simulation.gameOver.victorNationId)?.name ?? simulation.gameOver.victorNationId}</h1>
              <p>Domina el {Math.round(simulation.gameOver.share * 100)}% de la tierra — Victoria en {formatWorldTime(simulation.gameOver.month)}</p>
              <div className="victoryActions">
                <button className="menuPrimaryButton" onClick={() => setDismissVictory(true)} type="button">
                  Seguir observando
                </button>
                <button className="menuTextButton" onClick={() => { setIsRunning(false); setActiveSurface("menu"); }} type="button">
                  Nuevo juego
                </button>
              </div>
            </div>
          </div>
        )}
      </section>
      <aside className="sidePanel" aria-label="World controls">
        <button
          aria-label={isPanelOpen ? "Collapse side panel" : "Expand side panel"}
          className="panelToggle"
          onClick={() => setIsPanelOpen((open) => !open)}
          title={isPanelOpen ? "Collapse side panel" : "Expand side panel"}
          type="button"
        >
          {isPanelOpen ? ">" : "<"}
        </button>
        {isPanelOpen && (
          <div className="panelContent" key={selectedCityId ?? selectedNationId ?? "overview"}>
            {selectedCityStats ? (
              <CityDetailPanel
                stats={selectedCityStats}
                onBack={handleBackFromCity}
              />
            ) : selectedNationStats ? (
              <NationDetailPanel
                stats={selectedNationStats}
                onBack={() => setSelectedNationId(undefined)}
                onSelectCity={handleSelectCity}
              />
            ) : (
              <>
                <header>
                  <h1>AI Sandbox de Civilización v{pkg.version}</h1>
                  <LanguageSelector compact language={language} onChangeLanguage={setLanguage} showNames={false} />
                </header>
                <section className="mapModePanel">
                  <h2>Map Mode</h2>
                  <div className="segmentedControl" role="group" aria-label="Map mode">
                    {mapModes.map((mode) => (
                      <button
                        className={mapMode === mode.id ? "active" : ""}
                        key={mode.id}
                        onClick={() => setMapMode(mode.id)}
                        type="button"
                      >
                        {mode.label}
                      </button>
                    ))}
                  </div>
                </section>
                <section className="timePanel">
                  <div className="timeReadout">
                    <span>World Time</span>
                    <strong>{worldTime}</strong>
                  </div>
                  {simulation.gameOver && (
                    <div className="victoryBanner" role="status">
                      <strong>🏆 {world.nationById.get(simulation.gameOver.victorNationId)?.name ?? simulation.gameOver.victorNationId}</strong>
                      <span>domina el {Math.round(simulation.gameOver.share * 100)}% — Victoria en {formatWorldTime(simulation.gameOver.month)}</span>
                    </div>
                  )}
                  <button
                    className="primaryControl"
                    disabled={Boolean(simulation.gameOver)}
                    onClick={() => setIsRunning((running) => !running)}
                    type="button"
                  >
                    {isRunning ? "Pause" : "Play"}
                  </button>
                  <button className="secondaryControl" disabled={turnProgress.phase !== "idle" || Boolean(simulation.gameOver)} onClick={() => void runNextTurn()} type="button">
                    Next Turn
                  </button>
                  <div className="segmentedControl speedControl" role="group" aria-label="Simulation speed">
                    {speedOptions.map((option) => (
                      <button
                        className={speed === option ? "active" : ""}
                        key={option}
                        onClick={() => setSpeed(option)}
                        type="button"
                      >
                        {option}x
                      </button>
                    ))}
                  </div>
                  <div className="turnProgress" aria-live="polite">
                    <span>Turn Progress</span>
                    <strong>
                      {turnProgress.phase === "idle"
                        ? `Turn ${simulation.elapsedMonths + 1}`
                        : turnProgress.phase === "resolving"
                          ? `Resolving · ${turnProgress.completedNationIds.length} of ${turnProgress.totalNations} nations completed`
                          : `Waiting for ${world.nationById.get(turnProgress.activeNationId ?? "")?.name ?? "Unknown nation"} · ${turnProgress.completedNationIds.length} of ${turnProgress.totalNations} nations completed`}
                    </strong>
                  </div>
                </section>
<button
                  className="aiConfigEntry"
                  onClick={() => {
                    setIsRunning(false);
                    setActiveSurface("configuration");
                  }}
                  type="button"
                >
                  <span>AI Configuration</span>
                  <small>Models & personalities</small>
                </button>
                <button
                  className="aiConfigEntry"
                  onClick={() => setConfigMode("construction")}
                  type="button"
                  disabled={configLoading}
                >
                  <span>⚙️ Configuración</span>
                  <small>Costos & mantenimiento</small>
                </button>
                <div className="statGrid">
                  <div>
                    <span>Seed</span>
                    <strong className="smallStat">{world.seed}</strong>
                  </div>
                  <div>
                    <span>Map</span>
                    <strong>
                      {world.width}x{world.height}
                    </strong>
                  </div>
                  <div>
                    <span>Provinces</span>
                    <strong>{world.provinces.length}</strong>
                  </div>
                  <div>
                    <span>Nations</span>
                    <strong>{world.nations.length}</strong>
                  </div>
                  <div>
                    <span>Towns</span>
                    <strong>{countCitiesByTipo(world.cities).pueblos}</strong>
                  </div>
                  <div>
                    <span>Cities</span>
                    <strong>{countCitiesByTipo(world.cities).ciudades}</strong>
                  </div>
                </div>
                <section className="legend">
                  <h2>Layers</h2>
                  <p><span className="line dashed" /> Province border</p>
                  <p><span className="line solid" /> Nation border</p>
                  <p><span className="line nationLine" /> Nation color edge</p>
                  <p><span className="resourceMark" /> Resource node</p>
                  <p><span className="townMark" /> Towns</p>
                  <p><span className="cityMark" /> City</p>
                  <p><span className="freeMark" /> Tierra libre</p>
                </section>
                {selectedProvinceStats && (
                  <section className="provinceDetails">
                    <h2>Selected Province</h2>
                    <div className="provinceTitle">
                      <span style={{ backgroundColor: selectedProvinceStats.nation.color }} />
                      <div>
                        <strong>{selectedProvinceStats.province.name}</strong>
                        <p>{selectedProvinceStats.nation.name}</p>
                      </div>
                    </div>
                    <button
                      className="inspectNationButton"
                      onClick={() => handleSelectNation(selectedProvinceStats.nation.id)}
                      type="button"
                    >
                      View Nation
                    </button>
                    <dl>
                      <div>
                        <dt>Area</dt>
                        <dd>{selectedProvinceStats.province.tileCount} tiles</dd>
                      </div>
                      <div>
                        <dt>Elevation</dt>
                        <dd>{selectedProvinceStats.elevation}%</dd>
                      </div>
                      <div>
                        <dt>Temperature</dt>
                        <dd>{selectedProvinceStats.temperature}%</dd>
                      </div>
                      <div>
                        <dt>Moisture</dt>
                        <dd>{selectedProvinceStats.moisture}%</dd>
                      </div>
                    </dl>
                    <div className="detailBlock">
                      <span>Terrain</span>
                      <p>{formatCounts(selectedProvinceStats.terrainCounts)}</p>
                    </div>
                    <div className="detailBlock">
                      <span>Resources</span>
                      <p>{formatCounts(selectedProvinceStats.resourceCounts) || "None discovered"}</p>
                    </div>
                  </section>
                )}
                  <section className="nationList">
                   <h2>Nations</h2>
                   <p className="sectionHint">Click a nation to open its detail panel.</p>
                   {world.nations.map((nation) => {
                     const isDefeated = isNationDefeated(world, nation.id);
                     const hasNoTiles = world.provinces.filter((p) => p.nationId === nation.id).length === 0;
                     const isDead = isDefeated || hasNoTiles;
                     return (
                       <button
                         className={isDead ? "nationButton nationButtonDead" : "nationButton"}
                         key={nation.id}
                         onClick={() => !isDead && handleSelectNation(nation.id)}
                         type="button"
                       >
                         <span style={{ backgroundColor: nation.color }} />
                         <strong>{nation.name}</strong>
                         <em>{isDead ? "💀" : "Details"}</em>
                       </button>
                     );
                   })}
                 </section>
              </>
            )}
          </div>
        )}
</aside>
         </>
       )}
       {configMode !== "none" && (
          <ConfigPanel
            onClose={() => setConfigMode("none")}
            onSelectMode={setConfigMode}
            configMode={configMode}
            configConstruction={configConstruction}
            configMaintenance={configMaintenance}
            configDensity={configDensity}
            setConfigConstruction={setConfigConstruction}
            setConfigMaintenance={setConfigMaintenance}
            setConfigDensity={setConfigDensity}
            configLoading={configLoading}
            configError={configError}
            onSave={saveAllConfigs}
          />
       )}
     </main>
  );
}

type NationStats = NonNullable<ReturnType<typeof buildNationStats>>;
type CityStats = NonNullable<ReturnType<typeof buildCityStats>>;

function EventLogPanel({
  eventLogMode,
  generalSub,
  guerraSub,
  onSelectGeneralSub,
  onSelectGuerraSub,
  eventNationId,
  nations,
  activeEvents,
  onBackToNationList,
  onSelectMode,
  onSelectNation,
  marketOffers,
  marketTransactions,
  constructionProjects,
  minasDeCarbon,
  aserraderos,
  nationConfigs,
}: {
  eventLogMode: TopEventTab;
  generalSub: GeneralSubTab;
  guerraSub: GuerraSubTab;
  onSelectGeneralSub: (sub: GeneralSubTab) => void;
  onSelectGuerraSub: (sub: GuerraSubTab) => void;
  eventNationId: string | undefined;
  nations: Nation[];
  activeEvents: GameEvent[];
  onBackToNationList: () => void;
  onSelectMode: (mode: TopEventTab) => void;
  onSelectNation: (nationId: string) => void;
  marketOffers: MarketOffer[];
  marketTransactions: Transaction[];
  constructionProjects: ConstructionProject[];
  minasDeCarbon: MinaDeCarbon[];
  aserraderos: Aserradero[];
  nationConfigs: NationModelConfigs;
}) {
  const selectedEventNation = eventNationId ? nations.find((n) => n.id === eventNationId) : undefined;
  const handleSelectTab = (tab: TopEventTab) => {
    onBackToNationList();
    onSelectMode(tab);
  };

  return (
    <div className="eventPanelContent">
      <header>
        <p className="eyebrow">World History</p>
        <h1>Event Log</h1>
      </header>
      <div className="segmentedControl eventModeControl eventTopTabs" role="group" aria-label="Event log mode">
        <button
           className={eventLogMode === "general" ? "active" : ""}
           onClick={() => handleSelectTab("general")}
           type="button"
         >
           General
        </button>
        <button
          className={eventLogMode === "nacion" ? "active" : ""}
          onClick={() => handleSelectTab("nacion")}
          type="button"
        >
          Nación
        </button>
        <button
          className={eventLogMode === "guerra" ? "active" : ""}
          onClick={() => handleSelectTab("guerra")}
          type="button"
        >
          Guerra
        </button>
        <button
          className={eventLogMode === "mercado" ? "active" : ""}
          onClick={() => handleSelectTab("mercado")}
          type="button"
        >
          Mercado
        </button>
      </div>
      {eventLogMode === "general" && (
        <div className="segmentedControl eventSubTabs" role="group" aria-label="General filter">
          <button
            className={generalSub === "todo" ? "active" : ""}
            onClick={() => onSelectGeneralSub("todo")}
            type="button"
          >
            Todo
          </button>
          <button
            className={generalSub === "diplomacia" ? "active" : ""}
            onClick={() => onSelectGeneralSub("diplomacia")}
            type="button"
          >
            Diplomacia
          </button>
          <button
            className={generalSub === "expansiones" ? "active" : ""}
            onClick={() => onSelectGeneralSub("expansiones")}
            type="button"
          >
            Expansiones
          </button>
          <button
            className={generalSub === "espionaje" ? "active" : ""}
            onClick={() => onSelectGeneralSub("espionaje")}
            type="button"
          >
            Espionaje
          </button>
          <button
            className={generalSub === "ingenieria" ? "active" : ""}
            onClick={() => onSelectGeneralSub("ingenieria")}
            type="button"
          >
            Ingeniería
          </button>
        </div>
      )}
      {eventLogMode === "guerra" && (
        <div className="segmentedControl eventSubTabs" role="group" aria-label="Guerra filter">
          <button
            className={guerraSub === "todos" ? "active" : ""}
            onClick={() => onSelectGuerraSub("todos")}
            type="button"
          >
            Todos
          </button>
          <button
            className={guerraSub === "combate" ? "active" : ""}
            onClick={() => onSelectGuerraSub("combate")}
            type="button"
          >
            Combate
          </button>
          <button
            className={guerraSub === "logistica" ? "active" : ""}
            onClick={() => onSelectGuerraSub("logistica")}
            type="button"
          >
            Logística
          </button>
        </div>
      )}

      {eventLogMode === "nacion" && !selectedEventNation && (
        <section className="eventListSection">
          <div className="sectionTitleRow">
            <h2>Selecciona una nación</h2>
            <span>{nations.length}</span>
          </div>
          <p className="emptyState">Elige una nación para ver sus eventos de los últimos 2 años.</p>
          <div className="eventNationButtons" style={{ marginTop: "8px" }}>
            {nations.map((nation) => (
              <button
                className={eventNationId === nation.id ? "active" : ""}
                key={nation.id}
                onClick={() => onSelectNation(nation.id)}
                type="button"
              >
                <span style={{ backgroundColor: nation.color }} />
                {nation.name}
              </button>
            ))}
          </div>
        </section>
      )}
       {eventLogMode === "general" && (
        <section className="eventListSection">
           <div className="sectionTitleRow">
             <h2>{generalSub === "todo" ? "Recent Major Events" : generalSub === "diplomacia" ? "Diplomacia" : generalSub === "expansiones" ? "Expansiones" : generalSub === "ingenieria" ? "Construcción" : "Espionaje"}</h2>
            <span>{activeEvents.length}{activeEvents.length >= 800 ? "+" : ""}</span>
          </div>
          {generalSub === "ingenieria" && (
            <ConstructionQueue
              projects={constructionProjects}
              nations={nations}
              minasDeCarbon={minasDeCarbon}
              aserraderos={aserraderos}
            />
          )}
          <EventRows events={activeEvents} nations={nations} configs={nationConfigs} />
        </section>
       )}
      {eventLogMode === "guerra" && (
        <section className="eventListSection">
          <div className="sectionTitleRow">
            <h2>{guerraSub === "todos" ? "Guerra: Todos" : guerraSub === "combate" ? "Guerra: Combate" : "Guerra: Logística"}</h2>
            <span>{activeEvents.length}{activeEvents.length >= 800 ? "+" : ""}</span>
          </div>
          <EventRows events={activeEvents} nations={nations} configs={nationConfigs} />
        </section>
      )}
      {eventLogMode === "mercado" && (
        <section className="eventListSection">
          <div className="sectionTitleRow">
            <h2>Mercado</h2>
            <span>{marketOffers.length} ofertas · {marketTransactions.length} transacciones</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            {marketOffers.length > 0 && (
              <>
                <h3 style={{ margin: "8px 0 0", color: "#9fb7b1", fontSize: "13px" }}>Ofertas vigentes</h3>
                <MarketOffersTable offers={marketOffers} nations={nations} />
              </>
            )}
            {marketTransactions.length > 0 && (
              <>
                <h3 style={{ margin: "16px 0 0", color: "#9fb7b1", fontSize: "13px" }}>Transacciones recientes</h3>
                <MarketTransactionsTable transactions={marketTransactions} />
              </>
            )}
            {marketOffers.length === 0 && marketTransactions.length === 0 && (
              <p className="emptyState">Sin actividad en el mercado</p>
            )}
          </div>
        </section>
      )}
      {eventLogMode === "nacion" && selectedEventNation && (
        <section className="eventNationDetail">
          <button className="backButton compactBackButton" onClick={onBackToNationList} type="button">
            <span aria-hidden="true">{"<"}</span>
            Back
          </button>
          <header className="eventNationDetailHeader">
            <span style={{ borderColor: selectedEventNation.color }} />
            <div>
              <p className="eyebrow">Nation</p>
              <h2>{selectedEventNation.name}</h2>
            </div>
          </header>
          <section className="eventListSection">
            <div className="sectionTitleRow">
              <h2>Last 2 Years</h2>
              <span>{activeEvents.length}{activeEvents.length >= 800 ? "+" : ""}</span>
            </div>
            <EventRows events={activeEvents} nations={nations} configs={nationConfigs} />
          </section>
        </section>
      )}
    </div>
  );
}

function ConfigPanel({
  onClose,
  onSelectMode,
  configMode,
  configConstruction,
  configMaintenance,
  configDensity,
  setConfigConstruction,
  setConfigMaintenance,
  setConfigDensity,
  configLoading,
  configError,
  onSave,
}: {
  onClose: () => void;
  onSelectMode: (mode: "construction" | "maintenance" | "era" | "density") => void;
  configMode: "construction" | "maintenance" | "era" | "density";
  configConstruction: Record<ConstructionKind, Record<string, number>>;
  configMaintenance: Record<ConstructionKind, number>;
  configDensity: Record<string, number>;
  setConfigConstruction: React.Dispatch<React.SetStateAction<Record<ConstructionKind, Record<string, number>>>>;
  setConfigMaintenance: React.Dispatch<React.SetStateAction<Record<ConstructionKind, number>>>;
  setConfigDensity: React.Dispatch<React.SetStateAction<Record<string, number>>>;
  configLoading: boolean;
  configError: string | null;
  onSave: () => Promise<void>;
}) {
  const tabs = [
    { id: "construction", label: "🏗️ Costos base" },
    { id: "maintenance", label: "🔧 Mantención" },
    { id: "era", label: "🏛️ Eras" },
    { id: "density", label: "🌐 Densidad" },
  ] as const;

  const handleCellChange = (building: ConstructionKind, resource: string, value: string) => {
    const num = Math.max(0, parseInt(value) || 0);
    setConfigConstruction(prev => ({
      ...prev,
      [building]: {
        ...prev[building],
        [resource]: num,
      },
    }));
  };

  const handleMaintenanceChange = (building: ConstructionKind, value: string) => {
    const num = Math.max(0, parseFloat(value) || 0);
    setConfigMaintenance(prev => ({ ...prev, [building]: num }));
  };

  const handleDensityChange = (era: string, value: string) => {
    const num = Math.max(0, parseInt(value) || 0);
    setConfigDensity(prev => ({ ...prev, [era]: num }));
  };

  const costResources = ["gold", "wood", "stone", "iron"];
  const buildingRows = getBuildingConfigRows(BUILDING_LIST);
  const eraRows = getEraConfigTable();

  const titles = {
    construction: "⚙️ Configuración: Costos base de Construcción",
    maintenance: "⚙️ Configuración: Mantenimiento (oro/turno)",
    era: "⚙️ Configuración: Eras (buffs y desbloqueos)",
    density: "⚙️ Configuración: Densidad (hab/tile por era)",
  } as const;

  return (
    <div className="configPanel">
      <header className="configHeader">
        <h2>{titles[configMode]}</h2>
        <button className="closeButton" onClick={onClose} type="button">✕</button>
      </header>
      <div className="segmentedControl" role="group" aria-label="Config tabs">
        {tabs.map(tab => (
          <button
            key={tab.id}
            className={configMode === tab.id ? "active" : ""}
            onClick={() => onSelectMode(tab.id)}
            type="button"
          >
            {tab.label}
          </button>
        ))}
      </div>
      {configError && <div className="configError">{configError}</div>}
      {configMode === "construction" && (
        <>
          <div className="configTableWrapper">
            <table className="configTable">
              <thead>
                <tr>
                  <th>Edificio</th>
                  {costResources.map(r => <th key={r}>{r}</th>)}
                  <th>Meses</th>
                  <th>Tiles</th>
                  <th>Produce</th>
                </tr>
              </thead>
              <tbody>
                {BUILDING_LIST.map(building => {
                  const info = buildingRows.find(r => r.kind === building);
                  return (
                    <tr key={building}>
                      <td className="configRowLabel">{BUILDING_LABELS[building]}</td>
                      {costResources.map(resource => (
                        <td key={resource}>
                          <input
                            type="number"
                            min="0"
                            value={configConstruction[building]?.[resource] ?? 0}
                            onChange={e => handleCellChange(building, resource, e.target.value)}
                            disabled={configLoading}
                            className="configInput"
                          />
                        </td>
                      ))}
                      <td>{info?.turns ?? ""}</td>
                      <td>{info?.tiles ?? 1}</td>
                      <td>{info?.production ?? ""}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="configHint">Costo real en juego = base × factor de era (ver tab Eras). Capital ×0.8.</p>
          <footer className="configFooter">
            <button
              className="saveButton"
              onClick={onSave}
              disabled={configLoading}
              type="button"
            >
              {configLoading ? "Guardando..." : "💾 Guardar Costos"}
            </button>
            <button className="cancelButton" onClick={onClose} disabled={configLoading} type="button">
              Cancelar
            </button>
          </footer>
        </>
      )}
      {configMode === "maintenance" && (
        <>
          <div className="configTableWrapper">
            <table className="configTable">
              <thead>
                <tr>
                  <th>Edificio</th>
                  <th>Oro / Turno</th>
                </tr>
              </thead>
              <tbody>
                {BUILDING_LIST.map(building => (
                  <tr key={building}>
                    <td className="configRowLabel">{BUILDING_LABELS[building]}</td>
                    <td>
                      <input
                        type="number"
                        min="0"
                        step="0.5"
                        value={configMaintenance[building] ?? 0}
                        onChange={e => handleMaintenanceChange(building, e.target.value)}
                        disabled={configLoading}
                        className="configInput"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <footer className="configFooter">
            <button
              className="saveButton"
              onClick={onSave}
              disabled={configLoading}
              type="button"
            >
              {configLoading ? "Guardando..." : "💾 Guardar Mantenimiento"}
            </button>
            <button className="cancelButton" onClick={onClose} disabled={configLoading} type="button">
              Cancelar
            </button>
          </footer>
        </>
      )}
      {configMode === "era" && (
        <>
          <div className="configTableWrapper">
            <table className="configTable">
              <thead>
                <tr>
                  <th>Era</th>
                  <th>Cambio (oro)</th>
                  <th>Factor costos</th>
                  <th>Bonus prod.</th>
                  <th>Dto. explo.</th>
                  <th>Desbloquea</th>
                </tr>
              </thead>
              <tbody>
                {eraRows.map(row => (
                  <tr key={row.era}>
                    <td className="configRowLabel">{ERA_LABELS[row.era as keyof typeof ERA_LABELS] ?? row.label}</td>
                    <td>{row.changeCostGold === null ? "—" : row.changeCostGold.toLocaleString("es-ES")}</td>
                    <td>×{row.costFactor}</td>
                    <td>+{row.productionBonusPct}%</td>
                    <td>{row.exploreDiscountGold} oro</td>
                    <td>{row.unlocks.length > 0 ? row.unlocks.map(k => BUILDING_LABELS[k as ConstructionKind] ?? k).join(", ") : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="configHint">Solo lectura: los buffs de era están fijos en el motor.</p>
          <footer className="configFooter">
            <button className="cancelButton" onClick={onClose} type="button">
              Cerrar
            </button>
          </footer>
        </>
      )}
      {configMode === "density" && (
        <>
          <div className="configTableWrapper">
            <table className="configTable">
              <thead>
                <tr>
                  <th>Era</th>
                  <th>Hab / Tile</th>
                  <th>Ej. 1 pueblo</th>
                </tr>
              </thead>
              <tbody>
                {ERA_LIST.map(era => (
                  <tr key={era}>
                    <td className="configRowLabel">{ERA_LABELS[era as keyof typeof ERA_LABELS] ?? era}</td>
                    <td>
                      <input
                        type="number"
                        min="0"
                        value={configDensity[era] ?? 0}
                        onChange={e => handleDensityChange(era, e.target.value)}
                        disabled={configLoading}
                        className="configInput"
                      />
                    </td>
                    <td>{(configDensity[era] ?? 0).toLocaleString("es-ES")} hab</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="configHint">Tope = tiles habitables × densidad. Tile sin pueblo/ciudad/reino = 0 hab.</p>
          <h3 className="configSubTitle">Natalidad y mortalidad por era (solo lectura)</h3>
          <div className="configTableWrapper">
            <table className="configTable">
              <thead>
                <tr>
                  <th>Era</th>
                  <th>Natalidad paz</th>
                  <th>Natalidad guerra</th>
                  <th>Mortalidad paz</th>
                  <th>Mortalidad guerra</th>
                </tr>
              </thead>
              <tbody>
                {getEraVitalityRows().map(row => (
                  <tr key={row.era}>
                    <td className="configRowLabel">{ERA_LABELS[row.era as keyof typeof ERA_LABELS] ?? row.era}</td>
                    <td>{row.birthPeace}</td>
                    <td>{row.birthWar}</td>
                    <td>{row.deathPeace}</td>
                    <td>{row.deathWar}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="configHint">El exceso sobre el tope puede seguir creciendo pero produce al 10%: mueve colonos o agranda el pueblo.</p>
          <footer className="configFooter">
            <button
              className="saveButton"
              onClick={onSave}
              disabled={configLoading}
              type="button"
            >
              {configLoading ? "Guardando..." : "💾 Guardar Densidad"}
            </button>
            <button className="cancelButton" onClick={onClose} disabled={configLoading} type="button">
              Cancelar
            </button>
          </footer>
        </>
      )}
    </div>
  );
}

function ConstructionQueue({ projects, nations, minasDeCarbon, aserraderos }: { projects: ConstructionProject[]; nations: Nation[]; minasDeCarbon: MinaDeCarbon[]; aserraderos: Aserradero[] }) {
  const building = projects.filter((p) => p.status === "building");
  const minasActivas = minasDeCarbon.filter((m) => m.activa);
  const aserraderosActivos = aserraderos.filter((a) => a.activa);
  if (building.length === 0 && minasActivas.length === 0 && aserraderosActivos.length === 0) {
    return <p className="emptyState">Sin obras ni instalaciones activas</p>;
  }
  const nameOf = (id: string) => nations.find((n) => n.id === id)?.name ?? id;
  const provinceName = (id: string) => world.provinceById.get(id)?.name ?? id;
  return (
    <div className="eventRows constructionQueue">
      <div className="sectionTitleRow">
        <h2>Ingeniería</h2>
        <span>{building.length + minasActivas.length + aserraderosActivos.length}</span>
      </div>
      {building.map((project) => (
        <article className="eventRow construction ingenieriaEvent" key={project.id}>
          <div>
            <strong>🚧 {nameOf(project.nationId)} — {project.kind === "barracks" ? "cuartel" : project.kind === "granja" ? "granja" : project.kind === "stable" ? "establo" : project.kind === "mina_carbon" ? "mina de carbón" : project.kind === "aserradero" ? "aserradero" : project.kind === "pozo" ? "pozo de agua" : project.kind === "mina_hierro" ? "mina de hierro" : project.kind === "fabrica_armas" ? "fábrica de armas" : project.kind === "ciudad" ? `ciudad ${project.era}` : project.kind === "reino" ? `reino 👑 ${project.era}` : `pueblo ${project.era}`}</strong>
            <span>{project.remainingTurns} meses restantes</span>
          </div>
          <em className="ingenieriaBadge">🏗️ Construcción</em>
          <p>{formatConstructionBudget(project.cost)} · provincia {provinceName(project.provinceId)}</p>
        </article>
      ))}
      {minasActivas.map((mina) => (
        <article className="eventRow construction ingenieriaEvent" key={mina.id}>
          <div>
            <strong>⛏️ {nameOf(mina.nationId)} — Mina de Carbón ({mina.era})</strong>
            <span>Activa · {mina.nivel}ª mina</span>
          </div>
          <em className="ingenieriaBadge">⛏️ Mina</em>
          <p>Producción: ~{Math.floor(100 * (({stone:1.0, ancient:1.1, medieval:1.3, dark_medieval:1.4, modern:1.6, contemporary:2.0} as Record<string,number>)[mina.era] ?? 1))} carbón/turno · Mantenimiento: 5 oro · Provincia {provinceName(mina.provinceId)}</p>
        </article>
      ))}
      {aserraderosActivos.map((aserradero) => (
        <article className="eventRow construction ingenieriaEvent" key={aserradero.id}>
          <div>
            <strong>🪵 {nameOf(aserradero.nationId)} — Aserradero ({aserradero.era})</strong>
            <span>Activo · {aserradero.nivel}º aserradero</span>
          </div>
          <em className="ingenieriaBadge">🪵 Aserradero</em>
          <p>Producción: ~{Math.floor(100 * (({stone:1.0, ancient:1.1, medieval:1.3, dark_medieval:1.4, modern:1.6, contemporary:2.0} as Record<string,number>)[aserradero.era] ?? 1))} madera/turno · Mantenimiento: 5 oro · Provincia {provinceName(aserradero.provinceId)}</p>
        </article>
      ))}
    </div>
  );
}

function NationChip({ nationId, nations, configs }: {
  nationId: string;
  nations: Nation[];
  configs: NationModelConfigs;
}) {
  const nation = nations.find((n) => n.id === nationId);
  const iconPath = getModelIconForConfig(configs[nationId]);
  return (
    <span className="nationChip">
      <img
        src={iconPath}
        alt=""
        width="16"
        height="16"
        onError={(event) => { event.currentTarget.src = "/resources/models/generic-ai.svg"; }}
      />
      <i style={{ backgroundColor: nation?.color ?? "#666" }} />
      {nation?.name ?? nationId}
    </span>
  );
}

function EventNationChips({ event, nations, configs }: {
  event: GameEvent;
  nations: Nation[];
  configs: NationModelConfigs;
}) {
  const ids = event.nationIds;
  if (ids.length === 0) {
    return (
      <span className="nationChips">
        <span className="nationChip systemChip">📊 Sistema</span>
      </span>
    );
  }
  // Combate con atacante/defensor garantizado: NaciónA ⚔️ NaciónB.
  if (event.kind === "battle_fought" && ids.length >= 2) {
    return (
      <span className="nationChips">
        <NationChip nationId={ids[0]} nations={nations} configs={configs} />
        <b className="vsSeparator">⚔️</b>
        <NationChip nationId={ids[1]} nations={nations} configs={configs} />
      </span>
    );
  }
  return (
    <span className="nationChips">
      {ids.map((id, index) => (
        <span key={id} className="nationChipGroup">
          {index > 0 && <b className="vsSeparator neutral">·</b>}
          <NationChip nationId={id} nations={nations} configs={configs} />
        </span>
      ))}
    </span>
  );
}

function EventRows({ events, nations, configs }: {
  events: GameEvent[];
  nations: Nation[];
  configs: NationModelConfigs;
}) {
  if (events.length === 0) {
    return <p className="emptyState">No major events yet</p>;
  }

  return (
    <div className="eventRows">
      {events.map((event) => (
        <article className={`eventRow ${event.kind}${isSpyEventKind(event.kind) ? " spyEvent" : ""}${isLogisticsEventKind(event.kind) ? " logisticsEvent" : ""}${isCombatEventKind(event.kind) ? " combatEvent" : ""}${isDiplomacyEventKind(event.kind) ? " diplomaciaEvent" : ""}${isExpansionEventKind(event.kind) ? " expansionesEvent" : ""}${isIngenieriaEventKind(event.kind) ? " ingenieriaEvent" : ""}`} key={event.id}>
          <div>
            <strong data-lang={event.lang ?? undefined}>{event.title}</strong>
            <span>{formatWorldTime(event.month)}</span>
          </div>
          {isSpyEventKind(event.kind) && <em className="spyBadge">🕵️ Espionaje</em>}
          {isLogisticsEventKind(event.kind) && <em className="logisticsBadge">📦 Logística</em>}
          {isCombatEventKind(event.kind) && <em className="combatBadge">⚔️ Combate</em>}
          {isDiplomacyEventKind(event.kind) && <em className="diplomaciaBadge">📜 Diplomacia</em>}
          {isExpansionEventKind(event.kind) && <em className="expansionesBadge">🌍 Expansiones</em>}
          {isIngenieriaEventKind(event.kind) && <em className="ingenieriaBadge">🏗️ Construcción</em>}
          <EventNationChips event={event} nations={nations} configs={configs} />
          <p data-lang={event.lang ?? undefined}>{event.description}</p>
        </article>
      ))}
    </div>
  );
}

function MarketOffersTable({ offers, nations }: { offers: MarketOffer[]; nations: Nation[] }) {
  if (offers.length === 0) {
    return <p className="emptyState">Sin ofertas vigentes</p>;
  }
  const nameOf = (id: string) => nations.find((n) => n.id === id)?.name ?? id;
  return (
    <div className="eventRows">
      {offers.map((offer) => (
<article className="eventRow market" key={offer.id}>
            <div>
              <strong>{offer.resourceType} × {offer.quantity}</strong>
              <span>{offer.unitPrice} oro/u · {offer.status}</span>
            </div>
            <em className="marketOfferBadge">📊 Oferta</em>
            <p>{nameOf(offer.sellerNationId)} → {offer.buyerNationId === "any" ? "cualquiera" : nameOf(offer.buyerNationId)} · válido {offer.validFrom}–{offer.validUntil}</p>
          </article>
      ))}
    </div>
  );
}

function MarketTransactionsTable({ transactions }: { transactions: Transaction[] }) {
  if (transactions.length === 0) {
    return <p className="emptyState">Sin transacciones ejecutadas</p>;
  }
  return (
    <div className="eventRows">
      {transactions.map((tx) => (
<article className="eventRow market" key={tx.id}>
            <div>
              <strong>{Math.round(tx.totalGold)} oro</strong>
              <span>turno {tx.executedAt} · {tx.status}</span>
            </div>
            <em className="marketTransactionBadge">💰 Transacción</em>
            <p>{tx.offers.join(", ")} · transporte {Math.round(tx.transportCost)}</p>
          </article>
      ))}
    </div>
  );
}

function CityDetailPanel({
  onBack,
  stats,
}: {
  onBack: () => void;
  stats: CityStats;
}) {
  return (
    <section className="cityDetail">
      <button className="backButton" onClick={onBack} type="button">
        <span aria-hidden="true">{"<"}</span>
        Back
      </button>
      <header className="cityDetailHeader">
        <span style={{ borderColor: stats.nation.color }} />
        <div>
          <p className="eyebrow">{stats.city.isCapital ? "Capital City" : "City Detail"}</p>
          <h1>{stats.city.name}</h1>
          <p>{stats.nation.name} / {stats.province.name}</p>
        </div>
      </header>
      <div className="statGrid">
        <div>
          <span>Population</span>
          <strong className="smallStat">{formatInteger(stats.economy.population)}</strong>
        </div>
        <div>
          <span>Monthly Gold</span>
          <strong className="smallStat">{formatInteger(stats.economy.monthlyGold)}/mo</strong>
        </div>
        <div>
          <span>Army</span>
          <strong className="smallStat">{formatInteger(stats.economy.army)}</strong>
        </div>
        <div>
          <span>Defense</span>
          <strong className="smallStat">Lv {stats.economy.defense}</strong>
        </div>
      </div>
      <section className="buildingSection">
        <div className="sectionTitleRow">
          <h2>Building Slots</h2>
          <span>{stats.buildingSlots} slots</span>
        </div>
        <div className="buildingSlotGrid">
          {Array.from({ length: stats.buildingSlots }, (_, index) => (
            <div className="buildingSlot" key={index}>
              Empty
            </div>
          ))}
        </div>
      </section>
    </section>
  );
}

function NationDetailPanel({
  onBack,
  onSelectCity,
  stats,
}: {
  onBack: () => void;
  onSelectCity: (cityId: string, returnNationId?: string) => void;
  stats: NationStats;
}) {
  if (stats.isDefeated) {
    const victor = stats.defeatRecord ? world.nationById.get(stats.defeatRecord.victorNationId) : undefined;
    return (
      <section className="nationDetail">
        <button className="backButton" onClick={onBack} type="button">
          <span aria-hidden="true">{"<"}</span>
          Back
        </button>
        <header className="nationDetailHeader defeatedNationHeader">
          <span style={{ backgroundColor: stats.nation.color }} />
          <div>
            <p className="eyebrow">Defeated Nation</p>
            <h1>{stats.nation.name}</h1>
          </div>
        </header>
        <section className="defeatedNationNotice">
          <h2>Nation Defeated</h2>
          <p><span>Defeated At</span><strong>{stats.defeatRecord ? formatWorldTime(stats.defeatRecord.defeatedAtMonth) : "Unknown"}</strong></p>
          <p><span>Destroyed By</span><strong>{victor ? victor?.name ?? "Unknown" : "Unknown"}</strong></p>
        </section>
      </section>
    );
  }

  return (
    <section className="nationDetail">
      <button className="backButton" onClick={onBack} type="button">
        <span aria-hidden="true">{"<"}</span>
        Back
      </button>
      <header className="nationDetailHeader">
        <span style={{ backgroundColor: stats.nation.color }} />
        <div>
          <p className="eyebrow">Nation Detail</p>
          <h1>{stats.nation.name}</h1>
        </div>
      </header>
      <div className="statGrid">
        <div>
          <span>🏛️ Capital</span>
          <strong className="smallStat">{stats.capitalName}</strong>
        </div>
        <div>
          <span>🏙️ Cities</span>
          <strong>{stats.ciudadCount}</strong>
        </div>
        <div>
          <span>🛖 Towns</span>
          <strong>{stats.puebloCount}</strong>
        </div>
        <div>
          <span>👥 Population</span>
          <strong className="smallStat">{formatPopulation(stats.cityEconomy.population)}</strong>
        </div>
        <div>
          <span>💰 Monthly Gold</span>
          <strong className="smallStat">{formatInteger(stats.cityEconomy.monthlyGold)}/mo</strong>
        </div>
        <div>
          <span>🏦 Treasury</span>
          <strong className="smallStat">{formatInteger(stats.stockpile.gold)}</strong>
        </div>
        <div>
          <span>⚔️ Soldiers</span>
          <strong className="smallStat">{formatInteger(stats.military.totalSoldiers)}</strong>
        </div>
        <div>
          <span>🔥 Morale</span>
          <strong>{Math.round(stats.military.army.morale * 100)}%</strong>
        </div>
        <div>
          <span>🗺️ Provinces</span>
          <strong>{stats.provinceCount}</strong>
        </div>
        <div>
          <span>🟩 Tiles</span>
          <strong>{formatInteger(stats.tileCount)}</strong>
        </div>
        <div>
          <span>{stats.eraEmoji} Era</span>
          <strong className="smallStat">{stats.eraLabel}</strong>
        </div>
        <div>
          <span>⛏️ Resource Sites</span>
          <strong>{stats.resourceSiteCount}</strong>
        </div>
        <div>
          <span>🕵️ Deployed Spies</span>
          <strong>{stats.spies.deployed.length}/3</strong>
        </div>
      </div>
      <PolicyPanel monthsUntilReview={stats.monthsUntilPolicyReview} policy={stats.policy} />
      <MilitaryPanel military={stats.military} />
      <SpyNetworkPanel spies={stats.spies} currentMonth={stats.currentMonth} />
      <DiplomacyStatusPanel diplomacy={stats.diplomacy} perspectiveNationId={stats.nation.id} />
      <section className="resourceSummary">
        <h2>Major Cities</h2>
        <CityRows
          cities={stats.majorCities}
          onSelectCity={(cityId) => onSelectCity(cityId, stats.nation.id)}
        />
      </section>
      <section className="resourceSummary">
        <h2>Relations</h2>
        <RelationRows perspectiveNationId={stats.nation.id} relations={stats.relations} />
      </section>
      <section className="resourceSummary">
        <h2>Monthly Output</h2>
        <ResourceRows totals={stats.monthlyOutput} suffix="/month" />
      </section>
      <section className="resourceSummary">
        <h2>Current Resources</h2>
        <ResourceRows includeZero totals={stats.currentResources} />
      </section>
      <section className="resourceSummary">
        <h2>Resource Sites</h2>
        <ResourceRows totals={stats.resourceSiteCounts} suffix="sites" />
      </section>
    </section>
  );
}

function MilitaryPanel({ military }: { military: NationWarSummary }) {
  return (
    <section className="militaryPanel">
      <div className="sectionTitleRow">
        <h2>Military</h2>
        <span>{formatInteger(military.totalSoldiers)} soldiers</span>
      </div>
      <div className="militaryOverview">
        <p>
          <span>Monthly Upkeep</span>
          <strong>{formatDecimal(military.monthlyUpkeep, 1)} gold</strong>
        </p>
        <p>
          <span>Attack / Defense</span>
          <strong>{formatInteger(military.attackPower)} / {formatInteger(military.defensePower)}</strong>
        </p>
      </div>
      <div className="militaryUnitRows">
        {unitTypes.map((type) => (
          <p key={type}>
            <span>
              <strong>{unitStats[type].label}</strong>
              <em>
                HP {unitStats[type].hp} / Speed {unitStats[type].speed} / Upkeep {unitStats[type].upkeepGold}
              </em>
            </span>
            <b>{formatInteger(military.army.units[type])}</b>
          </p>
        ))}
      </div>
      <div className="sectionTitleRow warStatusTitle">
        <h2>Field Army Groups</h2>
        <span>{military.armyGroups.length}</span>
      </div>
      {military.armyGroups.length === 0 ? (
        <p className="emptyState">No field army groups deployed</p>
      ) : (
        <div className="warRows">
          {military.armyGroups.slice(0, 6).map((group) => (
            <p key={group.id}>
              <span>
                <strong>{formatArmyStance(group.stance)}</strong>
                <em>
                  {world.provinceById.get(group.locationProvinceId)?.name ?? group.locationProvinceId}
                  {group.destinationProvinceId
                    ? ` -> ${world.provinceById.get(group.destinationProvinceId)?.name ?? group.destinationProvinceId}`
                    : ""}
                </em>
              </span>
              <b>
                {formatInteger(countUnits(group.units))}
                <small>{group.pathProvinceIds.length} steps</small>
              </b>
            </p>
          ))}
        </div>
      )}
      <div className="sectionTitleRow warStatusTitle">
        <h2>City Garrisons</h2>
        <span>{military.cityGarrisons.length}</span>
      </div>
      {military.cityGarrisons.length === 0 ? (
        <p className="emptyState">No city garrisons</p>
      ) : (
        <div className="warRows">
          {military.cityGarrisons.slice(0, 6).map((garrison) => (
            <p key={garrison.cityId}>
              <span>
                <strong>{garrison.cityName}</strong>
                <em>{garrison.provinceName}</em>
              </span>
              <b>
                {formatInteger(garrison.totalSoldiers)}
                <small>{formatUnitMix(garrison.units)}</small>
              </b>
            </p>
          ))}
        </div>
      )}
      <div className="sectionTitleRow warStatusTitle">
        <h2>Recruitment Queue</h2>
        <span>{military.recruitmentQueue.length}</span>
      </div>
      {military.recruitmentQueue.length === 0 ? (
        <p className="emptyState">No active recruitment orders</p>
      ) : (
        <div className="warRows">
          {military.recruitmentQueue.slice(0, 6).map((order) => (
            <p key={order.id}>
              <span>
                <strong>{unitStats[order.unitType].label}</strong>
                <em>{world.cityById.get(order.cityId)?.name ?? order.cityId}</em>
              </span>
              <b>
                {formatInteger(order.amount)}
                <small>Ready {formatWorldTime(order.completesAtMonth)}</small>
              </b>
            </p>
          ))}
        </div>
      )}
      <div className="sectionTitleRow warStatusTitle">
        <h2>Active Wars</h2>
        <span>{military.activeWars.length}</span>
      </div>
      {military.activeWars.length === 0 ? (
        <p className="emptyState">No active wars</p>
      ) : (
        <div className="warRows">
          {military.activeWars.map((war) => (
            <p key={war.id}>
              <span>
                <strong>{world.nationById.get(war.enemyNationId)?.name ?? "Unknown nation"}</strong>
                <em>
                  Started {formatWorldTime(war.startedAtMonth)}
                  {war.targetProvinceId
                    ? ` / front ${world.provinceById.get(war.targetProvinceId)?.name ?? war.targetProvinceId}`
                    : ""}
                </em>
              </span>
              <b>
                Score {formatDecimal(war.attackerScore ?? 0, 1)} / {formatDecimal(war.defenderScore ?? 0, 1)}
                <small>{war.battleCount ?? 0} battles</small>
              </b>
            </p>
          ))}
        </div>
      )}
    </section>
  );
}

function DiplomacyStatusPanel({
  diplomacy,
  perspectiveNationId,
}: {
  diplomacy: NationDiplomacySummary;
  perspectiveNationId: string;
}) {
  const totalActive =
    diplomacy.wars.length +
    diplomacy.alliances.length +
    diplomacy.vassalContracts.length +
    (diplomacy.overlordContract ? 1 : 0) +
    diplomacy.truces.length +
    diplomacy.proposals.length;

  return (
    <section className="diplomacyStatusPanel">
      <div className="sectionTitleRow">
        <h2>Diplomacy Status</h2>
        <span>{totalActive} active</span>
      </div>
      {totalActive === 0 ? (
        <p className="emptyState">No wars, treaties, vassals, truces, or proposals</p>
      ) : (
        <div className="diplomacyStatusRows">
          {diplomacy.wars.map((war) => {
            const otherId = getOtherTreatyNationId(
              war.attackerNationId,
              war.defenderNationId,
              perspectiveNationId,
            );
            return (
              <p key={war.id}>
                <span>
                  <strong>War</strong>
                  <em>Started {formatWorldTime(war.startedAtMonth)}</em>
                </span>
                <b>{world.nationById.get(otherId)?.name ?? "Unknown"}</b>
              </p>
            );
          })}
          {diplomacy.alliances.map((alliance) => {
            const otherId = getOtherTreatyNationId(
              alliance.nationAId,
              alliance.nationBId,
              perspectiveNationId,
            );
            return (
              <p key={alliance.id}>
                <span>
                  <strong>Alliance</strong>
                  <em>{alliance.mutualDefense ? "Mutual defense" : "Limited treaty"}</em>
                </span>
                <b>{world.nationById.get(otherId)?.name ?? "Unknown"}</b>
              </p>
            );
          })}
          {diplomacy.overlordContract && (
            <p key={diplomacy.overlordContract.id}>
              <span>
                <strong>Vassal Of</strong>
                <em>{formatTribute(diplomacy.overlordContract)} tribute</em>
              </span>
              <b>{world.nationById.get(diplomacy.overlordContract.overlordNationId)?.name ?? "Unknown"}</b>
            </p>
          )}
          {diplomacy.vassalContracts.map((contract) => (
            <p key={contract.id}>
              <span>
                <strong>Vassal</strong>
                <em>{formatTribute(contract)} tribute</em>
              </span>
              <b>{world.nationById.get(contract.vassalNationId)?.name ?? "Unknown"}</b>
            </p>
          ))}
          {diplomacy.truces.map((truce) => {
            const otherId = getOtherTreatyNationId(
              truce.nationAId,
              truce.nationBId,
              perspectiveNationId,
            );
            return (
              <p key={truce.id}>
                <span>
                  <strong>Truce</strong>
                  <em>Expires {formatWorldTime(truce.expiresAtMonth)}</em>
                </span>
                <b>{world.nationById.get(otherId)?.name ?? "Unknown"}</b>
              </p>
            );
          })}
          {diplomacy.proposals.map((proposal) => (
            <p key={proposal.id}>
              <span>
                <strong>{formatProposalType(proposal.type)}</strong>
                <em>
                  {proposal.fromNationId === perspectiveNationId ? "Sent" : "Received"} / expires{" "}
                  {formatWorldTime(proposal.expiresAtMonth)}
                </em>
              </span>
              <b>{world.nationById.get(
                proposal.fromNationId === perspectiveNationId ? proposal.toNationId : proposal.fromNationId,
              )?.name ?? "Unknown"}</b>
            </p>
          ))}
        </div>
      )}
    </section>
  );
}

function formatTribute(contract: { goldTributeRate: number; resourceTributeRate: number }) {
  return `${Math.round(contract.goldTributeRate * 100)}% gold / ${Math.round(
    contract.resourceTributeRate * 100,
  )}% resources`;
}

function PolicyPanel({
  monthsUntilReview,
  policy,
}: {
  monthsUntilReview: number;
  policy: NationPolicyState | undefined;
}) {
  if (!policy) {
    return <p className="emptyState">No policy assessment available</p>;
  }

  return (
    <section className="policyPanel">
      <div className="sectionTitleRow">
        <h2>AI Policy</h2>
        <span>Next in {monthsUntilReview} months</span>
      </div>
      <div className="policyRows">
        <PolicyRow label="Expansion" policy={policy.expansion} />
        <PolicyRow label="Economy" policy={policy.economy} />
        <PolicyRow label="Diplomacy" policy={policy.diplomacy} />
      </div>
      <section className="spyMissionSection">
        <div className="sectionTitleRow">
          <h2>Spy Missions</h2>
          <span>{policy.spyMissions.length}/3 assigned</span>
        </div>
        <SpyMissionRows missions={policy.spyMissions} />
      </section>
    </section>
  );
}

function SpyNetworkPanel({
  currentMonth,
  spies,
}: {
  currentMonth: number;
  spies: NationSpySummary;
}) {
  return (
    <section className="spyNetworkPanel">
      <div className="sectionTitleRow">
        <h2>Spy Network</h2>
        <span>{spies.deployed.length}/3 deployed</span>
      </div>
      {spies.deployed.length === 0 ? (
        <p className="emptyState">No spies currently deployed</p>
      ) : (
        <div className="spyNetworkRows">
          {spies.deployed.map((operation) => {
            const target = world.nationById.get(operation.targetNationId)?.name ?? "Unknown nation";
            const secondaryTarget = operation.secondaryTargetNationId
              ? world.nationById.get(operation.secondaryTargetNationId)?.name
              : undefined;
            const monthsUntilActive = Math.max(0, operation.activatesAtMonth - currentMonth);

            return (
              <p key={operation.id}>
                <span>
                  <strong>{formatSpyMissionPolicy(operation.policy)}</strong>
                  <em>
                    {target}{secondaryTarget ? ` vs ${secondaryTarget}` : ""}
                  </em>
                </span>
                <b>
                  {operation.status === "deploying"
                    ? `Active in ${monthsUntilActive} mo`
                    : "Active"}
                  <small>Review {formatWorldTime(operation.expiresAtMonth)}</small>
                </b>
              </p>
            );
          })}
        </div>
      )}
      <div className="sectionTitleRow spyIntelTitle">
        <h2>Active Intelligence</h2>
        <span>{spies.intelligenceReports.length}</span>
      </div>
      {spies.intelligenceReports.length === 0 ? (
        <p className="emptyState">No active intelligence reports</p>
      ) : (
        <div className="spyNetworkRows">
          {spies.intelligenceReports.map((report) => (
            <p key={report.id}>
              <span>
                <strong>{world.nationById.get(report.targetNationId)?.name ?? "Unknown nation"}</strong>
                <em>
                  Army {formatInteger(report.army)} / Gold {formatInteger(report.monthlyGold)}/mo
                </em>
              </span>
              <b>
                {formatIntelResources(report.monthlyResources)}
                <small>
                  {report.expiresAtMonth
                    ? `Expires ${formatWorldTime(report.expiresAtMonth)}`
                    : "Current report"}
                </small>
              </b>
            </p>
          ))}
        </div>
      )}
    </section>
  );
}

function PolicyRow({
  label,
  policy,
}: {
  label: string;
  policy: NationPolicyState["expansion" | "economy" | "diplomacy"];
}) {
  const targetNation = policy.targetNationId ? world.nationById.get(policy.targetNationId) : undefined;

  return (
    <p>
      <span>
        <strong>{label}</strong>
        <em>{policy.rationale}</em>
      </span>
      <b>
        {policy.label}
        {(targetNation || policy.targetResource) && (
          <small>
            {targetNation ? targetNation?.name : ""}
            {targetNation && policy.targetResource ? " / " : ""}
            {policy.targetResource ? formatResourceName(policy.targetResource) : ""}
          </small>
        )}
      </b>
    </p>
  );
}

function SpyMissionRows({ missions }: { missions: NationPolicyState["spyMissions"] }) {
  if (missions.length === 0) {
    return <p className="emptyState">No active spy mission intent</p>;
  }

  return (
    <div className="spyMissionRows">
      {missions.map((mission) => {
        const targetNation = mission.targetNationId ? world.nationById.get(mission.targetNationId) : undefined;
        const secondaryTarget = mission.secondaryTargetNationId
          ? world.nationById.get(mission.secondaryTargetNationId)
          : undefined;

        return (
          <p key={mission.id}>
            <span>
              <strong>{mission.label}</strong>
              <em>{mission.rationale}</em>
            </span>
            <b>
              {targetNation ? targetNation?.name : "No target"}
              {secondaryTarget && <small>vs {secondaryTarget?.name}</small>}
            </b>
          </p>
        );
      })}
    </div>
  );
}

function CityRows({
  cities,
  onSelectCity,
}: {
  cities: City[];
  onSelectCity?: (cityId: string) => void;
}) {
  if (cities.length === 0) {
    return <p className="emptyState">No cities founded</p>;
  }

  return (
    <div className="cityRows">
      {cities.map((city) => {
        const province = world.provinceById.get(city.provinceId);
        const content = (
          <>
            <span>
              <strong>{city.name}</strong>
              <em>{province ? province?.name ?? "Unknown province" : "Unknown province"}</em>
            </span>
            <b>
              {city.isCapital ? "Capital" : (city.tipo ?? "pueblo") === "ciudad" ? `Ciudad Nv ${city.level}` : "Pueblo"}
              <small>{formatPopulation(city.population)}</small>
            </b>
          </>
        );

        if (onSelectCity) {
          return (
            <button key={city.id} onClick={() => onSelectCity(city.id)} type="button">
              {content}
            </button>
          );
        }

        return (
          <p key={city.id}>
            {content}
          </p>
        );
      })}
    </div>
  );
}

function RelationRows({
  perspectiveNationId,
  relations,
}: {
  perspectiveNationId?: string;
  relations: NationRelation[];
}) {
  if (relations.length === 0) {
    return <p className="emptyState">No known relations</p>;
  }

  return (
    <div className="relationRows">
      {relations.map((relation) => {
        const otherId = perspectiveNationId ? otherNationId(relation, perspectiveNationId) : undefined;
        const nationA = world.nationById.get(relation.nationAId);
        const nationB = world.nationById.get(relation.nationBId);
        const label = otherId
          ? world.nationById.get(otherId) ? world.nationById.get(otherId)?.name : "Unknown nation"
          : `${nationA ? nationA?.name : "Unknown"} / ${nationB ? nationB?.name : "Unknown"}`;

        return (
          <p key={`${relation.nationAId}-${relation.nationBId}`}>
            <span>
              <strong>{label}</strong>
              <em>Attitude {relation.attitude}</em>
            </span>
            <b className={`attitudeBadge ${attitudeClassName(relation.attitude)}`}>
              {getAttitudeLabel(relation.attitude)}
            </b>
          </p>
        );
      })}
    </div>
  );
}

function ResourceRows({
  includeZero = false,
  suffix = "",
  totals,
}: {
  includeZero?: boolean;
  suffix?: string;
  totals: ResourceTotals;
}) {
  const entries = Object.entries(totals).filter(([, amount]) => includeZero || amount > 0);

  if (entries.length === 0) {
    return <p className="emptyState">No resources discovered</p>;
  }

  return (
    <div className="resourceRows">
      {entries
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([resource, amount]) => (
          <p key={resource}>
            <span>{formatResourceName(resource as Resource)}</span>
            <strong>
              {amount}
              {suffix ? ` ${suffix}` : ""}
            </strong>
          </p>
        ))}
    </div>
  );
}

function attitudeClassName(attitude: number) {
  const label = getAttitudeLabel(attitude).toLowerCase();
  return label as "friendly" | "hostile" | "neutral" | "trusted" | "wary";
}

function formatWorldTime(elapsedMonths: number) {
  const year = Math.floor(elapsedMonths / 12) + 1;
  const month = (elapsedMonths % 12) + 1;
  return `Year ${year}, Month ${month}`;
}

function formatIntelResources(resources: ResourceTotals) {
  const output = Object.entries(resources)
    .filter(([, amount]) => amount > 0)
    .map(([resource, amount]) => `${formatResourceName(resource as Resource)} ${amount}`)
    .join(", ");
  return output || "No resources";
}

function countUnits(units: ArmyUnits) {
  return unitTypes.reduce((sum, type) => sum + units[type], 0);
}

function formatUnitMix(units: ArmyUnits) {
  return unitTypes
    .filter((type) => units[type] > 0)
    .map((type) => `${unitStats[type].label.split(" ")[0]} ${units[type]}`)
    .join(", ");
}

function formatArmyStance(stance: ArmyStance) {
  switch (stance) {
    case "attack":
      return "Attack";
    case "defend":
      return "Defend";
    case "garrison":
      return "Garrison";
    case "raid":
      return "Raid";
    case "rally":
      return "Rally";
    case "retreat":
      return "Retreat";
  }
}

function buildCityStats(cityId: string | undefined) {
  if (!cityId) {
    return undefined;
  }

  const city = world.cityById.get(cityId);
  if (!city) {
    return undefined;
  }

  const nation = world.nationById.get(city.nationId);
  const province = world.provinceById.get(city.provinceId);
  if (!nation || !province) {
    return undefined;
  }
  const economy = calculateCityEconomy(city, world);

  return {
    buildingSlots: city.isCapital ? 12 : 8,
    city,
    economy,
    nation,
    province,
  };
}

function buildNationStats(
  nationId: string | undefined,
  stockpile: NationStockpile | undefined,
  policy: NationPolicyState | undefined,
  relations: NationRelations,
  defeatedNations: Record<string, DefeatedNationRecord>,
  diplomacy: Parameters<typeof getNationDiplomacySummary>[0],
  military: MilitaryState,
  spies: SpyNetwork,
  elapsedMonths: number,
  eraStates?: Record<string, EraState>,
) {
  if (!nationId) {
    return undefined;
  }

  const nation = world.nationById.get(nationId);
  if (!nation) {
    return undefined;
  }

  const provinces = world.provinces.filter((province) => province.nationId === nationId);
  const provinceIds = new Set(provinces.map((province) => province.id));
  const tiles = world.tiles.filter((tile) => tile.provinceId && provinceIds.has(tile.provinceId));
  const cities = world.cities
    .filter((city) => city.nationId === nationId)
    .sort((a, b) => Number(b.isCapital) - Number(a.isCapital) || b.population - a.population);
  const defeatRecord = defeatedNations[nationId];
  const isDefeated = Boolean(defeatRecord) || isNationDefeated(world, nationId);
  const puebloCount = cities.filter((city) => (city.tipo ?? "pueblo") === "pueblo").length;
  const ciudadCount = cities.length - puebloCount;
  const tileCount = tiles.length;
  const capitalCity =
    (nation.capitalCityId ? world.cityById.get(nation.capitalCityId) : undefined) ??
    cities.find((city) => city.isCapital);
  const capitalName = capitalCity?.name ?? world.provinceById.get(nation.capitalProvinceId)?.name ?? "Unknown";
  const era = getNationEra(nationId, eraStates ?? {});
  const eraEmoji = formatEraEmoji(era);
  const eraLabel = formatEraLabel(era);
  const cityEconomy = calculateNationCityEconomy(nationId, world);
  const monthlyIncome = calculateNationMonthlyIncome(world, nationId);
  const monthlyOutput: ResourceTotals = {};
  const resourceSiteCounts: ResourceTotals = {};

  for (const tile of tiles) {
    const yieldValue = getTileMonthlyYield(tile);
    if (!yieldValue) {
      continue;
    }

    addYield(monthlyOutput, yieldValue);
    resourceSiteCounts[yieldValue.resource] = (resourceSiteCounts[yieldValue.resource] ?? 0) + 1;
  }

  return {
    capitalName,
    era,
    eraEmoji,
    eraLabel,
    cityCount: cities.length,
    puebloCount,
    ciudadCount,
    tileCount,
    cityEconomy,
    currentResources: stockpile?.resources ?? {},
    defeatRecord,
    diplomacy: getNationDiplomacySummary(diplomacy, nationId),
    majorCities: cities.slice(0, 6),
    isDefeated,
    monthlyIncome,
    monthlyOutput,
    monthsUntilPolicyReview: policy ? Math.max(0, policy.nextDecisionMonth - elapsedMonths) : 0,
    military: getNationWarSummary(diplomacy, military, world, nationId),
    nation,
    policy,
    provinceCount: provinces.length,
    relations: getNationRelationsFor(relations, nationId),
    resourceSiteCount: Object.values(resourceSiteCounts).reduce((sum, count) => sum + count, 0),
    resourceSiteCounts,
    stockpile: stockpile ?? { gold: 0, resources: {} },
    spies: getNationSpySummary(spies, nationId, elapsedMonths),
    currentMonth: elapsedMonths,
  };
}

function buildProvinceStats(provinceId: string | undefined) {
  if (!provinceId) {
    return undefined;
  }

  const province = world.provinceById.get(provinceId);
  if (!province) {
    return undefined;
  }

  if (!province.nationId) {
    return undefined;
  }
  const nation = world.nationById.get(province.nationId);
  if (!nation) {
    return undefined;
  }

  const tiles = world.tiles.filter((tile) => tile.provinceId === provinceId);
  const sums = tiles.reduce(
    (total, tile) => ({
      elevation: total.elevation + tile.elevation,
      temperature: total.temperature + tile.temperature,
      moisture: total.moisture + tile.moisture,
    }),
    { elevation: 0, temperature: 0, moisture: 0 },
  );

  return {
    province,
    nation,
    elevation: percentAverage(sums.elevation, tiles),
    temperature: percentAverage(sums.temperature, tiles),
    moisture: percentAverage(sums.moisture, tiles),
    terrainCounts: countBy(tiles, (tile) => tile.terrain),
    resourceCounts: countBy(
      tiles.filter((tile) => tile.resource),
      (tile) => tile.resource,
    ),
  };
}

function percentAverage(sum: number, tiles: Tile[]) {
  if (tiles.length === 0) {
    return 0;
  }

  return Math.round((sum / tiles.length) * 100);
}

function countBy<T extends string>(
  tiles: Tile[],
  selector: (tile: Tile) => T | undefined,
) {
  return tiles.reduce<Record<T, number>>(
    (counts, tile) => {
      const key = selector(tile);
      if (key) {
        counts[key] = (counts[key] ?? 0) + 1;
      }
      return counts;
    },
    {} as Record<T, number>,
  );
}

/**
 * 对既有原型 DOM 做集中式本地化，保留英文源文本以支持无损往返切换。
 * Pixi 画布中的文本由 WorldMap 组件直接按语言渲染。
 */
function useDomLocalization(rootRef: React.RefObject<HTMLElement | null>, language: Language) {
  const sourceTextsRef = useRef(new WeakMap<Text, string>());
  const sourceAttributesRef = useRef(new WeakMap<Element, Map<string, string>>());
  const previousLanguageRef = useRef<Language>(language);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const attributes = ["aria-label", "title", "placeholder"];

    const applyText = (node: Text, comparisonLanguage = language) => {
      const current = node.data;
      const previousSource = sourceTextsRef.current.get(node);
      const previousLocalized = previousSource === undefined ? undefined : localizeText(previousSource, comparisonLanguage, world);
      const source = previousSource === undefined || (current !== previousSource && current !== previousLocalized)
        ? current
        : previousSource;
      sourceTextsRef.current.set(node, source);
      const localized = localizeText(source, language, world);
      if (node.data !== localized) node.data = localized;
    };

    const applyElement = (element: Element, comparisonLanguage = language) => {
      const stored = sourceAttributesRef.current.get(element) ?? new Map<string, string>();
      for (const attribute of attributes) {
        const current = element.getAttribute(attribute);
        if (current === null) continue;
        const previousSource = stored.get(attribute);
        const previousLocalized = previousSource === undefined ? undefined : localizeText(previousSource, comparisonLanguage, world);
        const source = previousSource === undefined || (current !== previousSource && current !== previousLocalized)
          ? current
          : previousSource;
        stored.set(attribute, source);
        const localized = localizeText(source, language, world);
        if (current !== localized) element.setAttribute(attribute, localized);
      }
      sourceAttributesRef.current.set(element, stored);
    };

    const applyTree = (node: Node, comparisonLanguage = language) => {
      if (node.nodeType === Node.TEXT_NODE) applyText(node as Text, comparisonLanguage);
      if (node.nodeType === Node.ELEMENT_NODE) {
        const element = node as Element;
        // Vía B: eventos generados en el idioma activo no se re-traducen.
        if (element.hasAttribute?.("data-lang") && element.getAttribute("data-lang") === language) return;
        applyElement(element, comparisonLanguage);
        node.childNodes.forEach((child) => applyTree(child, comparisonLanguage));
      }
    };

    applyTree(root, previousLanguageRef.current);
    previousLanguageRef.current = language;
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === "characterData") applyText(mutation.target as Text);
        mutation.addedNodes.forEach((node) => applyTree(node));
        if (mutation.type === "attributes") applyElement(mutation.target as Element);
      }
    });
    observer.observe(root, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: attributes });
    return () => observer.disconnect();
  }, [language, rootRef]);
}

function formatCounts(counts: Partial<Record<Terrain | Resource, number>>) {
  return Object.entries(counts)
    .sort(([, a], [, b]) => b - a)
    .map(([key, value]) => `${key} ${value}`)
    .join(", ");
}
