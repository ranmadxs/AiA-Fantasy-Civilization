import { buildDemoWorld } from "../src/world/buildDemoWorld";
import { parseDecision, validateTargetProvince } from "../src/world/llmExecutor";
import { orderArmyGroupsTowardObjective } from "../src/world/war";

jest.setTimeout(60000);

function adjacentEnemyProvince(world: ReturnType<typeof buildDemoWorld>, nationId: string) {
  const own = new Set(
    world.tiles.filter((t) => {
      const p = t.provinceId ? world.provinceById.get(t.provinceId) : undefined;
      return p?.nationId === nationId;
    }).map((t) => `${t.x},${t.y}`),
  );
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  for (const tile of world.tiles) {
    if (!own.has(`${tile.x},${tile.y}`)) continue;
    for (const [dx, dy] of dirs) {
      const n = world.tiles.find((t) => t.x === tile.x + dx && t.y === tile.y + dy);
      const prov = n?.provinceId ? world.provinceById.get(n.provinceId) : undefined;
      if (prov && prov.nationId !== undefined && prov.nationId !== nationId) return prov;
    }
  }
  return undefined;
}

describe("productor LLM: targetProvinceId", () => {
  test("parseDecision conserva targetProvinceId en JSON válido", () => {
    const raw = JSON.stringify({
      expansion: "control_city", economy: "army_building", diplomacy: "declare_war",
      era: "stay", targetNationId: "b", targetProvinceId: "p-9", rationale: "test",
    });
    const d = parseDecision(raw)!;
    expect(d).not.toBeNull();
    expect(d.targetProvinceId).toBe("p-9");
  });

  test("parseDecision normaliza targetProvinceId no-string a undefined", () => {
    const raw = JSON.stringify({ expansion: "none", targetProvinceId: 42 });
    expect(parseDecision(raw)!.targetProvinceId).toBeUndefined();
  });

  test("validateTargetProvince: enemiga+fronteriza sí, propia/no-frontera no", () => {
    let world: ReturnType<typeof buildDemoWorld> | undefined;
    let nationId = "";
    let enemyProv: ReturnType<typeof adjacentEnemyProvince> | undefined;
    for (const seed of ["tgt-001", "tgt-002", "tgt-003"]) {
      const w = buildDemoWorld(seed, { nationCount: 3, cityCount: 6, freeProvinceRatio: 0.2 });
      const n = w.nations[0].id;
      const ep = adjacentEnemyProvince(w, n);
      if (ep) {
        world = w;
        nationId = n;
        enemyProv = ep;
        break;
      }
    }
    expect(world).toBeDefined();
    const w = world!;
    const enemyId = enemyProv!.nationId!;
    const war: any = { id: "w1", attackerNationId: nationId, defenderNationId: enemyId, startedAtMonth: 0, battleCount: 0 };
    const ctx: any = { world: w, nationId, simulation: { diplomacy: { wars: [war] } } };
    expect(validateTargetProvince({ targetNationId: enemyId, targetProvinceId: enemyProv!.id }, ctx)).toBe(enemyProv!.id);
    // Propia → undefined.
    const ownProv = w.provinces.find((p) => p.nationId === nationId)!;
    expect(validateTargetProvince({ targetNationId: nationId, targetProvinceId: ownProv.id }, ctx)).toBeUndefined();
    // Nación inconsistente con la provincia → undefined.
    const other = w.nations.find((n) => n.id !== nationId && n.id !== enemyId)!.id;
    expect(validateTargetProvince({ targetNationId: other, targetProvinceId: enemyProv!.id }, ctx)).toBeUndefined();
    // Inexistente → undefined.
    expect(validateTargetProvince({ targetProvinceId: "no-existe" }, ctx)).toBeUndefined();
  });
});

describe("evento con objetivo + origen", () => {
  test("orderArmyGroupsTowardObjective marca origen LLM en español", () => {
    const world = buildDemoWorld("tgt-ev", { nationCount: 2, cityCount: 4 });
    const nationId = world.nations[0].id;
    const homeCity = world.cities.find((c) => c.nationId === nationId)!;
    const dest = world.provinces.find((p) => p.id !== homeCity.provinceId)!;
    const army: any = {
      nationId,
      units: { militia: 30, infantry: 0, lightCavalry: 0, heavyCavalry: 0, levy: 0, caballeria: 0 },
      cityGarrisons: {},
      armyGroups: [{
        id: "g1", nationId, locationProvinceId: homeCity.provinceId,
        pathProvinceIds: [], movementProgress: 0,
        units: { militia: 30, infantry: 0, lightCavalry: 0, heavyCavalry: 0, levy: 0, caballeria: 0 },
        stance: "garrison", createdAtMonth: 0, updatedAtMonth: 0,
      }],
      morale: 0.8,
      recruitmentQueue: [],
    };
    const res = orderArmyGroupsTowardObjective(world, army, dest.id, dest.id, "attack", 5, undefined, "llm", "es");
    const ordered = res.events.find((e) => e.kind === "army_group_ordered")!;
    expect(ordered).toBeDefined();
    expect(ordered.lang).toBe("es");
    expect(ordered.title).toBe("Grupo de Ejército Ordenado");
    expect(ordered.description).toContain(dest.nameEs ?? dest.name);
    expect(ordered.description).toMatch(/decisión LLM/);
    const auto = orderArmyGroupsTowardObjective(world, army, dest.id, dest.id, "attack", 5, undefined, "auto");
    const autoEv = auto.events.find((e) => e.kind === "army_group_ordered")!;
    expect(autoEv.description).toMatch(/redirected an army group toward/);
  });
});
