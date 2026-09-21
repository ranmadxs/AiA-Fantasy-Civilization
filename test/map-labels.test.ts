import {
  cityDotRadius,
  formatCityMapLabel,
  footprintAlphaFor,
  tilesForOwner,
} from "../src/world/mapLabels";
import { buildDemoWorld } from "../src/world/buildDemoWorld";
import { advanceConstruction, createInitialSimulationState } from "../src/world/turnSimulation";

describe("etiquetas y huella en mapa político", () => {
  test("etiqueta lleva nombre + Nv", () => {
    const city: any = { name: "Rivergate", nameEn: "Rivergate", nameZh: "河门", nameEs: "Rivergate", level: 1, tipo: "pueblo" };
    expect(formatCityMapLabel(city, "es")).toBe("Rivergate · Nv1");
    expect(formatCityMapLabel({ ...city, level: 3, tipo: "ciudad" }, "es")).toBe("Rivergate · Nv3");
  });

  test("radio por tipo: pueblo chico, ciudad grande", () => {
    expect(cityDotRadius({ tipo: "pueblo" } as any)).toBeLessThan(cityDotRadius({ tipo: "ciudad" } as any));
    expect(cityDotRadius({} as any)).toBe(2.6);
  });

  test("alfa por tipo: reino > ciudad > pueblo (pueblo 0.88 bien visible)", () => {
    const p = footprintAlphaFor("pueblo");
    const c = footprintAlphaFor("ciudad");
    const r = footprintAlphaFor("reino");
    expect(p).toBe(0.88);
    expect(p).toBeLessThan(c);
    expect(c).toBeLessThan(r);
  });

  test("tilesForOwner filtra por reservedBy", () => {
    const tiles: any[] = [
      { x: 0, y: 0, reservedBy: "c1" },
      { x: 1, y: 0, reservedBy: "c1" },
      { x: 2, y: 0, reservedBy: "mina-1" },
      { x: 3, y: 0 },
    ];
    expect(tilesForOwner(tiles, "c1")).toEqual([{ x: 0, y: 0 }, { x: 1, y: 1 - 1 }]);
    expect(tilesForOwner(tiles, "nadie")).toEqual([]);
  });

  test("worldgen: cada ciudad inicial tiene su tile marcado", () => {
    const world = buildDemoWorld("huella-001", { nationCount: 2, cityCount: 6 });
    for (const city of world.cities) {
      const mine = world.tiles.filter((t: any) => t.reservedBy === city.id);
      expect(mine.length).toBeGreaterThanOrEqual(1);
    }
  });

  test("al subir a Nv2 los tiles quedan pegados a la ciudad (mancha contigua)", () => {
    const world = buildDemoWorld("huella-n2", { nationCount: 2, cityCount: 6 });
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
    sim.constructionProjects.push({
      id: "obra-dev", nationId, provinceId: city.provinceId, era: "stone",
      kind: "obra", cost: {}, totalTurns: 1, remainingTurns: 1,
      status: "building", startedAt: 0,
    } as any);
    advanceConstruction(world, sim, sim.nationPolicies, sim.nationStockpiles, sim.eraState, 1);
    const c = world.cityById.get(city.id)!;
    expect(c.level).toBe(2);
    const mine = tilesForOwner(world.tiles as any, city.id);
    expect(mine.length).toBe(2);
    // BFS 4-vecinos desde la ciudad: todos sus tiles alcanzables
    // (el tile propio cuenta en ambos, no se suma doble).
    const keys = new Set(mine.map((t) => `${t.x},${t.y}`));
    expect(keys.has(`${c.x},${c.y}`)).toBe(true);
    const seen = new Set<string>([`${c.x},${c.y}`]);
    const queue: Array<[number, number]> = [[c.x, c.y]];
    while (queue.length > 0) {
      const [x, y] = queue.pop()!;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const k = `${x + dx},${y + dy}`;
        if (!keys.has(k) || seen.has(k)) continue;
        seen.add(k);
        queue.push([x + dx, y + dy]);
      }
    }
    expect(seen.size).toBe(keys.size);
    for (const k of keys) expect(seen.has(k)).toBe(true);
  });
});
