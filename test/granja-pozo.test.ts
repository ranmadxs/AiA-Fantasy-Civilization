import {
  BASE_CONSTRUCTION_COSTS,
  BUILDING_LIST,
  DEFAULT_MAINTENANCE_COSTS,
  FIXED_CONSTRUCTION_TURNS,
} from "../src/world/configDefaults";
import { isKindUnlockedByEra } from "../src/world/era";
import {
  granjaOutput,
  granjaUpgradeEligible,
  pozoOutput,
  pozoSpotEligible,
  type Granja,
} from "../src/world/construction";
import type { World } from "../src/world/types";

function fakeWorld(): World {
  const tiles: World["tiles"] = [];
  for (let y = 0; y < 6; y += 1) {
    for (let x = 0; x < 6; x += 1) {
      tiles.push({ x, y, terrain: "plain", elevation: 0, temperature: 0, moisture: 0, provinceId: "p1" });
    }
  }
  return {
    seed: "granja-test",
    width: 6,
    height: 6,
    tiles,
    nations: [],
    provinces: [],
    cities: [],
    provinceById: new Map(),
    nationById: new Map(),
    cityById: new Map(),
    provinceEdges: [],
    nationEdges: [],
  } as unknown as World;
}

describe("granjas y pozos en configuración base", () => {
  test("kinds registrados con costos base", () => {
    expect(BUILDING_LIST).toContain("granja");
    expect(BUILDING_LIST).toContain("pozo");
    expect(BASE_CONSTRUCTION_COSTS.granja).toEqual({ gold: 1, wood: 100 });
    expect(BASE_CONSTRUCTION_COSTS.pozo).toEqual({ gold: 3, stone: 500 });
  });

  test("duración y mantención", () => {
    expect(FIXED_CONSTRUCTION_TURNS.granja).toBe(1);
    expect(FIXED_CONSTRUCTION_TURNS.pozo).toBe(2);
    expect(DEFAULT_MAINTENANCE_COSTS.granja).toBe(1);
    expect(DEFAULT_MAINTENANCE_COSTS.pozo).toBe(1);
  });

  test("desbloqueos por era: granja desde piedra, pozo desde antigua", () => {
    expect(isKindUnlockedByEra("granja", "stone")).toBe(true);
    expect(isKindUnlockedByEra("pozo", "stone")).toBe(false);
    expect(isKindUnlockedByEra("pozo", "ancient")).toBe(true);
  });
});

describe("producción por nivel", () => {
  test("granja niv.1 alimenta 1 pueblo (4 grano), niv.10 = 40", () => {
    expect(granjaOutput(1)).toBe(4);
    expect(granjaOutput(10)).toBe(40);
  });

  test("pozo niv.1 = 30 agua, niv.5 = 150", () => {
    expect(pozoOutput(1)).toBe(30);
    expect(pozoOutput(5)).toBe(150);
  });
});

describe("mejoras y ubicación", () => {
  test("granja mejora hasta niv.10 con 1 tile adyacente libre", () => {
    const world = fakeWorld();
    const granjas: Granja[] = [
      { id: "g1", nationId: "n1", provinceId: "p1", era: "stone", activa: true, nivel: 1, x: 2, y: 2, tiles: 1 },
    ];
    expect(granjaUpgradeEligible(world, "n1", "p1", granjas)).toBeDefined();
    expect(granjaUpgradeEligible(world, "n1", "p1", [{ ...granjas[0], nivel: 10 }])).toBeUndefined();
  });

  test("pozo exige tile libre sin veta mineral", () => {
    const world = fakeWorld();
    expect(pozoSpotEligible(world, "p1")).toBeDefined();
    for (const t of world.tiles) {
      if (t.provinceId === "p1") {
        t.resource = "iron";
        t.reservedBy = "mina-1";
      }
    }
    expect(pozoSpotEligible(world, "p1")).toBeUndefined();
  });
});
