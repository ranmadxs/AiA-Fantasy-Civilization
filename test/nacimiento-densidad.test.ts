import { densityPerTile, maxPopulationOf, habitableTilesOf, getLiveDensity, setLiveDensity, resetLiveDensity, getDensityRows } from "../src/world/density";
import { maxLevelOf, tilesFor } from "../src/world/levelCaps";
import { buildDemoWorld } from "../src/world/buildDemoWorld";

describe("nacimiento piedra-pueblo + densidad/levels", () => {
  test("tabla densidad por era", () => {
    expect(densityPerTile("stone")).toBe(100);
    expect(densityPerTile("ancient")).toBe(1000);
    expect(densityPerTile("medieval")).toBe(10000);
    expect(densityPerTile("dark_medieval")).toBe(500);
    expect(densityPerTile("modern")).toBe(10000);
    expect(densityPerTile("contemporary")).toBe(100000);
  });

  test("topes por era y tiles", () => {
    expect(maxLevelOf("pueblo", "stone")).toBe(2);
    expect(maxLevelOf("ciudad", "medieval")).toBe(3);
    expect(tilesFor("pueblo", 1)).toBe(1);
    expect(tilesFor("pueblo", 2)).toBe(2);
    expect(tilesFor("ciudad", 1)).toBe(15);
    expect(tilesFor("ciudad", 2)).toBe(16);
    expect(tilesFor("reino", 1)).toBe(20);
    expect(tilesFor("reino", 2)).toBe(21);
  });

  test("tile sin construccion no habita", () => {
    const world = buildDemoWorld("density-test-001", { nationCount: 2, cityCount: 4 });
    const city0 = world.cities[0];
    const province = world.provinces.find((p) => p.id === city0.provinceId)!;
    const tiles = world.tiles.filter((t) => t.provinceId === province.id);
    const hab = habitableTilesOf(province.id, world);
    expect(hab).toBeGreaterThanOrEqual(1);
    expect(hab).toBeLessThanOrEqual(tiles.length);
    const city = world.cities.find((c) => c.provinceId === province.id)!;
    expect(maxPopulationOf(city, "stone", world)).toBe(hab * 100);
  });

  test("naciones nacen en piedra como pueblos nivel 1 (40-50% del tope)", () => {
    const world = buildDemoWorld("nacimiento-001", { nationCount: 2, cityCount: 4 });
    expect(world.nations.length).toBe(2);
    for (const city of world.cities) {
      expect(city.level).toBe(1);
      expect(city.tipo).toBe("pueblo");
      const cap = habitableTilesOf(city.provinceId, world) * densityPerTile("stone");
      expect(city.population).toBeGreaterThanOrEqual(Math.round(cap * 0.40));
      expect(city.population).toBeLessThanOrEqual(Math.round(cap * 0.50) + 1);
    }
  });

  test("nacimiento determinista por seed (mismo seed = mismas poblaciones)", () => {
    const a = buildDemoWorld("determinista-001", { nationCount: 2, cityCount: 4 });
    const b = buildDemoWorld("determinista-001", { nationCount: 2, cityCount: 4 });
    expect(a.cities.map((c) => c.population)).toEqual(b.cities.map((c) => c.population));
  });

  test("store vivo densidad: override válido aplica, inválido se rechaza", () => {
    resetLiveDensity();
    expect(getLiveDensity().stone).toBe(100);
    expect(getDensityRows().length).toBe(6);
    expect(setLiveDensity({ stone: 250 })).toBe(true);
    expect(densityPerTile("stone")).toBe(250);
    expect(setLiveDensity({ stone: -1 })).toBe(false);
    expect(densityPerTile("stone")).toBe(250);
    resetLiveDensity();
    expect(densityPerTile("stone")).toBe(100);
  });
});
