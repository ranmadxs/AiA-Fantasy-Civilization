import { findAdjacentFreeTiles, stableUpgradeEligible } from "../src/world/construction";
import { cavalrySlotPick } from "../src/world/war";
import type { World } from "../src/world/types";

function fakeWorld(): World {
  const tiles: World["tiles"] = [];
  for (let y = 0; y < 5; y += 1) {
    for (let x = 0; x < 5; x += 1) {
      tiles.push({ x, y, terrain: "plain", elevation: 0, temperature: 0, moisture: 0, provinceId: "p1" });
    }
  }
  return {
    seed: "establo-test",
    width: 5,
    height: 5,
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

describe("establo nivel 2", () => {
  test("BFS devuelve hasta n tiles libres adyacentes (4-vecinos), salta ocupados", () => {
    const world = fakeWorld();
    // Ocupa el este del establo (3,2) con una mina.
    world.tiles.find((t) => t.x === 3 && t.y === 2)!.reservedBy = "mina-1";
    const spots = findAdjacentFreeTiles(world, 2, 2, "p1", 3);
    expect(spots).toHaveLength(3);
    for (const s of spots) {
      expect(s).not.toEqual({ x: 3, y: 2 });
      const tile = world.tiles.find((t) => t.x === s.x && t.y === s.y)!;
      expect(tile.provinceId).toBe("p1");
      expect(tile.reservedBy).toBeUndefined();
    }
    // Todos a distancia Manhattan 1 del origen o en cadena contigua.
    expect(spots).toEqual(expect.arrayContaining([{ x: 1, y: 2 }, { x: 2, y: 1 }, { x: 2, y: 3 }]));
  });

  test("mejora exige establo niv.1 + ciudad niv.2 + 3 adyacentes", () => {
    const world = fakeWorld();
    world.cities.push({
      id: "c1", name: "C", nameEn: "C", nameZh: "C", nameEs: "C", nameId: "c1",
      nationId: "n1", provinceId: "p1", x: 2, y: 2, isCapital: false,
      population: 500, level: 1, tipo: "pueblo", tiles: 1,
    });
    const aserraderos = [{ id: "e1", nationId: "n1", provinceId: "p1", era: "stone", activa: true, nivel: 1, x: 0, y: 0, tiles: 1 }];
    // Ciudad nivel 1 → no elegible.
    expect(stableUpgradeEligible(world, "n1", "p1", aserraderos)).toBeUndefined();
    world.cities[0].level = 2;
    const ok = stableUpgradeEligible(world, "n1", "p1", aserraderos);
    expect(ok).toBeDefined();
    expect(ok!.spots).toHaveLength(3);
    // Establo ya niv.2 → no elegible.
    expect(stableUpgradeEligible(world, "n1", "p1", [{ ...aserraderos[0], nivel: 2 }])).toBeUndefined();
  });

  test("lotería slot 4: sin establo nunca, niv.2 siempre, niv.1 determinista", () => {
    for (const i of [0, 1, 2, 3, 4, 5, 6, 7]) {
      expect(cavalrySlotPick("s", "c", 1, i, 0)).toBeUndefined();
    }
    for (const i of [0, 1, 2, 4, 5, 6]) {
      expect(cavalrySlotPick("s", "c", 1, i, 2)).toBeUndefined();
    }
    expect(cavalrySlotPick("s", "c", 1, 3, 2)).toBe("caballeria");
    expect(cavalrySlotPick("s", "c", 1, 7, 2)).toBe("caballeria");
    // Niv.1: solo 4º slots, determinista por seed.
    expect(cavalrySlotPick("s", "c", 1, 2, 1)).toBeUndefined();
    expect(cavalrySlotPick("s", "c", 1, 3, 1)).toBe(cavalrySlotPick("s", "c", 1, 3, 1));
  });
});
