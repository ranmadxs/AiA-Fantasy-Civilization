import { caravanaOutcome, trasladoOutcome } from "../src/world/construction";
import { buildDemoWorld } from "../src/world/buildDemoWorld";
import { createInitialSimulationState, resolveTurn } from "../src/world/turnSimulation";

describe("traslado entre ciudades (1 oro por tramo, decide la IA)", () => {
  test("0 tramos equivale a caravana; pérdida total topada en 25%", () => {
    const base = caravanaOutcome("s1", "p1", 3, 100);
    const t0 = trasladoOutcome("s1", "p1", 3, 100, 0);
    expect(t0).toEqual({ ...base });
    const t10 = trasladoOutcome("s1", "p1", 3, 100, 10);
    expect(t10.arrival + t10.deaths + t10.deserters).toBe(100);
    expect(t10.arrival).toBeLessThanOrEqual(t0.arrival);
    expect(100 - t10.arrival).toBeLessThanOrEqual(25);
    expect(trasladoOutcome("s1", "p1", 3, 100, 10)).toEqual(t10);
  });

  test("motor: exceso >10% se traslada a la más cercana con cupo", () => {
    const world = buildDemoWorld("traslado-001", { nationCount: 2, cityCount: 4 });
    const simulation = createInitialSimulationState(world);
    const nationId = world.nations[0].id;
    const cities = world.cities.filter((c) => c.nationId === nationId);
    expect(cities.length).toBeGreaterThanOrEqual(2);
    cities[0].population = 160;
    cities[1].population = 20;
    simulation.nationPolicies[nationId].economy.policy = "construction";
    const next = resolveTurn(world, simulation, 1);
    const evt = next.events.find((e) => e.id.startsWith("event-traslado-"));
    expect(evt).toBeDefined();
    expect(evt!.description).toMatch(/tramo/);
    expect(cities[0].population).toBeLessThan(160);
    expect(cities[1].population).toBeGreaterThan(20);
  });

  test("explícito LLM: respeta from/to/colonos", () => {
    const world = buildDemoWorld("traslado-002", { nationCount: 2, cityCount: 4 });
    const simulation = createInitialSimulationState(world);
    const nationId = world.nations[0].id;
    const cities = world.cities.filter((c) => c.nationId === nationId);
    cities[0].population = 160;
    cities[1].population = 20;
    (simulation.nationPolicies[nationId] as any).traslado = {
      fromCityId: cities[0].id, toCityId: cities[1].id, colonos: 30,
    };
    const next = resolveTurn(world, simulation, 1);
    expect(next.events.some((e) => e.id.startsWith("event-traslado-"))).toBe(true);
    expect(cities[0].population).toBeLessThan(160);
    expect(cities[1].population).toBeGreaterThan(21);
  });

  test("destino ajeno se ignora", () => {
    const world = buildDemoWorld("traslado-003", { nationCount: 2, cityCount: 4 });
    const simulation = createInitialSimulationState(world);
    const nationId = world.nations[0].id;
    const otherId = world.nations[1].id;
    const cities = world.cities.filter((c) => c.nationId === nationId);
    const foreign = world.cities.filter((c) => c.nationId === otherId);
    cities[0].population = 160;
    (simulation.nationPolicies[nationId] as any).traslado = {
      fromCityId: cities[0].id, toCityId: foreign[0].id, colonos: 30,
    };
    // Sin ciudad propia con cupo bajo: el motor tampoco debe mover al extranjero.
    for (const c of cities.slice(1)) c.population = 500;
    const next = resolveTurn(world, simulation, 1);
    expect(next.events.some((e) => e.id.startsWith("event-traslado-"))).toBe(false);
    expect(foreign[0].population).toBeLessThan(200);
  });
});
