import { caravanaOutcome } from "../src/world/construction";
import { buildDemoWorld } from "../src/world/buildDemoWorld";
import { createInitialSimulationState, resolveTurn } from "../src/world/turnSimulation";

describe("caravana fundadora", () => {
  test("llegan 90-100, pérdida 0-10%, determinista", () => {
    const a = caravanaOutcome("seed-1", "proj-1", 5, 100);
    expect(a.arrival).toBeGreaterThanOrEqual(90);
    expect(a.arrival).toBeLessThanOrEqual(100);
    expect(a.deaths + a.deserters + a.arrival).toBe(100);
    const b = caravanaOutcome("seed-1", "proj-1", 5, 100);
    expect(b).toEqual(a);
  });

  test("con otra seed el resultado puede variar pero sigue en rango", () => {
    const c = caravanaOutcome("otra-seed", "proj-1", 5, 100);
    expect(c.arrival).toBeGreaterThanOrEqual(90);
    expect(c.arrival).toBeLessThanOrEqual(100);
  });

  test("repoblamiento: ciudad en 0 recibe caravana de ciudad con 500", () => {
    const world = buildDemoWorld("repob-001", { nationCount: 2, cityCount: 4 });
    const simulation = createInitialSimulationState(world);
    const nationId = world.nations[0].id;
    const cities = world.cities.filter((c) => c.nationId === nationId);
    expect(cities.length).toBeGreaterThanOrEqual(2);
    cities[0].population = 0;
    cities[1].population = 500;
    simulation.nationPolicies[nationId].economy.policy = "construction";
    simulation.nationStockpiles[nationId] = {
      gold: 100000,
      water: 100000,
      resources: { grain: 100000, timber: 100000, iron: 100000, coal: 100000, oil: 100000 },
    };
    resolveTurn(world, simulation, 1);
    expect(cities[0].population).toBeGreaterThanOrEqual(90);
    // Donante: 500 + vegetativo − 100 colonos (queda bajo 500, no vaciado).
    expect(cities[1].population).toBeLessThan(500);
    expect(cities[1].population).toBeGreaterThanOrEqual(300);
  });

  test("repoblamiento también en recovery (supervivencia, no infraestructura)", () => {
    const world = buildDemoWorld("repob-002", { nationCount: 2, cityCount: 4 });
    const simulation = createInitialSimulationState(world);
    const nationId = world.nations[0].id;
    const cities = world.cities.filter((c) => c.nationId === nationId);
    expect(cities.length).toBeGreaterThanOrEqual(2);
    cities[0].population = 0;
    cities[1].population = 500;
    simulation.nationPolicies[nationId].economy.policy = "recovery";
    simulation.nationStockpiles[nationId] = {
      gold: 100000,
      water: 100000,
      resources: { grain: 100000, timber: 100000, iron: 100000, coal: 100000, oil: 100000 },
    };
    resolveTurn(world, simulation, 1);
    expect(cities[0].population).toBeGreaterThanOrEqual(90);
  });

  test("proyecto creado el mismo turno del cambio de era usa la era nueva", () => {    const world = buildDemoWorld("era-stale-001", { nationCount: 2, cityCount: 6 });
    const simulation = createInitialSimulationState(world);
    const nationId = world.nations[0].id;
    simulation.nationPolicies[nationId].economy.policy = "construction";
    simulation.nationPolicies[nationId].era = {
      policy: "advance_era", label: "Advance Era", rationale: "test",
      decidedAtMonth: 1, nextDecisionMonth: 3,
    };
    simulation.nationStockpiles[nationId] = {
      gold: 100000, water: 100000,
      resources: { grain: 100000, timber: 100000, iron: 100000, coal: 100000, oil: 100000 },
    };
    const next = resolveTurn(world, simulation, 1);
    expect(next.eraState[nationId].currentEra).toBe("ancient");
    const mine = next.constructionProjects.filter((p) => p.nationId === nationId);
    expect(mine.length).toBeGreaterThanOrEqual(1);
    for (const p of mine) {
      expect(p.era).toBe(next.eraState[nationId].currentEra);
    }
  });

  test("sin ping-pong: el donante conserva piso 50 y no se invierten los roles", () => {
    const world = buildDemoWorld("pingpong-001", { nationCount: 2, cityCount: 4 });
    const simulation = createInitialSimulationState(world);
    const nationId = world.nations[0].id;
    const cities = world.cities.filter((c) => c.nationId === nationId);
    cities[0].population = 0;
    cities[1].population = 100;
    simulation.nationPolicies[nationId].economy.policy = "recovery";
    const m1 = resolveTurn(world, simulation, 1);
    // Donante de 100 envía 50 y queda en ~50+: nunca bajo el piso.
    expect(cities[1].population).toBeGreaterThanOrEqual(45);
    expect(cities[0].population).toBeGreaterThanOrEqual(40);
    // Mes 2: sin inversión de roles (el donante no pide rescate).
    const m2 = resolveTurn(world, m1, 2);
    expect(m2.events.some((e) => e.id === `event-repopulate-${cities[1].id}-${cities[0].id}-2`)).toBe(false);
  });
});
