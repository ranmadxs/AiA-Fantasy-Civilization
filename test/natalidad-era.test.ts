import { eraBirthBonus } from "../src/world/era";
import { buildDemoWorld } from "../src/world/buildDemoWorld";
import { applyPopulationDynamics, getEraVitalityRows } from "../src/world/settlement";
import { calculateCityEconomy } from "../src/world/cityEconomy";
import { buildInitialDiplomacyState } from "../src/world/diplomacy";

describe("natalidad por era + exceso al 10%", () => {
  test("bonus ×1.10 por era", () => {
    expect(eraBirthBonus("stone")).toBeCloseTo(1, 10);
    expect(eraBirthBonus("ancient")).toBeCloseTo(1.1, 10);
    expect(eraBirthBonus("medieval")).toBeCloseTo(1.21, 10);
  });

  test("exceso produce al 10% pero sigue creciendo", () => {
    const world = buildDemoWorld("natalidad-001", { nationCount: 2, cityCount: 4 });
    const city = world.cities[0];
    city.population = 100000;
    const eco = calculateCityEconomy(city, world, "stone");
    expect(eco.overpopulationRatio).toBeGreaterThan(1);
    expect(eco.monthlyGold).toBeGreaterThan(0);
  });

  test("era ancient crece más que stone", () => {    const mk = (seed: string) => {
      const w = buildDemoWorld(seed, { nationCount: 2, cityCount: 2 });
      const diplomacy = buildInitialDiplomacyState(w);
      return { w, diplomacy };
    };
    const a = mk("nat-stone-001");
    const b = mk("nat-stone-001");
    const eraStone = Object.fromEntries(a.w.nations.map((n) => [n.id, { currentEra: "stone" as const, nationId: n.id, citiesBuiltInEra: [], eraProgress: 0, unlockedAt: 0 }]));
    const eraAncient = Object.fromEntries(b.w.nations.map((n) => [n.id, { currentEra: "ancient" as const, nationId: n.id, citiesBuiltInEra: [], eraProgress: 0, unlockedAt: 0 }]));
    applyPopulationDynamics(a.w, a.diplomacy, 1, eraStone);
    applyPopulationDynamics(b.w, b.diplomacy, 1, eraAncient);
    const popStone = a.w.cities.reduce((s, c) => s + c.population, 0);
    const popAncient = b.w.cities.reduce((s, c) => s + c.population, 0);
    expect(popAncient).toBeGreaterThanOrEqual(popStone);
  });

  test("tabla vitalidad: 6 eras con rangos ±2", () => {
    const rows = getEraVitalityRows();
    expect(rows).toHaveLength(6);
    expect(rows[0]).toMatchObject({ era: "stone", birthPeace: "13–17%", birthWar: "0.2–2%", deathPeace: "8–12%", deathWar: "8–12%" });
    expect(rows[1].birthPeace).toBe("14.3–18.7%");
    expect(rows[5].birthPeace).toBe("20.9–27.4%");
  });

  test("mortalidad igual en paz y guerra; natalidad baja solo con enemigos dentro", () => {
    const mk = (seed: string) => {
      const w = buildDemoWorld(seed, { nationCount: 2, cityCount: 2 });
      const diplomacy = buildInitialDiplomacyState(w);
      return { w, diplomacy };
    };
    // Sin guerra: todos crecen parecido.
    const p = mk("nat-dual-001");
    const q = mk("nat-dual-001");
    applyPopulationDynamics(p.w, p.diplomacy, 1, undefined);
    // Guerra declarada pero sin tropas enemigas en provincias: rige paz.
    q.diplomacy.wars.push({ id: "w1", attackerNationId: q.w.nations[0].id, defenderNationId: q.w.nations[1].id, startedAtMonth: 1 } as any);
    applyPopulationDynamics(q.w, q.diplomacy, 1, undefined, undefined);
    const popP = p.w.cities.reduce((s, c) => s + c.population, 0);
    const popQ = q.w.cities.reduce((s, c) => s + c.population, 0);
    expect(popQ).toBe(popP);
    // Provincia con enemigos dentro: natalidad hundida.
    const r = mk("nat-dual-001");
    r.diplomacy.wars.push({ id: "w1", attackerNationId: r.w.nations[0].id, defenderNationId: r.w.nations[1].id, startedAtMonth: 1 } as any);
    const victim = r.w.cities.find((c) => c.nationId === r.w.nations[1].id)!;
    const enemyMilitary: any = {
      [r.w.nations[0].id]: { nationId: r.w.nations[0].id, units: {}, cityGarrisons: {}, armyGroups: [{ id: "g", nationId: r.w.nations[0].id, locationProvinceId: victim.provinceId, pathProvinceIds: [], movementProgress: 0, units: { militia: 30, infantry: 0, lightCavalry: 0, heavyCavalry: 0, levy: 0, caballeria: 0 }, stance: "attack", createdAtMonth: 0, updatedAtMonth: 0 }], recruitmentQueue: [], morale: 1 },
    };
    applyPopulationDynamics(r.w, r.diplomacy, 1, undefined, enemyMilitary);
    const popR = r.w.cities.reduce((s, c) => s + c.population, 0);
    expect(popR).toBeLessThan(popP);
  });
});
