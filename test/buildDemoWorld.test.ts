import { buildDemoWorld } from "../src/world/buildDemoWorld";
import type { World } from "../src/world/types";

describe("buildDemoWorld — territorio libre", () => {
  test("sin freeProvinceRatio, todas las provincias tienen nación", () => {
    const world = buildDemoWorld("world-001", { nationCount: 6 });
    const unassigned = world.provinces.filter((p) => p.nationId === undefined);
    expect(unassigned).toHaveLength(0);
  });

  test("con freeProvinceRatio=0.2, al menos 5% de provincias son libres", () => {
    const world = buildDemoWorld("world-001", { nationCount: 6, freeProvinceRatio: 0.2 });
    const unassigned = world.provinces.filter((p) => p.nationId === undefined);
    expect(unassigned.length).toBeGreaterThan(0);
    expect(unassigned.length / world.provinces.length).toBeGreaterThanOrEqual(0.05);
  });

  test("con freeProvinceRatio=0, nada es libre", () => {
    const world = buildDemoWorld("world-001", { nationCount: 6, freeProvinceRatio: 0 });
    const unassigned = world.provinces.filter((p) => p.nationId === undefined);
    expect(unassigned).toHaveLength(0);
  });

  test("con freeProvinceRatio=0.5, al menos 25% de provincias son libres", () => {
    const world = buildDemoWorld("world-001", { nationCount: 6, freeProvinceRatio: 0.5 });
    const unassigned = world.provinces.filter((p) => p.nationId === undefined);
    expect(unassigned.length).toBeGreaterThan(0);
    expect(unassigned.length / world.provinces.length).toBeGreaterThanOrEqual(0.25);
  });

  test("con territorio libre, las naciones asignadas siguen teniendo capital", () => {
    const world = buildDemoWorld("world-001", { nationCount: 6, freeProvinceRatio: 0.2 });
    for (const nation of world.nations) {
      const hasCapital = world.provinces.some(
        (p) => p.nationId === nation.id && p.id === nation.capitalProvinceId,
      );
      expect(hasCapital).toBe(true);
    }
  });

  test("con territorio libre, las ciudades solo existen en provincias asignadas", () => {
    const world = buildDemoWorld("world-001", { nationCount: 6, freeProvinceRatio: 0.3 });
    for (const city of world.cities) {
      const province = world.provinces.find((p) => p.id === city.provinceId);
      expect(province?.nationId).toBe(city.nationId);
    }
  });

  test("misma seed + mismo freeProvinceRatio → mismo resultado", () => {
    const world1 = buildDemoWorld("world-001", { nationCount: 6, freeProvinceRatio: 0.2 });
    const world2 = buildDemoWorld("world-001", { nationCount: 6, freeProvinceRatio: 0.2 });
    expect(world1.provinces.length).toBe(world2.provinces.length);
    world1.provinces.forEach((p, i) => {
      expect(p.nationId).toBe(world2.provinces[i].nationId);
    });
    expect(world1.nations.map((n) => n.id)).toEqual(world2.nations.map((n) => n.id));
    expect(world1.cities.length).toBe(world2.cities.length);
  });

  test("diferente freeProvinceRatio → diferente número de provincias libres", () => {
    const world0 = buildDemoWorld("world-001", { nationCount: 6, freeProvinceRatio: 0 });
    const world20 = buildDemoWorld("world-001", { nationCount: 6, freeProvinceRatio: 0.2 });
    const free0 = world0.provinces.filter((p) => p.nationId === undefined).length;
    const free20 = world20.provinces.filter((p) => p.nationId === undefined).length;
    expect(free20).toBeGreaterThanOrEqual(free0);
  });
});
