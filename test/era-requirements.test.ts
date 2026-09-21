import { buildDemoWorld } from "../src/world/buildDemoWorld";
import { checkEraRequirements, ERA_REQUIREMENTS } from "../src/world/era";
import { advanceConstruction, createInitialSimulationState } from "../src/world/turnSimulation";

jest.setTimeout(60000);

function rich(sim: ReturnType<typeof createInitialSimulationState>, world: ReturnType<typeof buildDemoWorld>) {
  for (const nation of world.nations) {
    const sp = sim.nationStockpiles[nation.id];
    if (sp) {
      sp.gold = 100000;
      sp.resources.grain = 5000;
      sp.resources.timber = 5000;
      sp.resources.coal = 50000;
      sp.resources.iron = 5000;
    }
  }
}

describe("ERA_REQUIREMENTS (spec)", () => {
  test("constante según spec: sin reino para dark", () => {
    expect(ERA_REQUIREMENTS.ancient).toEqual({ minPueblos: 15 });
    expect(ERA_REQUIREMENTS.medieval).toEqual({ minPoblacion: 5000 });
    expect(ERA_REQUIREMENTS.modern).toEqual({ minReinosActivos: 1 });
    expect(ERA_REQUIREMENTS.contemporary).toEqual({ minPoblacion: 1000000 });
    expect(ERA_REQUIREMENTS.dark_medieval).toBeUndefined();
  });

  test("stone→ancient exige 15 pueblos", () => {
    const world = buildDemoWorld("era-req-1", { nationCount: 2, cityCount: 4 });
    const sim = createInitialSimulationState(world);
    const nationId = world.nations[0].id;
    const before = world.cities.filter((c) => c.nationId === nationId && (c.tipo ?? "pueblo") === "pueblo").length;
    expect(before).toBeLessThan(15);
    const fail = checkEraRequirements("ancient", world, nationId, []);
    expect(fail.met).toBe(false);
    expect(fail.faltan.join(" ")).toMatch(/pueblos/);
    // Cumple al llegar a 15 (ciudades extra del mismo tipo).
    const prov = world.provinces.find((p) => p.nationId === nationId)!;
    for (let i = before; i < 15; i += 1) {
      world.cities.push({
        id: `pc-${i}`, name: `P${i}`, nameEn: `P${i}`, nameZh: `P${i}`, nameEs: `P${i}`, nameId: `p${i}`,
        nationId, provinceId: prov.id, x: 0, y: 0, isCapital: false,
        population: 100, level: 1, tipo: "pueblo", tiles: 1,
      } as any);
    }
    expect(checkEraRequirements("ancient", world, nationId, []).met).toBe(true);
  });

  test("medieval mide vivos, no el máximo", () => {
    const world = buildDemoWorld("era-req-2", { nationCount: 2, cityCount: 4 });
    const nationId = world.nations[0].id;
    for (const c of world.cities) {
      if (c.nationId === nationId) {
        c.population = 100;
        c.level = 4;
      }
    }
    const fail = checkEraRequirements("medieval", world, nationId, []);
    expect(fail.met).toBe(false);
    expect(fail.faltan.join(" ")).toMatch(/población/);
    // 6000 vivos → cumple aunque el tope sea mucho mayor.
    const cities = world.cities.filter((c) => c.nationId === nationId);
    cities[0].population = 6000;
    expect(checkEraRequirements("medieval", world, nationId, []).met).toBe(true);
  });

  test("modern exige 1 reino activo; contemporary 1M de vivos", () => {
    const world = buildDemoWorld("era-req-3", { nationCount: 2, cityCount: 4 });
    const nationId = world.nations[0].id;
    expect(checkEraRequirements("modern", world, nationId, []).met).toBe(false);
    expect(checkEraRequirements("modern", world, nationId, [{ nationId, activo: true }]).met).toBe(true);
    expect(checkEraRequirements("modern", world, nationId, [{ nationId, activo: false }]).met).toBe(false);
    const cities = world.cities.filter((c) => c.nationId === nationId);
    cities[0].population = 1200000;
    expect(checkEraRequirements("contemporary", world, nationId, []).met).toBe(true);
    cities[0].population = 100;
    expect(checkEraRequirements("contemporary", world, nationId, []).met).toBe(false);
  });
});

describe("transición bloqueada por requisitos (sin descontar oro)", () => {
  test("sin 15 pueblos: evento, era intacta y oro intacto", () => {
    const world = buildDemoWorld("era-req-4", { nationCount: 2, cityCount: 4 });
    const sim = createInitialSimulationState(world);
    rich(sim, world);
    const nationId = world.nations[0].id;
    const goldBefore = sim.nationStockpiles[nationId].gold;
    sim.nationPolicies[nationId] = {
      ...(sim.nationPolicies[nationId] as any),
      era: { policy: "advance_era", label: "x", rationale: "test", decidedAtMonth: 1, nextDecisionMonth: 3 },
    } as any;
    const r = advanceConstruction(world, sim, sim.nationPolicies, sim.nationStockpiles, sim.eraState, 1);
    const blocked = r.events.find((e) => /Requisitos de era no cumplidos/.test(e.title));
    expect(blocked).toBeDefined();
    expect(r.eraState[nationId].currentEra).toBe("stone");
    expect(r.stockpiles[nationId].gold).toBe(goldBefore);
  });
});
