import { executePeacefulExpansion } from "../src/world/diplomacy";
import {
  ambitionPowerRatio,
  bellicosityTier,
  calculatePeacefulExpandCost,
  canAffordPeacefulExpand,
  nationBellicosity,
  warMuscleThreshold,
} from "../src/world/policyAI";

function makeWorld() {
  const provinceNeutral: any = { id: "p-neutral", name: "Neutralia", nationId: undefined, population: 1000 };
  const provinceEnemy: any = { id: "p-enemy", name: "Enemia", nationId: "nationB", population: 5000 };
  const provinceOwn: any = { id: "p-own", name: "Home", nationId: "nationA", population: 2000 };
  const tileNeutral: any = { x: 0, y: 0, provinceId: "p-neutral", terrain: "plain" };
  const tileEnemy: any = { x: 1, y: 0, provinceId: "p-enemy", terrain: "plain" };
  const tileOwn: any = { x: 2, y: 0, provinceId: "p-own", terrain: "plain" };
  const provinces = [provinceNeutral, provinceEnemy, provinceOwn];
  const cities: any[] = [
    { id: "c-own", name: "Home City", nationId: "nationA", provinceId: "p-own", x: 2, y: 0, isCapital: true, population: 5000, level: 3 },
    { id: "c-enemy", name: "Enemy City", nationId: "nationB", provinceId: "p-enemy", x: 1, y: 0, isCapital: true, population: 5000, level: 3 },
  ];
  const world: any = {
    width: 3,
    height: 1,
    provinces,
    tiles: [tileNeutral, tileEnemy, tileOwn],
    cities,
    provinceById: new Map(provinces.map((p: any) => [p.id, p])),
    nationById: new Map([
      ["nationA", { id: "nationA", name: "A" }],
      ["nationB", { id: "nationB", name: "B" }],
    ]),
    cityById: new Map(cities.map((c: any) => [c.id, c])),
    nationEdges: [],
    mapRevision: 0,
  };
  return world;
}

describe("guerra vs expansión pacífica", () => {
  test("expansión pacífica NUNCA roba provincia enemiga", () => {
    const world = makeWorld();
    const policies: any = {
      nationA: {
        expansion: { policy: "peaceful_expand", targetNationId: "nationB" },
        decidedAtMonth: 1,
      },
    };
    const stockpiles: any = { nationA: { gold: 1000, water: 0, resources: {} } };
    const result: any = executePeacefulExpansion(world, policies, stockpiles, 1);
    const events = Array.isArray(result) ? result : result.events;
    const enemy = world.provinceById.get("p-enemy");
    // Root cause: antes robaba Enemia por 1 oro con ganancia neta.
    expect(enemy.nationId).toBe("nationB");
    // Si expandió, debió ser a neutral.
    for (const e of events) {
      expect(e.kind).toBe("peaceful_expand");
      expect(e.nationIds).not.toContain("nationB");
    }
  });

  test("expansión pacífica reconstruye bordes (sin perímetro rancio)", () => {
    const world = makeWorld();
    world.nationEdges = [{ x1: 99, y1: 99, x2: 99, y2: 99, nationId: "nationB" }];
    const policies: any = {
      nationA: { expansion: { policy: "peaceful_expand" }, decidedAtMonth: 1 },
    };
    const stockpiles: any = { nationA: { gold: 1000, water: 0, resources: {} } };
    const result: any = executePeacefulExpansion(world, policies, stockpiles, 1);
    expect(result.events.length).toBeGreaterThan(0);
    expect(result.mapChanged).toBe(true);
    // Ningún borde referencia territorio que ya no existe con ese dueño.
    for (const edge of world.nationEdges) {
      expect(edge.x1).not.toBe(99);
    }
    // Los bordes rodean a la nación que sí tiene tiles adyacentes distintos.
    expect(Array.isArray(world.nationEdges)).toBe(true);
  });

  test("coste pacífico neutral es 1 oro fijo, sin ganancia neta", () => {
    const world = makeWorld();
    const tile = world.tiles[0];
    const cost = calculatePeacefulExpandCost(tile, world);
    // 1 oro fijo por diseño (el exploit era el tributo de vuelta, ya eliminado).
    expect(cost.gold).toBe(1);
    expect(canAffordPeacefulExpand(cost, { gold: 1, resources: {} })).toBe(true);
    expect(canAffordPeacefulExpand(cost, { gold: 0, resources: {} })).toBe(false);
  });

  test("quitar evento fantasma LLM: applyDecision no debe inventar war_declared sin WarState", () => {
    // Se verifica por inspección: llmExecutor no debe hacer sim.events.push war_declared.
    const fs = require("fs");
    const src = fs.readFileSync("src/world/llmExecutor.ts", "utf8");
    expect(src).not.toMatch(/sim\.events\.push\(\{\s*kind:\s*"war_declared"/);
  });

  test("belicosidad determinista por nación y umbrales por tier", () => {
    const b1 = nationBellicosity("seed-1", "nationA");
    expect(b1).toBeGreaterThanOrEqual(0);
    expect(b1).toBeLessThan(1);
    expect(nationBellicosity("seed-1", "nationA")).toBe(b1);
    // tiers ordenan exigencia: belicosa ataca con menos ventaja, pacífica exige más
    expect(ambitionPowerRatio(0.9)).toBeLessThan(ambitionPowerRatio(0.5));
    expect(ambitionPowerRatio(0.5)).toBeLessThan(ambitionPowerRatio(0.1));
    expect(warMuscleThreshold(0.9)).toBeLessThan(warMuscleThreshold(0.1));
    expect(bellicosityTier(0.9)).toBe("belicosa");
    expect(bellicosityTier(0.1)).toBe("pacífica");
    expect(bellicosityTier(0.5)).toBe("equilibrada");
  });
});
