import {
  DOMINATION_VICTORY_SHARE,
  checkDominationVictory,
  getDomination,
} from "../src/world/nationStatus";
import type { World } from "../src/world/types";

function makeWorld(ownedA: number, ownedB: number, freeTiles: number): World {
  const tiles: any[] = [];
  let x = 0;
  const push = (n: number, provinceId?: string) => {
    for (let i = 0; i < n; i += 1) {
      tiles.push({ x: x++, y: 0, provinceId, terrain: "plain" });
    }
  };
  push(ownedA, "pa");
  push(ownedB, "pb");
  push(freeTiles, "pf");
  // Océano sin provincia: fuera del denominador.
  push(50, undefined);
  const provinces: any[] = [
    { id: "pa", name: "PA", nationId: "a", centerX: 0, centerY: 0, tileCount: ownedA },
    { id: "pb", name: "PB", nationId: "b", centerX: 0, centerY: 0, tileCount: ownedB },
    { id: "pf", name: "PF", nationId: undefined, centerX: 0, centerY: 0, tileCount: freeTiles },
  ];
  return {
    seed: "domination-test",
    width: 1000,
    height: 1,
    tiles,
    nations: [{ id: "a" }, { id: "b" }],
    provinces,
    cities: [],
    provinceById: new Map(provinces.map((p) => [p.id, p])),
    nationById: new Map(),
    cityById: new Map(),
    provinceEdges: [],
    nationEdges: [],
  } as unknown as World;
}

describe("victoria por dominación (98% de tierra con provincia)", () => {
  test("shares sobre tierra con provincia; océano y libres fuera", () => {
    const { shares, leaderNationId, leaderShare, claimedTiles } = getDomination(makeWorld(90, 10, 100));
    expect(claimedTiles).toBe(100);
    expect(shares.a).toBeCloseTo(0.9);
    expect(shares.b).toBeCloseTo(0.1);
    expect(leaderNationId).toBe("a");
    expect(leaderShare).toBeCloseTo(0.9);
    expect(checkDominationVictory(makeWorld(90, 10, 100))).toBeUndefined();
  });

  test("umbral 0.98 dispara victoria", () => {
    expect(DOMINATION_VICTORY_SHARE).toBe(0.98);
    expect(checkDominationVictory(makeWorld(196, 4, 0))).toBe("a");
    expect(checkDominationVictory(makeWorld(100, 100, 0))).toBeUndefined();
  });
});
