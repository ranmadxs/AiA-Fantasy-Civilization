import { buildDemoWorld } from "../src/world/buildDemoWorld";
import { advanceConstruction, createInitialSimulationState } from "../src/world/turnSimulation";
import type { ConstructionKind, ConstructionProject } from "../src/world/construction";

jest.setTimeout(60000);

function forceAncientAndRich(sim: ReturnType<typeof createInitialSimulationState>, world: ReturnType<typeof buildDemoWorld>) {
  for (const nation of world.nations) {
    const st = sim.eraState[nation.id];
    if (st) {
      st.currentEra = "ancient";
      st.unlockedAt = 0;
    }
    const sp = sim.nationStockpiles[nation.id];
    if (sp) {
      sp.gold = 50000;
      sp.resources.grain = 5000;
      sp.resources.timber = 5000;
      sp.resources.coal = 20000;
      sp.resources.iron = 5000;
    }
    const pol = sim.nationPolicies[nation.id];
    if (pol) {
      pol.economy = { policy: "construction", label: "Construction", rationale: "test", decidedAtMonth: 0, nextDecisionMonth: 99 };
    }
  }
  // Pueblos chicos: la cadena salta "obra" (exige origen ≥100 hab).
  for (const city of world.cities) city.population = 50;
}

function completeKind(sim: ReturnType<typeof createInitialSimulationState>, nationId: string, provinceId: string, kind: ConstructionKind) {
  const p: ConstructionProject = {
    id: `test-${kind}-${nationId}-${provinceId}`,
    nationId,
    provinceId,
    era: "ancient",
    kind,
    cost: {},
    totalTurns: 1,
    remainingTurns: 0,
    status: "complete",
    startedAt: 0,
  };
  sim.constructionProjects.push(p);
}

describe("pozo en era antigua (construcción directa)", () => {
  test("la cadena elige pozo saturado lo anterior y al terminar crea la entrada", () => {
    const world = buildDemoWorld("pozo-check");
    const sim = createInitialSimulationState(world);
    forceAncientAndRich(sim, world);
    const nationId = world.nations[0].id;
    const cityProvinces = [...new Set(
      world.cities.filter((c) => c.nationId === nationId).map((c) => c.provinceId),
    )];
    expect(cityProvinces.length).toBeGreaterThan(0);
    for (const pid of cityProvinces) {
      for (const kind of ["barracks", "granja", "stable", "obra", "mina_carbon", "aserradero"] as const) {
        completeKind(sim, nationId, pid, kind);
      }
    }

    const r1 = advanceConstruction(world, sim, sim.nationPolicies, sim.nationStockpiles, sim.eraState, 1);
    const started = r1.projects.find(
      (p) => p.nationId === nationId && p.kind === "pozo" && p.status === "building",
    );
    expect(started).toBeDefined();

    sim.constructionProjects = r1.projects;
    sim.nationStockpiles = r1.stockpiles;
    const r2 = advanceConstruction(world, sim, sim.nationPolicies, sim.nationStockpiles, sim.eraState, 2);
    expect(r2.pozos.length).toBeGreaterThan(0);
    const created = r2.events.find((e) => /Pozo operativo/.test(e.title));
    expect(created).toBeDefined();
  });
});
