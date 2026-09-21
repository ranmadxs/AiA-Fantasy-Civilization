import { buildDemoWorld } from "../src/world/buildDemoWorld";
import { annexProvinceCities, executePeacefulExpansion } from "../src/world/diplomacy";
import { isNationActive } from "../src/world/nationStatus";
import type { World } from "../src/world/types";

jest.setTimeout(60000);

function richStockpile() {
  return { gold: 100000, water: 1000, resources: { grain: 5000, timber: 5000, iron: 5000, coal: 5000 } };
}

function policiesFor(nationId: string): any {
  return {
    [nationId]: {
      expansion: { policy: "peaceful_expand", label: "x", rationale: "test", decidedAtMonth: 0, nextDecisionMonth: 99 },
    },
  };
}

/** Neutral province adjacent to nation territory (deterministic per seed). */
function adjacentNeutral(world: World, nationId: string): string[] {
  const own = new Set(
    world.tiles.filter((t) => {
      const p = t.provinceId ? world.provinceById.get(t.provinceId) : undefined;
      return p?.nationId === nationId;
    }).map((t) => `${t.x},${t.y}`),
  );
  const found = new Set<string>();
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  for (const tile of world.tiles) {
    if (!own.has(`${tile.x},${tile.y}`)) continue;
    for (const [dx, dy] of dirs) {
      const n = world.tiles.find((t) => t.x === tile.x + dx && t.y === tile.y + dy);
      const prov = n?.provinceId ? world.provinceById.get(n.provinceId) : undefined;
      if (prov && prov.nationId === undefined) found.add(prov.id);
    }
  }
  return [...found];
}

function ghostCity(world: World, provinceId: string, idx: number): void {
  world.cities.push({
    id: `ghost-${idx}`, name: `Ghost${idx}`, nameEn: `Ghost${idx}`, nameZh: `Ghost${idx}`, nameEs: `Fantasma${idx}`,
    nameId: `ghost${idx}`, nationId: "ghost", provinceId, x: 0, y: 0, isCapital: false,
    population: 60, level: 1, tipo: "pueblo", tiles: 1,
  } as any);
}

describe("annexProvinceCities: solo sin dueño activo", () => {
  test("voltea ciudad fantasma, respeta ciudad de nación activa", () => {
    const world = buildDemoWorld("annex-unit", { nationCount: 2, cityCount: 4, freeProvinceRatio: 0.3 });
    const nationId = world.nations[0].id;
    const otherId = world.nations[1].id;
    const prov = world.provinces.find((p) => p.nationId === undefined)!;
    ghostCity(world, prov.id, 1);
    world.cities.push({
      id: "foreign-1", name: "F1", nameEn: "F1", nameZh: "F1", nameEs: "F1",
      nameId: "f1", nationId: otherId, provinceId: prov.id, x: 1, y: 1, isCapital: false,
      population: 60, level: 1, tipo: "pueblo", tiles: 1,
    } as any);
    expect(isNationActive(world, otherId)).toBe(true);
    const res = annexProvinceCities(world, prov.id, nationId);
    expect(res.flipped).toEqual(["ghost-1"]);
    expect(res.skipped).toEqual(["foreign-1"]);
    expect(world.cities.find((c) => c.id === "ghost-1")!.nationId).toBe(nationId);
    expect(world.cities.find((c) => c.id === "foreign-1")!.nationId).toBe(otherId);
  });
});

describe("expansión pacífica con pueblos (integración)", () => {
  test("anexa fantasma con evento; activas intactas y excluidas", () => {
    let world: ReturnType<typeof buildDemoWorld> | undefined;
    let nationId = "";
    let adjacent: string[] = [];
    for (const seed of ["annex-001", "annex-002", "annex-003"]) {
      const w = buildDemoWorld(seed, { nationCount: 3, cityCount: 6, freeProvinceRatio: 0.3 });
      const n = w.nations[0].id;
      const adj = adjacentNeutral(w, n);
      if (adj.length > 0) {
        world = w;
        nationId = n;
        adjacent = adj;
        break;
      }
    }
    expect(world).toBeDefined();
    expect(adjacent.length).toBeGreaterThan(0);
    const w = world!;
    const otherId = w.nations[1].id;
    ghostCity(w, adjacent[0], 7);
    if (adjacent[1]) {
      w.cities.push({
        id: "foreign-7", name: "F7", nameEn: "F7", nameZh: "F7", nameEs: "F7",
        nameId: "f7", nationId: otherId, provinceId: adjacent[1], x: 2, y: 2, isCapital: false,
        population: 60, level: 1, tipo: "pueblo", tiles: 1,
      } as any);
    }
    const res = executePeacefulExpansion(w, policiesFor(nationId), { [nationId]: richStockpile() } as any, 1, undefined, undefined, "es");
    // Fantasma: si su provincia fue anexada, cambió de dueño con evento.
    const ghost = w.cities.find((c) => c.id === "ghost-7")!;
    const ghostProv = w.provinceById.get(ghost.provinceId)!;
    if (ghostProv.nationId === nationId) {
      expect(ghost.nationId).toBe(nationId);
      const annex = res.events.find((e) => /Anexión pacífica/.test(e.title));
      expect(annex).toBeDefined();
      expect(annex!.lang).toBe("es");
    }
    // Activa: jamás cambia de dueño por vía pacífica.
    const foreign = w.cities.find((c) => c.id === "foreign-7");
    if (foreign) expect(foreign.nationId).toBe(otherId);
    // Invariante global: ninguna ciudad de nación activa en provincia ajena recién anexada.
    for (const city of w.cities) {
      const prov = w.provinceById.get(city.provinceId);
      if (prov?.nationId === nationId && city.nationId !== nationId) {
        expect(isNationActive(w, city.nationId)).toBe(false);
      }
    }
  });
});
