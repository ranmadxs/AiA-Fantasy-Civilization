import { buildDemoWorld } from "../src/world/buildDemoWorld";
import { transferProvince, distributePrisoners, advanceMilitaryEconomy } from "../src/world/war";
import { buildMarketEvents } from "../src/world/market";

describe("vía B: eventos generados en fuente con idioma", () => {
  test("EN por defecto: inglés idéntico al legacy y sin lang", () => {
    const world = buildDemoWorld("lang-001", { nationCount: 2, cityCount: 4 });
    const nationA = world.nations[0].id;
    const nationB = world.nations[1].id;
    const city = world.cities.find((c) => c.nationId === nationB)!;
    const target = world.provinceById.get(city.provinceId)!;
    city.population = 1000;
    const stockpiles: any = {
      [nationA]: { gold: 100, water: 0, resources: {} },
      [nationB]: { gold: 1000, water: 0, resources: { timber: 500 } },
    };
    const res = transferProvince(world, target.id, nationA, nationB, 5, {
      minasDeCarbon: [], minasDeHierro: [], aserraderos: [], reinos: [], projects: [],
    }, stockpiles, 0);
    const booty = res.events.find((e) => e.id.startsWith("event-botin-"))!;
    expect(booty.description).toMatch(/seized/);
    expect(booty.description).toMatch(/80%\)/);
    expect(booty.lang).toBeUndefined();
    const exodus = res.events.find((e) => e.id.startsWith("event-exodo-"))!;
    expect(exodus.description).toMatch(/inhabitants fled/);
  });

  test("ES: botín, éxodo y provincia con nameEs", () => {
    const world = buildDemoWorld("lang-002", { nationCount: 2, cityCount: 4 });
    const nationA = world.nations[0].id;
    const nationB = world.nations[1].id;
    const city = world.cities.find((c) => c.nationId === nationB)!;
    const target = world.provinceById.get(city.provinceId)!;
    city.population = 1000;
    const stockpiles: any = {
      [nationA]: { gold: 100, water: 0, resources: {} },
      [nationB]: { gold: 1000, water: 0, resources: { timber: 500 } },
    };
    const res = transferProvince(world, target.id, nationA, nationB, 5, {
      minasDeCarbon: [], minasDeHierro: [], aserraderos: [], reinos: [], projects: [],
    }, stockpiles, 0, "es");
    const booty = res.events.find((e) => e.id.startsWith("event-botin-"))!;
    expect(booty.lang).toBe("es");
    expect(booty.description).toMatch(/saqueó/);
    expect(booty.description).toMatch(/[Mm]adera/);
    expect(booty.description).not.toMatch(/seized/);
    const exodus = res.events.find((e) => e.id.startsWith("event-exodo-"))!;
    expect(exodus.description).toMatch(/huyeron de/);
    expect(exodus.description).not.toMatch(/inhabitants fled/);
    const occupied = res.events.find((e) => e.id.startsWith("event-province-occupied-"))!;
    // occupied sigue display-covered (sin lang) pero el test confirma que no se rompió.
    expect(occupied.description).toMatch(/occupied/);
  });

  test("ES: prisioneros con nameEs", () => {
    const world = buildDemoWorld("lang-003", { nationCount: 2, cityCount: 4 });
    const nationA = world.nations[0].id;
    const nationB = world.nations[1].id;
    const provinceId = world.provinces.find((p) => p.nationId === nationA)!.id;
    const events = distributePrisoners(world, {}, {}, undefined, nationA, nationB, {
      militia: 10, infantry: 0, lightCavalry: 0, heavyCavalry: 0, levy: 0, caballeria: 0,
    }, provinceId, 3, "es");
    expect(events.length).toBe(1);
    expect(events[0].lang).toBe("es");
    expect(events[0].description).toMatch(/capturó/);
    expect(events[0].description).toMatch(/prisioneros/);
    expect(events[0].description).not.toMatch(/captured/);
  });

  test("ES/EN: resumen de mercado", () => {    const state: any = { offers: [{ validFrom: 7 }], transactions: [], currentPhase: "MARKET_END" };
    const es = buildMarketEvents(state, [], 0, 7, "es");
    expect(es[0].lang).toBe("es");
    expect(es[0].title).toBe("Resumen de Mercado");
    expect(es[0].description).toMatch(/Mercado:/);
    const en = buildMarketEvents(state, [], 0, 7);
    expect(en[0].lang).toBeUndefined();
    expect(en[0].title).toBe("Market Summary");
    expect(en[0].description).toMatch(/Market:/);
  });

  test("ES: reclutamiento completado con ciudadEs", () => {
    const world = buildDemoWorld("lang-rec", { nationCount: 2, cityCount: 4 });
    const nationId = world.nations[0].id;
    const city = world.cities.find((c) => c.nationId === nationId)!;
    const zeroUnits = { militia: 0, infantry: 0, lightCavalry: 0, heavyCavalry: 0, levy: 0, caballeria: 0 };
    const army: any = {
      nationId,
      units: { ...zeroUnits },
      cityGarrisons: {},
      armyGroups: [],
      recruitmentQueue: [{
        id: "r1", nationId, cityId: city.id, unitType: "infantry",
        amount: 3, startedAtMonth: 2, completesAtMonth: 5,
      }],
      morale: 0.8,
    };
    const stockpiles: any = {
      [nationId]: { gold: 100000, water: 1000, resources: { grain: 5000, timber: 5000, iron: 5000, coal: 5000 } },
    };
    const res = advanceMilitaryEconomy(world, { [nationId]: army }, stockpiles, {}, { wars: [] } as any, 5, 1, undefined, undefined, "es");
    const done = res.events.find((e) => e.kind === "recruitment_completed")!;
    expect(done).toBeDefined();
    expect(done.lang).toBe("es");
    expect(done.title).toBe("Reclutamiento completado");
    expect(done.description).toMatch(/terminaron su entrenamiento/);
    expect(done.description).toMatch(/infantería/);
    expect(done.description).toContain(city.nameEs ?? city.name);
    expect(done.description).not.toMatch(/finished training/);
  });

  test("ES: ciudad desarrollada con naciónEs (el caso Pearlhaven)", () => {
    const world = buildDemoWorld("lang-dev", { nationCount: 2, cityCount: 4 });
    const nationId = world.nations[0].id;
    const nation = world.nationById.get(nationId)!;
    const city = world.cities.find((c) => c.nationId === nationId)!;
    city.level = 1;
    city.population = 50;
    const zeroUnits = { militia: 0, infantry: 0, lightCavalry: 0, heavyCavalry: 0, levy: 0, caballeria: 0 };
    const army: any = {
      nationId,
      units: { ...zeroUnits },
      cityGarrisons: {},
      armyGroups: [],
      recruitmentQueue: [],
      morale: 0.8,
    };
    const stockpiles: any = {
      [nationId]: { gold: 100000, water: 1000, resources: { grain: 20000, timber: 20000, iron: 20000, coal: 20000 } },
    };
    const policies: any = {
      [nationId]: { economy: { policy: "construction", label: "Construction", rationale: "test", decidedAtMonth: 0, nextDecisionMonth: 99 } },
    };
    const res = advanceMilitaryEconomy(world, { [nationId]: army }, stockpiles, policies, { wars: [] } as any, 5, 1, undefined, undefined, "es");
    const developed = res.events.find((e) => e.kind === "city_developed")!;
    expect(developed).toBeDefined();
    expect(developed.lang).toBe("es");
    expect(developed.title).toBe("Ciudad desarrollada");
    expect(developed.description).toMatch(/invirtió excedentes/);
    expect(developed.description).toContain(nation.nameEs);
    expect(developed.description).not.toMatch(/invested surplus/);
  });

  test("EN por defecto: city_developed y recruitment intactos", () => {
    const world = buildDemoWorld("lang-en2", { nationCount: 2, cityCount: 4 });
    const nationId = world.nations[0].id;
    const city = world.cities.find((c) => c.nationId === nationId)!;
    city.level = 1;
    city.population = 50;
    const zeroUnits = { militia: 0, infantry: 0, lightCavalry: 0, heavyCavalry: 0, levy: 0, caballeria: 0 };
    const army: any = {
      nationId,
      units: { ...zeroUnits },
      cityGarrisons: {},
      armyGroups: [],
      recruitmentQueue: [{
        id: "r1", nationId, cityId: city.id, unitType: "infantry",
        amount: 3, startedAtMonth: 2, completesAtMonth: 5,
      }],
      morale: 0.8,
    };
    const stockpiles: any = {
      [nationId]: { gold: 100000, water: 1000, resources: { grain: 20000, timber: 20000, iron: 20000, coal: 20000 } },
    };
    const policies: any = {
      [nationId]: { economy: { policy: "construction", label: "Construction", rationale: "test", decidedAtMonth: 0, nextDecisionMonth: 99 } },
    };
    const res = advanceMilitaryEconomy(world, { [nationId]: army }, stockpiles, policies, { wars: [] } as any, 5, 1);
    const done = res.events.find((e) => e.kind === "recruitment_completed")!;
    expect(done.lang).toBeUndefined();
    expect(done.description).toMatch(/finished training/);
    const developed = res.events.find((e) => e.kind === "city_developed")!;
    expect(developed.description).toMatch(/invested surplus/);
  });
});
