import { buildDemoWorld } from "../src/world/buildDemoWorld";
import {
  canAffordFirstQuota,
  canStartConstruction,
  createConstructionProject,
  formatConstructionBudget,
  getBuildingConfigRows,
  getConstructionSpec,
  getEraConfigTable,
  indexFabricas,
  indexProvinceBuildings,
  missingQuota,
  normalizeConstructionCost,
  progressConstruction,
} from "../src/world/construction";
import {
  eraChangeCost,
  eraCostFactor,
  eraExploreDiscount,
  eraProductionBonus,
  isKindUnlockedByEra,
  nextEra,
} from "../src/world/era";
import {
  getLiveBaseCosts,
  getLiveMaintenanceCosts,
  resetLiveConstructionConfig,
  setLiveBaseCosts,
  setLiveMaintenanceCosts,
} from "../src/world/constructionConfig";
import { calculatePeacefulExpandCost } from "../src/world/policyAI";
import { fabricaAttackBonus, stableFootSpeedBonus, unitStats } from "../src/world/war";
import { createInitialSimulationState, resolveTurn } from "../src/world/turnSimulation";

describe("construcción (Ingeniería)", () => {
  test("costos de tabla se normalizan a recursos reales (wood→timber, stone→coal, steel→iron)", () => {
    const normalized = normalizeConstructionCost({ wood: 10, stone: 5 });
    expect(normalized).toEqual({ gold: 0, resources: { timber: 10, coal: 5 } });
    expect(formatConstructionBudget({ wood: 10, stone: 5, gold: 5 })).toBe("5 oro + 10 timber + 5 coal");
    expect(formatConstructionBudget({})).toBe("sin costo");
  });

  test("sin fondos no arranca; con fondos cobra la cuota y termina", () => {
    const cost = { wood: 10, stone: 5 };
    expect(canStartConstruction(cost, { gold: 0, water: 0, resources: {} })).toBe(false);
    const stockpile: any = { gold: 0, water: 0, resources: { timber: 100, coal: 100 } };
    expect(canStartConstruction(cost, stockpile)).toBe(true);
    const project = createConstructionProject("n1", "p1", "stone", true, "seed", 1);
    expect(project.remainingTurns).toBe(1);
    const result = progressConstruction([project], { n1: stockpile }, 2);
    expect(result.completed).toHaveLength(1);
    expect(project.status).toBe("complete");
    expect(stockpile.resources.timber).toBeLessThan(100);
  });

  test("obra parada sin cuota del turno (no avanza ni termina)", () => {
    const project = createConstructionProject("n1", "p1", "medieval", true, "seed", 1);
    expect(project.remainingTurns).toBe(2);
    const stockpile: any = { gold: 0, water: 0, resources: {} };
    const result = progressConstruction([project], { n1: stockpile }, 2);
    expect(result.completed).toHaveLength(0);
    expect(project.status).toBe("building");
    expect(project.remainingTurns).toBe(2);
  });

  test("resolveTurn: nación con construction + fondos crea obra y evento 🚧 con budget", () => {
    const world = buildDemoWorld("construccion-001", { nationCount: 2 });
    const simulation = createInitialSimulationState(world);
    const nationId = world.nations[0].id;
    simulation.nationPolicies[nationId].economy.policy = "construction";
    simulation.nationStockpiles[nationId] = {
      gold: 100000,
      water: 100000,
      resources: { grain: 100000, timber: 100000, iron: 100000, coal: 100000, oil: 100000 },
    };
    const next = resolveTurn(world, simulation, 1);
    expect(next.constructionProjects.length).toBeGreaterThanOrEqual(1);
    const started = next.events.find((e) => e.kind === "construction" && e.title.includes("🚧"));
    expect(started).toBeDefined();
    expect(started!.description).toMatch(/timber/);
    expect(started!.nationIds).toContain(nationId);
  });

  test("resolveTurn: sin policy construction no nace ninguna obra", () => {
    const world = buildDemoWorld("construccion-002", { nationCount: 2 });
    const simulation = createInitialSimulationState(world);
    for (const nation of world.nations) {
      simulation.nationPolicies[nation.id].economy.policy = "recovery";
    }
    const next = resolveTurn(world, simulation, 1);
    expect(next.constructionProjects).toHaveLength(0);
    expect(next.events.some((e) => e.kind === "construction")).toBe(false);
  });

  test("cuartel stone: 12 timber + 6 coal en 3 turnos; establo 4 turnos", () => {
    const barracks = getConstructionSpec("barracks", "stone", false);
    expect(barracks.turns).toBe(3);
    expect(barracks.cost).toEqual({ timber: 12, coal: 6 });
    expect(canAffordFirstQuota(barracks.cost, barracks.turns, { gold: 0, water: 0, resources: { timber: 4, coal: 2 } })).toBe(true);
    expect(canAffordFirstQuota(barracks.cost, barracks.turns, { gold: 0, water: 0, resources: {} })).toBe(false);
    expect(missingQuota(barracks.cost, barracks.turns, { gold: 0, water: 0, resources: {} })).toMatch(/timber/);
    const stable = getConstructionSpec("stable", "stone", true);
    expect(stable.turns).toBe(4);
  });

  test("resolveTurn: primera obra es cuartel y el índice cuenta edificios", () => {
    const world = buildDemoWorld("construccion-003", { nationCount: 2 });
    const simulation = createInitialSimulationState(world);
    const nationId = world.nations[0].id;
    simulation.nationPolicies[nationId].economy.policy = "construction";
    simulation.nationStockpiles[nationId] = {
      gold: 100000,
      water: 100000,
      resources: { grain: 100000, timber: 100000, iron: 100000, coal: 100000, oil: 100000 },
    };
    const next = resolveTurn(world, simulation, 1);
    const mine = next.constructionProjects.filter((p) => p.nationId === nationId);
    expect(mine.length).toBeGreaterThanOrEqual(1);
    expect(mine[0].kind).toBe("barracks");
    expect(indexProvinceBuildings(next.constructionProjects)[mine[0].provinceId]).toBeUndefined();
  });

  test("caballería: stats firmados y upkeep doble de infantería", () => {
    expect(unitStats.caballeria.attack).toBe(6);
    expect(unitStats.caballeria.defense).toBe(4);
    expect(unitStats.caballeria.hp).toBe(90);
    expect(unitStats.caballeria.speed).toBe(2);
    expect(unitStats.caballeria.recruitGold).toBe(2.5);
    expect(unitStats.caballeria.upkeepGold).toBeCloseTo(unitStats.infantry.upkeepGold * 2, 10);
  });

  test("buff establo: +25% a pie solo con origen con establo", () => {
    const foot = { militia: 8, infantry: 2, lightCavalry: 0, heavyCavalry: 0, levy: 0, caballeria: 0 };
    expect(stableFootSpeedBonus(foot, true)).toBeCloseTo(1.25, 10);
    expect(stableFootSpeedBonus(foot, false)).toBe(1);
    const mixed = { militia: 5, infantry: 0, lightCavalry: 5, heavyCavalry: 0, levy: 0, caballeria: 0 };
    expect(stableFootSpeedBonus(mixed, true)).toBeCloseTo(1.125, 10);
  });

  test("anexión con establo: mitad de costo", () => {
    const world = buildDemoWorld("construccion-004", { nationCount: 2, freeProvinceRatio: 0.3 });
    const tile = world.tiles.find((t) => t.provinceId && !world.provinceById.get(t.provinceId)?.nationId);
    expect(tile).toBeDefined();
    expect(calculatePeacefulExpandCost(tile!, world).gold).toBe(1);
    expect(calculatePeacefulExpandCost(tile!, world, true).gold).toBe(0.5);
    expect(calculatePeacefulExpandCost(tile!, world, false, 0.95).gold).toBeCloseTo(0.95, 10);
  });
});

describe("era como buff (costos base × factor)", () => {
  test("helpers de era: factor, siguiente, costo, bonus, dto y gates", () => {
    expect(eraCostFactor("stone")).toBe(1);
    expect(eraCostFactor("ancient")).toBe(1.2);
    expect(eraCostFactor("medieval")).toBeCloseTo(1.44, 10);
    expect(nextEra("stone")).toBe("ancient");
    expect(nextEra("contemporary")).toBeUndefined();
    expect(eraChangeCost("ancient")).toBe(10);
    expect(eraChangeCost("medieval")).toBe(100);
    expect(eraChangeCost("contemporary")).toBe(100000);
    expect(eraProductionBonus("ancient")).toBe(0.01);
    expect(eraProductionBonus("contemporary")).toBe(0.08);
    expect(eraExploreDiscount("ancient")).toBe(0.95);
    expect(isKindUnlockedByEra("mina_hierro", "stone")).toBe(false);
    expect(isKindUnlockedByEra("mina_hierro", "ancient")).toBe(true);
    expect(isKindUnlockedByEra("fabrica_armas", "stone")).toBe(false);
    expect(isKindUnlockedByEra("obra", "stone")).toBe(true);
  });

  test("spec obra ancient = base ×1.2 (sin oro ni hierro: base piedra)", () => {
    const spec = getConstructionSpec("obra", "ancient", false);
    expect(spec.turns).toBe(1);
    expect(spec.cost).toEqual({ timber: 12, coal: 6 });
    const capital = getConstructionSpec("obra", "ancient", true);
    expect(capital.cost).toEqual({ timber: 10, coal: 5 });
  });

  test("spec mina/fábrica: turnos fijos y gate por era en advanceConstruction", () => {
    expect(getConstructionSpec("mina_hierro", "ancient", false).turns).toBe(2);
    expect(getConstructionSpec("fabrica_armas", "ancient", false).turns).toBe(3);
    expect(getConstructionSpec("fabrica_armas", "ancient", false).cost).toEqual({ timber: 72, gold: 36, iron: 24 });
  });

  test("live store: override válido aplica, inválido se rechaza", () => {
    resetLiveConstructionConfig();
    expect(getLiveBaseCosts().obra).toEqual({ wood: 10, stone: 5 });
    expect(getLiveMaintenanceCosts().mina_carbon).toBe(2);
    expect(getLiveMaintenanceCosts().barracks).toBe(10);
    expect(setLiveBaseCosts({ obra: { wood: 99 } })).toBe(true);
    expect(getLiveBaseCosts().obra).toEqual({ wood: 99 });
    expect(setLiveBaseCosts({ obra: { wood: "x" } })).toBe(false);
    expect(setLiveMaintenanceCosts({ barracks: 3 })).toBe(true);
    expect(getLiveMaintenanceCosts().barracks).toBe(3);
    expect(setLiveMaintenanceCosts({ barracks: -1 })).toBe(false);
    resetLiveConstructionConfig();
    expect(getLiveBaseCosts().obra).toEqual({ wood: 10, stone: 5 });
  });

  test("tablas config GUI: 6 eras, 3 civiles, 3 militares", () => {
    resetLiveConstructionConfig();
    const eras = getEraConfigTable();
    expect(eras).toHaveLength(6);
    expect(eras[0]).toMatchObject({ era: "stone", changeCostGold: null, costFactor: 1 });
    expect(eras[1]).toMatchObject({ era: "ancient", changeCostGold: 10, costFactor: 1.2, productionBonusPct: 1 });
    expect(eras[1].unlocks).toEqual(expect.arrayContaining(["mina_hierro", "fabrica_armas"]));
    const civiles = getBuildingConfigRows(["obra", "mina_carbon", "aserradero", "mina_hierro"]);
    expect(civiles).toHaveLength(4);
    expect(civiles[0]).toMatchObject({ kind: "obra", label: "Obra Civil - Pueblo" });
    const militares = getBuildingConfigRows(["barracks", "stable", "fabrica_armas"]);
    expect(militares.map((r) => r.kind)).toEqual(["barracks", "stable", "fabrica_armas"]);
    expect(militares[2].maintenanceGold).toBe(10);
  });

  test("transición de era por policy: cobra, cambia y emite 🏛️", () => {
    resetLiveConstructionConfig();
    const world = buildDemoWorld("era-policy-001", { nationCount: 2 });
    const simulation = createInitialSimulationState(world);
    const nationId = world.nations[0].id;
    simulation.nationStockpiles[nationId] = {
      gold: 100000, water: 100000,
      resources: { grain: 0, timber: 0, iron: 0, coal: 0, oil: 0 },
    };
    simulation.nationPolicies[nationId].economy.policy = "recovery";
    simulation.nationPolicies[nationId].era = {
      policy: "advance_era", label: "Advance Era", rationale: "test",
      decidedAtMonth: 1, nextDecisionMonth: 3,
    };
    const next = resolveTurn(world, simulation, 1);
    expect(next.eraState[nationId].currentEra).toBe("ancient");
    const paid = next.events.find((e) => e.kind === "era" && e.title.includes("🏛️"));
    expect(paid).toBeDefined();
    expect(paid!.description).toMatch(/pagando 10 oro/);
    expect(next.nationStockpiles[nationId].gold).toBeGreaterThanOrEqual(0);
  });

  test("transición bloqueada sin oro: evento 🚫 y sin cambio", () => {
    resetLiveConstructionConfig();
    const world = buildDemoWorld("era-policy-002", { nationCount: 2 });
    const simulation = createInitialSimulationState(world);
    const nationId = world.nations[0].id;
    // Costo inalcanzable para probar la rama bloqueada sin depender de ingresos.
    const { ERA_CHANGE_COST_GOLD } = require("../src/world/era");
    const prev = ERA_CHANGE_COST_GOLD.ancient;
    ERA_CHANGE_COST_GOLD.ancient = 1e15;
    try {
      simulation.nationStockpiles[nationId] = {
        gold: 0, water: 0, resources: { grain: 0, timber: 0, iron: 0, coal: 0, oil: 0 },
      };
      simulation.nationPolicies[nationId].economy.policy = "recovery";
      simulation.nationPolicies[nationId].era = {
        policy: "advance_era", label: "Advance Era", rationale: "test",
        decidedAtMonth: 1, nextDecisionMonth: 3,
      };
      const next = resolveTurn(world, simulation, 1);
      expect(next.eraState[nationId].currentEra).toBe("stone");
      expect(next.events.some((e) => e.kind === "era" && e.title.includes("🚫"))).toBe(true);
    } finally {
      ERA_CHANGE_COST_GOLD.ancient = prev;
    }
  });

  test("transición dispara una sola vez por decisión (sin re-disparo)", () => {
    resetLiveConstructionConfig();
    const world = buildDemoWorld("era-policy-003", { nationCount: 2 });
    const simulation = createInitialSimulationState(world);
    const nationId = world.nations[0].id;
    simulation.nationStockpiles[nationId] = {
      gold: 100000, water: 100000,
      resources: { grain: 0, timber: 0, iron: 0, coal: 0, oil: 0 },
    };
    simulation.nationPolicies[nationId].economy.policy = "recovery";
    simulation.nationPolicies[nationId].era = {
      policy: "advance_era", label: "Advance Era", rationale: "test",
      decidedAtMonth: 0, nextDecisionMonth: 3,
    };
    const next = resolveTurn(world, simulation, 1);
    expect(next.eraState[nationId].currentEra).toBe("stone");
    expect(next.events.some((e) => e.kind === "era")).toBe(false);
  });

  test("fábrica: buff ×1.01 e índice por provincia", () => {
    expect(fabricaAttackBonus(true)).toBe(1.01);
    expect(fabricaAttackBonus(false)).toBe(1);
    expect(indexFabricas([{ id: "f1", nationId: "n1", provinceId: "p1", era: "ancient", activa: true }])).toEqual({ p1: "n1" });
    expect(indexFabricas([{ id: "f1", nationId: "n1", provinceId: "p1", era: "ancient", activa: false }])).toEqual({});
  });
});
