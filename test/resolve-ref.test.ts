import { buildDemoWorld } from "../src/world/buildDemoWorld";
import { resolveProvinceRef } from "../src/world/construction";
import { validateMusterOrder } from "../src/world/war";
import { advanceConstruction, createInitialSimulationState } from "../src/world/turnSimulation";

jest.setTimeout(60000);

const ZERO = { militia: 0, infantry: 0, lightCavalry: 0, heavyCavalry: 0, levy: 0, caballeria: 0 };

describe("resolveProvinceRef: acepta provincia o ciudad propia", () => {
  test("provincia propia, ciudad propia → provincia, resto undefined", () => {
    const world = buildDemoWorld("ref-001", { nationCount: 2, cityCount: 4 });
    const nationId = world.nations[0].id;
    const prov = world.provinces.find((p) => p.nationId === nationId)!;
    const city = world.cities.find((c) => c.nationId === nationId)!;
    const foreignProv = world.provinces.find((p) => p.nationId !== undefined && p.nationId !== nationId)!;
    expect(resolveProvinceRef(world, nationId, prov.id)).toBe(prov.id);
    expect(resolveProvinceRef(world, nationId, city.id)).toBe(city.provinceId);
    expect(resolveProvinceRef(world, nationId, foreignProv.id)).toBeUndefined();
    expect(resolveProvinceRef(world, nationId, "no-existe")).toBeUndefined();
  });

  test("muster con provinceId usa la ciudad con mayor guarnición", () => {
    const world = buildDemoWorld("ref-002", { nationCount: 2, cityCount: 6 });
    const nationId = world.nations[0].id;
    const anchor = world.cities.find((c) => c.nationId === nationId)!;
    const provId = anchor.provinceId;
    world.cities.push({
      id: "extra-1", name: "E1", nameEn: "E1", nameZh: "E1", nameEs: "E1",
      nameId: "e1", nationId, provinceId: provId, x: 1, y: 1, isCapital: false,
      population: 100, level: 1, tipo: "pueblo", tiles: 1,
    } as any);
    const cities = world.cities.filter((c) => c.provinceId === provId && c.nationId === nationId);
    expect(cities.length).toBeGreaterThanOrEqual(2);
    const army: any = {
      nationId,
      units: { ...ZERO },
      cityGarrisons: {
        [cities[0].id]: { ...ZERO, militia: 100 },
        [cities[1].id]: { ...ZERO, militia: 400 },
      },
      armyGroups: [],
      recruitmentQueue: [],
      morale: 0.8,
    };
    const res = validateMusterOrder(world, army, { cityId: provId!, units: { militia: 30 } });
    expect(res.ok).toBe(true);
    expect((res as any).cityId).toBe(cities[1].id);
  });

  test("buildOrders con cityId se construye en su provincia", () => {
    const world = buildDemoWorld("ref-003", { nationCount: 2, cityCount: 6 });
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
    const city = world.cities.find((c) => c.nationId === nationId)!;
    (sim.nationPolicies[nationId] as any).buildOrdersList = [{ provinceId: city.id, kind: "granja" }];
    const r = advanceConstruction(world, sim, sim.nationPolicies, sim.nationStockpiles, sim.eraState, 1);
    const started = r.projects.find((p) => p.nationId === nationId && p.provinceId === city.provinceId && p.kind === "granja");
    expect(started).toBeDefined();
  });
});
