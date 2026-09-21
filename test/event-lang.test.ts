import { buildDemoWorld } from "../src/world/buildDemoWorld";
import { transferProvince, distributePrisoners } from "../src/world/war";
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

  test("ES/EN: resumen de mercado", () => {
    const state: any = { offers: [{ validFrom: 7 }], transactions: [], currentPhase: "MARKET_END" };
    const es = buildMarketEvents(state, [], 0, 7, "es");
    expect(es[0].lang).toBe("es");
    expect(es[0].title).toBe("Resumen de Mercado");
    expect(es[0].description).toMatch(/Mercado:/);
    const en = buildMarketEvents(state, [], 0, 7);
    expect(en[0].lang).toBeUndefined();
    expect(en[0].title).toBe("Market Summary");
    expect(en[0].description).toMatch(/Market:/);
  });
});
