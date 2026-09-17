import { buildInitialMilitaryState, getNationWarSummary } from "../src/world/war";
import { calculateGlobalConsumption } from "../src/world/hunger";
import type { World } from "../src/world/types";

// Regression: province.population no existe; upkeep/consumo deben calcularse
// desde City.population y ser siempre finitos (un NaN ponía el oro en 0
// todos los meses para todas las naciones: sin recluta, ni leva, ni paz).
function makeWorld(): World {
  const nations: any[] = [
    { id: "a", name: "A", color: "#fff", numericColor: 0xffffff, capitalProvinceId: "p1", capitalCityId: "c1" },
    { id: "b", name: "B", color: "#000", numericColor: 0x000000, capitalProvinceId: "p2", capitalCityId: "c2" },
  ];
  const provinces: any[] = [
    { id: "p1", name: "P1", nationId: "a", centerX: 1, centerY: 1, tileCount: 10 },
    { id: "p2", name: "P2", nationId: "b", centerX: 5, centerY: 5, tileCount: 10 },
  ];
  const cities: any[] = [
    { id: "c1", name: "C1", nationId: "a", provinceId: "p1", x: 1, y: 1, isCapital: true, population: 8000, level: 3 },
    { id: "c2", name: "C2", nationId: "b", provinceId: "p2", x: 5, y: 5, isCapital: true, population: 6000, level: 2 },
  ];
  return {
    seed: "upkeep-test",
    width: 10,
    height: 10,
    tiles: [],
    nations,
    provinces,
    cities,
    provinceById: new Map(provinces.map((p) => [p.id, p])),
    nationById: new Map(nations.map((n) => [n.id, n])),
    cityById: new Map(cities.map((c) => [c.id, c])),
    provinceEdges: [],
    nationEdges: [],
  } as unknown as World;
}

describe("upkeep y consumo finitos (sin NaN de province.population)", () => {
  test("monthlyUpkeep es número finito y pagable", () => {
    const world = makeWorld();
    const military = buildInitialMilitaryState(world);
    const summary = getNationWarSummary(
      { wars: [], alliances: [], vassalContracts: [], truces: [], proposals: [] },
      military,
      world,
      "a",
    );
    expect(Number.isFinite(summary.monthlyUpkeep)).toBe(true);
    expect(summary.monthlyUpkeep).toBeGreaterThanOrEqual(0);
    expect(summary.totalSoldiers).toBeGreaterThan(0);
  });

  test("calculateGlobalConsumption es finito y no cuenta doble", () => {
    const world = makeWorld();
    const { foodConsumption, waterConsumption } = calculateGlobalConsumption(world);
    expect(Number.isFinite(foodConsumption)).toBe(true);
    expect(Number.isFinite(waterConsumption)).toBe(true);
    // 8000 + 6000 habitantes solo de ciudades (antes sumaba provincias undefined → NaN)
    expect(foodConsumption).toBeCloseTo(14000 * 0.01);
  });
});
