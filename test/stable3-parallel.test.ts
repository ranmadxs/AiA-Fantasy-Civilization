import {
  BASE_CONSTRUCTION_COSTS,
  BUILDING_LIST,
  MAX_PROJECTS_PER_NATION,
} from "../src/world/configDefaults";
import {
  stableUpgrade3Eligible,
  stableUpgradeEligible,
} from "../src/world/construction";
import { buildDemoWorld } from "../src/world/buildDemoWorld";
import { advanceConstruction, createInitialSimulationState } from "../src/world/turnSimulation";
import { normalizeBuildOrders, normalizeUpgrade } from "../src/world/llmExecutor";

jest.setTimeout(60000);

function fakeWorld(): any {
  const tiles: any[] = [];
  for (let y = 0; y < 8; y += 1) {
    for (let x = 0; x < 8; x += 1) {
      tiles.push({ x, y, terrain: "plain", elevation: 0, temperature: 0, moisture: 0, provinceId: "p1" });
    }
  }
  return {
    seed: "stable3-test",
    width: 8,
    height: 8,
    tiles,
    nations: [],
    provinces: [],
    cities: [{
      id: "c1", name: "C", nameEn: "C", nameZh: "C", nameEs: "C", nameId: "c1",
      nationId: "n1", provinceId: "p1", x: 4, y: 4, isCapital: false,
      population: 500, level: 3, tipo: "pueblo", tiles: 1,
    }],
    provinceById: new Map(),
    nationById: new Map(),
    cityById: new Map(),
    provinceEdges: [],
    nationEdges: [],
  };
}

describe("establo niv.3", () => {
  test("gate: entry niv.2 + ciudad niv.3 + 5 tiles adyacentes", () => {
    const world = fakeWorld();
    const entry = { id: "e1", nationId: "n1", provinceId: "p1", era: "stone", activa: true, nivel: 2, x: 4, y: 4, tiles: 4 };
    expect(stableUpgrade3Eligible(world, "n1", "p1", [entry])).toBeDefined();
    expect(stableUpgrade3Eligible(world, "n1", "p1", [{ ...entry, nivel: 3 }])).toBeUndefined();
    expect(stableUpgrade3Eligible(world, "n1", "p1", [{ ...entry, nivel: 1 }])).toBeUndefined();
    expect(stableUpgradeEligible(world, "n1", "p1", [entry])).toBeUndefined();
  });

  test("completar stable con entry niv.2 → niv.3 y habilita carretas", () => {
    const world = buildDemoWorld("stable3-sim", { nationCount: 2, cityCount: 4 });
    const sim = createInitialSimulationState(world);
    const nationId = world.nations[0].id;
    for (const n of world.nations) {
      const st = sim.eraState[n.id];
      if (st) { st.currentEra = "ancient"; st.unlockedAt = 0; }
      const sp = sim.nationStockpiles[n.id];
      if (sp) {
        sp.gold = 100000;
        sp.resources.grain = 20000;
        sp.resources.timber = 20000;
        sp.resources.coal = 50000;
        sp.resources.iron = 20000;
      }
      const pol = sim.nationPolicies[n.id];
      if (pol) {
        pol.economy = { policy: "construction", label: "x", rationale: "t", decidedAtMonth: 0, nextDecisionMonth: 99 } as any;
      }
    }
    for (const c of world.cities) c.population = 50;
    // Entry niv.2 en una provincia con ciudad niv.3 de la nación.
    const city = world.cities.find((c) => c.nationId === nationId)!;
    city.level = 3;
    sim.aserraderos.push({
      id: "est-1", nationId, provinceId: city.provinceId, era: "ancient",
      activa: true, nivel: 2, x: city.x, y: city.y, tiles: 4,
    });
    sim.constructionProjects.push({
      id: "stable-up-3", nationId, provinceId: city.provinceId, era: "ancient",
      kind: "stable", cost: {}, totalTurns: 1, remainingTurns: 1,
      status: "building", startedAt: 0,
    } as any);
    const r = advanceConstruction(world, sim, sim.nationPolicies, sim.nationStockpiles, sim.eraState, 1);
    const up = r.aserraderos.find((a) => a.id === "est-1")!;
    expect(up.nivel).toBe(3);
    expect(r.events.some((e) => /Establo nivel 3/.test(e.title))).toBe(true);
  });
});

describe("3 proyectos en paralelo", () => {
  test("MAX_PROJECTS_PER_NATION es 3 y la cadena no duplica provincia", () => {
    expect(MAX_PROJECTS_PER_NATION).toBe(3);
    expect(BUILDING_LIST).toContain("stable");
    expect(BASE_CONSTRUCTION_COSTS.stable).toEqual({ wood: 20, stone: 10 });
  });

  test("nación sin obras inicia hasta 3 en un turno; con 3 no inicia más", () => {
    const world = buildDemoWorld("par3-sim", { nationCount: 2, cityCount: 6 });
    const sim = createInitialSimulationState(world);
    const nationId = world.nations[0].id;
    for (const n of world.nations) {
      const sp = sim.nationStockpiles[n.id];
      if (sp) {
        sp.gold = 100000;
        sp.resources.grain = 20000;
        sp.resources.timber = 20000;
        sp.resources.coal = 50000;
        sp.resources.iron = 20000;
      }
      const pol = sim.nationPolicies[n.id];
      if (pol) {
        pol.economy = { policy: "construction", label: "x", rationale: "t", decidedAtMonth: 0, nextDecisionMonth: 99 } as any;
      }
    }
    const r1 = advanceConstruction(world, sim, sim.nationPolicies, sim.nationStockpiles, sim.eraState, 1);
    const mine = r1.projects.filter((p) => p.nationId === nationId && p.status === "building");
    expect(mine.length).toBeGreaterThanOrEqual(1);
    expect(mine.length).toBeLessThanOrEqual(3);
    const provs = mine.map((p) => p.provinceId);
    expect(new Set(provs).size).toBe(provs.length);
  });
});

describe("intents upgrade/buildOrders", () => {
  test("normalize: upgrade válido, buildOrders filtra inválidos", () => {
    expect(normalizeUpgrade({ provinceId: "p1", kind: "stable" })).toEqual({ provinceId: "p1", kind: "stable" });
    expect(normalizeUpgrade({ provinceId: "p1", kind: "nuke" })).toBeUndefined();
    expect(normalizeUpgrade("x")).toBeUndefined();
    expect(normalizeBuildOrders([
      { provinceId: "p1", kind: "granja" },
      { provinceId: 5, kind: "granja" },
      { provinceId: "p2", kind: "nuke" },
    ])).toEqual([{ provinceId: "p1", kind: "granja" }]);
    expect(normalizeBuildOrders([])).toBeUndefined();
  });

  test("orden explícita válida se construye en la provincia pedida", () => {
    const world = buildDemoWorld("exp-ord", { nationCount: 2, cityCount: 6 });
    const sim = createInitialSimulationState(world);
    const nationId = world.nations[0].id;
    for (const n of world.nations) {
      const sp = sim.nationStockpiles[n.id];
      if (sp) {
        sp.gold = 100000;
        sp.resources.grain = 20000;
        sp.resources.timber = 20000;
        sp.resources.coal = 50000;
        sp.resources.iron = 20000;
      }
      const pol = sim.nationPolicies[n.id];
      if (pol) {
        pol.economy = { policy: "construction", label: "x", rationale: "t", decidedAtMonth: 0, nextDecisionMonth: 99 } as any;
      }
    }
    const target = world.provinces.find((p) => p.nationId === nationId && world.cities.some((c) => c.provinceId === p.id && c.nationId === nationId))!;
    (sim.nationPolicies[nationId] as any).buildOrdersList = [{ provinceId: target.id, kind: "granja" }];
    const r = advanceConstruction(world, sim, sim.nationPolicies, sim.nationStockpiles, sim.eraState, 1);
    const started = r.projects.find((p) => p.nationId === nationId && p.provinceId === target.id && p.kind === "granja");
    expect(started).toBeDefined();
    expect(r.events.some((e) => /Granja operativa/.test(e.title))).toBe(true);
  });
});
