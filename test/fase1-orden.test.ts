import { BUILDING_LIST, BASE_CONSTRUCTION_COSTS, FIXED_CONSTRUCTION_TURNS, DEFAULT_MAINTENANCE_COSTS, BUILDING_LABELS, BUILDING_TILE_FOOTPRINT } from "../src/world/configDefaults";
import { getConstructionSpec, getBuildingConfigRows } from "../src/world/construction";
import { ERA_UNLOCKS, isReinoEra, isKindUnlockedByEra } from "../src/world/era";
import { maxExpandsFor, peacefulExpandCostFor } from "../src/world/policyAI";

describe("fase1 orden construcciones", () => {
  test("renombre obra a pueblo + nuevas filas ciudad/reino", () => {
    expect(BUILDING_LABELS.obra).toBe("Obra Civil - Pueblo");
    expect(BUILDING_LIST).toEqual(expect.arrayContaining(["obra", "ciudad", "reino"]));
    expect(BASE_CONSTRUCTION_COSTS.ciudad).toEqual({ wood: 45, stone: 20, gold: 25 });
    expect(BASE_CONSTRUCTION_COSTS.reino).toEqual({ wood: 120, gold: 80, iron: 40 });
    expect(FIXED_CONSTRUCTION_TURNS.ciudad).toBe(3);
    expect(FIXED_CONSTRUCTION_TURNS.reino).toBe(4);
    expect(DEFAULT_MAINTENANCE_COSTS.ciudad).toBe(5);
    expect(DEFAULT_MAINTENANCE_COSTS.reino).toBe(15);
  });

  test("tiles por defecto 1, ciudad 15, minas y reino 20", () => {
    expect(BUILDING_TILE_FOOTPRINT.obra).toBe(1);
    expect(BUILDING_TILE_FOOTPRINT.ciudad).toBe(15);
    expect(BUILDING_TILE_FOOTPRINT.reino).toBe(20);
    expect(BUILDING_TILE_FOOTPRINT.mina_carbon).toBe(20);
    expect(BUILDING_TILE_FOOTPRINT.mina_hierro).toBe(20);
    const rows = getBuildingConfigRows(["obra", "ciudad", "reino"]);
    expect(rows[0].tiles).toBe(1);
    expect(rows[1].tiles).toBe(15);
    expect(rows[2].tiles).toBe(20);
  });

  test("spec ciudad/reino escala por era", () => {
    const ciudad = getConstructionSpec("ciudad", "stone", false);
    expect(ciudad.turns).toBe(3);
    expect(ciudad.cost).toEqual({ timber: 45, coal: 20, gold: 25 });
    const reino = getConstructionSpec("reino", "medieval", false);
    expect(reino.turns).toBe(4);
  });

  test("gates era: ciudad medieval, reino solo medieval/dark", () => {
    expect(isKindUnlockedByEra("ciudad", "medieval")).toBe(true);
    expect(isKindUnlockedByEra("ciudad", "stone")).toBe(false);
    expect(isReinoEra("medieval")).toBe(true);
    expect(isReinoEra("dark_medieval")).toBe(true);
    expect(isReinoEra("stone")).toBe(false);
    expect(isReinoEra("modern")).toBe(false);
    expect(ERA_UNLOCKS.medieval).toEqual(expect.arrayContaining(["ciudad", "reino"]));
  });

  test("expansion cupo 2/3/4 y costo escalado", () => {
    expect(maxExpandsFor(0)).toBe(2);
    expect(maxExpandsFor(1)).toBe(3);
    expect(maxExpandsFor(2)).toBe(4);
    expect(maxExpandsFor(5)).toBe(4);
    expect(peacefulExpandCostFor(1, false, 1)).toBe(1);
    expect(peacefulExpandCostFor(2, false, 1)).toBe(1.25);
    expect(peacefulExpandCostFor(3, false, 1)).toBe(1.5);
    expect(peacefulExpandCostFor(4, false, 1)).toBe(1.75);
    expect(peacefulExpandCostFor(1, true, 1)).toBe(0.5);
  });
});
