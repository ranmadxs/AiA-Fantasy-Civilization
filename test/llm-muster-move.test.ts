import { buildDemoWorld } from "../src/world/buildDemoWorld";
import {
  formGroupFromCity,
  issueArmyCommands,
  validateMoveOrder,
  validateMusterOrder,
} from "../src/world/war";

jest.setTimeout(60000);

const ZERO = { militia: 0, infantry: 0, lightCavalry: 0, heavyCavalry: 0, levy: 0, caballeria: 0 };

function testArmy(world: ReturnType<typeof buildDemoWorld>, nationId: string, cityId: string, militia: number): any {
  return {
    nationId,
    units: { ...ZERO },
    cityGarrisons: { [cityId]: { ...ZERO, militia } },
    armyGroups: [],
    recruitmentQueue: [],
    morale: 0.8,
  };
}

describe("muster: formar grupo donde dice el LLM", () => {
  test("validateMusterOrder: propia con fondos sí; ajena/sobre-reserva/bajo-mínimo no", () => {
    const world = buildDemoWorld("mus-001", { nationCount: 2, cityCount: 4 });
    const nationId = world.nations[0].id;
    const city = world.cities.find((c) => c.nationId === nationId)!;
    const army = testArmy(world, nationId, city.id, 200);
    expect(validateMusterOrder(world, army, { cityId: city.id, units: { militia: 30 } }).ok).toBe(true);
    const foreign = world.cities.find((c) => c.nationId !== nationId)!;
    expect(validateMusterOrder(world, army, { cityId: foreign.id, units: { militia: 30 } }).ok).toBe(false);
    expect(validateMusterOrder(world, army, { cityId: city.id, units: { militia: 100000 } }).ok).toBe(false);
    expect(validateMusterOrder(world, army, { cityId: city.id, units: { militia: 3 } }).ok).toBe(false);
    expect(validateMusterOrder(world, army, { cityId: "no-existe", units: { militia: 30 } }).ok).toBe(false);
  });

  test("formGroupFromCity crea grupo quieto con origen llm en español", () => {
    const world = buildDemoWorld("mus-002", { nationCount: 2, cityCount: 4 });
    const nationId = world.nations[0].id;
    const city = world.cities.find((c) => c.nationId === nationId)!;
    const army = testArmy(world, nationId, city.id, 200);
    const res = formGroupFromCity(world, army, { cityId: city.id, units: { militia: 30 }, stance: "attack" }, 5, "llm", "es");
    expect(res.army.armyGroups).toHaveLength(1);
    expect(res.army.armyGroups[0].units.militia).toBe(30);
    expect(res.army.armyGroups[0].locationProvinceId).toBe(city.provinceId);
    expect(res.army.cityGarrisons[city.id].militia).toBe(170);
    expect(res.event).toBeDefined();
    expect(res.event!.lang).toBe("es");
    expect(res.event!.description).toMatch(/decisión LLM/);
  });
});

describe("moveGroup: redirigir cualquiera", () => {
  function idleArmy(world: ReturnType<typeof buildDemoWorld>, nationId: string, cityId: string): any {
    return {
      ...testArmy(world, nationId, cityId, 200),
      armyGroups: [{
        id: "g1", nationId, locationProvinceId: world.cities.find((c) => c.id === cityId)!.provinceId,
        pathProvinceIds: [], movementProgress: 0,
        units: { ...ZERO, militia: 40 },
        stance: "garrison", createdAtMonth: 0, updatedAtMonth: 0,
      }],
    };
  }

  test("validateMoveOrder: grupo propio + destino alcanzable sí; resto no", () => {
    const world = buildDemoWorld("mov-001", { nationCount: 2, cityCount: 4 });
    const nationId = world.nations[0].id;
    const city = world.cities.find((c) => c.nationId === nationId)!;
    const army = idleArmy(world, nationId, city.id);
    const dest = world.provinces.find((p) => p.id !== city.provinceId)!;
    const ok = validateMoveOrder(world, army, { groupId: "g1", destinationProvinceId: dest.id }, undefined);
    expect(ok.ok).toBe(true);
    expect(validateMoveOrder(world, army, { groupId: "nope", destinationProvinceId: dest.id }, undefined).ok).toBe(false);
    expect(validateMoveOrder(world, army, { groupId: "g1", destinationProvinceId: "no-existe" }, undefined).ok).toBe(false);
    expect(validateMoveOrder(world, army, { groupId: "g1", destinationProvinceId: dest.id, stance: "bailar" as any }, undefined).ok).toBe(false);
  });

  test("issueArmyCommands ejecuta move LLM con evento y origen", () => {
    const world = buildDemoWorld("mov-002", { nationCount: 2, cityCount: 4 });
    const nationId = world.nations[0].id;
    const city = world.cities.find((c) => c.nationId === nationId)!;
    const army = idleArmy(world, nationId, city.id);
    const dest = world.provinces.find((p) => p.id !== city.provinceId)!;
    const diplomacy: any = { wars: [] };
    const stockpiles: any = { [nationId]: { gold: 10000, water: 100, resources: { grain: 5000 } } };
    const orders = { move: [{ groupId: "g1", destinationProvinceId: dest.id, stance: "attack" as const }] };
    const res = issueArmyCommands(world, diplomacy, army, 5, stockpiles, "es", orders);
    const g = res.army.armyGroups.find((x: any) => x.id === "g1")!;
    expect(g.destinationProvinceId).toBe(dest.id);
    expect(g.stance).toBe("attack");
    const ordered = res.events.find((e) => e.kind === "army_group_ordered")!;
    expect(ordered).toBeDefined();
    expect(ordered.description).toMatch(/decisión LLM/);
  });
});
