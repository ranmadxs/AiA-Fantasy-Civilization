import { buildDemoWorld } from "../src/world/buildDemoWorld";

function checkContiguous(world: ReturnType<typeof buildDemoWorld>) {
  const tileByCoord = new Map(world.tiles.map((t) => [`${t.x},${t.y}`, t]));
  const neighbors = new Map<string, Set<string>>();
  const link = (a: string, b: string) => {
    if (a === b) return;
    let set = neighbors.get(a);
    if (!set) {
      set = new Set();
      neighbors.set(a, set);
    }
    set.add(b);
  };
  for (const tile of world.tiles) {
    if (!tile.provinceId) continue;
    for (const [dx, dy] of [[1, 0], [0, 1]] as const) {
      const other = tileByCoord.get(`${tile.x + dx},${tile.y + dy}`);
      if (!other?.provinceId) continue;
      link(tile.provinceId, other.provinceId);
      link(other.provinceId, tile.provinceId);
    }
  }
  for (const nation of world.nations) {
    const owned = world.provinces.filter((p) => p.nationId === nation.id).map((p) => p.id);
    expect(owned.length).toBeGreaterThan(0);
    const reached = new Set([owned[0]]);
    const queue = [owned[0]];
    while (queue.length > 0) {
      const cur = queue.shift()!;
      for (const nx of neighbors.get(cur) ?? []) {
        if (reached.has(nx)) continue;
        if (!owned.includes(nx)) continue;
        reached.add(nx);
        queue.push(nx);
      }
    }
    expect([...reached].sort()).toEqual([...owned].sort());
  }
}

describe("contigüidad inicial", () => {
  test("cada nación ocupa un bloque contiguo (varias seeds, con y sin libres)", () => {
    for (const seed of ["contig-a", "contig-b", "contig-c"]) {
      checkContiguous(buildDemoWorld(seed, { nationCount: 6 }));
      checkContiguous(buildDemoWorld(seed, { nationCount: 6, freeProvinceRatio: 0.2 }));
    }
  }, 120000);

  test("cada nación conserva su capital", () => {
    const world = buildDemoWorld("contig-a", { nationCount: 6, freeProvinceRatio: 0.2 });
    for (const nation of world.nations) {
      const capital = world.provinces.find((p) => p.id === nation.capitalProvinceId);
      expect(capital?.nationId).toBe(nation.id);
    }
  }, 120000);
});
