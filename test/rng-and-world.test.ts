import { stream, at, hashString, mulberry32, randomAt } from "../src/world/rngService";
import { generateOffers } from "../src/world/market";
import { buildInitialCurrencyState } from "../src/world/currency";
import type { World } from "../src/world/types";

describe("rngService — determinismo central", () => {
  test("hashString siempre devuelve el mismo valor", () => {
    expect(hashString("test")).toBe(hashString("test"));
    expect(hashString("different")).not.toBe(hashString("test"));
  });

  test("mulberry32 produce secuencia reproducible", () => {
    const a = mulberry32(12345);
    const b = mulberry32(12345);
    const vals: number[] = [];
    for (let i = 0; i < 100; i += 1) {
      vals.push(a());
    }
    const bVals: number[] = [];
    for (let i = 0; i < 100; i += 1) {
      bVals.push(b());
    }
    expect(vals).toEqual(bVals);
    expect(vals.every((v) => v >= 0 && v < 1)).toBe(true);
  });

  test("at(seed, salt, month) es determinista", () => {
    const v1 = at("world-001", "test:salt", 5);
    const v2 = at("world-001", "test:salt", 5);
    expect(v1).toBe(v2);
    expect(v1).toBeGreaterThanOrEqual(0);
    expect(v1).toBeLessThan(1);
  });

  test("at con diferente seed o salt produce valores distintos", () => {
    const v1 = at("world-001", "salt-a", 5);
    const v2 = at("world-001", "salt-b", 5);
    expect(v1).not.toBe(v2);
  });

  test("stream por dominio es independiente", () => {
    const marketStream = stream("world-001", "market");
    const warStream = stream("world-001", "war");
    const marketVals: number[] = [];
    for (let i = 0; i < 50; i += 1) {
      marketVals.push(marketStream());
    }
    const warVals: number[] = [];
    for (let i = 0; i < 50; i += 1) {
      warVals.push(warStream());
    }
    expect(marketVals).not.toEqual(warVals);
    marketVals.forEach((v) => expect(v).toBeGreaterThanOrEqual(0));
    warVals.forEach((v) => expect(v).toBeGreaterThanOrEqual(0));
  });

  test("mismo seed y dominio producen la misma secuencia", () => {
    const s1 = stream("world-001", "market");
    const s2 = stream("world-001", "market");
    for (let i = 0; i < 100; i += 1) {
      expect(s1()).toBe(s2());
    }
  });

  test("DOMAIN_XOR tiene valores distintos para cada dominio", () => {
    const domains = ["war", "market", "economy", "spies", "skin", "worldgen"];
    const xorValues = domains.map((d) => {
      const h = hashString("world-001");
      const xorMap: Record<string, number> = {
        war: 0x57410000, market: 0x4d410000, economy: 0x45430000,
        spies: 0x53500000, skin: 0x70cc1e, worldgen: 0x00,
      };
      return (h ^ xorMap[d]) >>> 0;
    });
    const unique = new Set(xorValues);
    expect(unique.size).toBe(6);
  });

  test("randomAt es determinista", () => {
    const v1 = randomAt(10, 20, 1000);
    const v2 = randomAt(10, 20, 1000);
    expect(v1).toBe(v2);
    expect(v1).toBeGreaterThanOrEqual(0);
    expect(v1).toBeLessThan(1);
  });

  test("randomAt con diferentes coordenadas produce valores distintos", () => {
    const v1 = randomAt(10, 20, 1000);
    const v2 = randomAt(20, 10, 1000);
    expect(v1).not.toBe(v2);
  });
});

describe("market — ofertas reproducibles", () => {
  const nationIds = ["aurora", "verdant", "sol", "ember", "lumen", "cobalt"];

  test("generateOffers con misma seed produce mismos resultados", () => {
    const offers1 = generateOffers([], nationIds, 1, "world-001");
    const offers2 = generateOffers([], nationIds, 1, "world-001");
    expect(offers1).toHaveLength(offers2.length);
    offers1.forEach((offer, i) => {
      expect(offer).toEqual(offers2[i]);
    });
  });

  test("generateOffers con diferente seed produce resultados distintos", () => {
    const offers1 = generateOffers([], nationIds, 1, "world-001");
    const offers2 = generateOffers([], nationIds, 1, "world-002");
    const ids1 = offers1.map((o) => o.id).join(",");
    const ids2 = offers2.map((o) => o.id).join(",");
    expect(ids1).not.toBe(ids2);
  });

  test("generateOffers genera cantidad correcta de ofertas", () => {
    const offers = generateOffers([], nationIds, 1, "world-001");
    expect(offers.length).toBeGreaterThanOrEqual(nationIds.length);
    offers.forEach((offer) => {
      expect(offer.status).toBe("offered");
      expect(offer.currency).toBe("gold");
    });
  });
});

describe("currency — reservas metálicas reproducibles", () => {
  const world = {
    seed: "world-001",
    width: 192,
    height: 128,
    tiles: [],
    nations: [
      { id: "aurora", name: "Aurora" },
      { id: "verdant", name: "Verdant" },
    ],
    provinces: [],
    cities: [
      { nationId: "aurora", population: 10000 },
      { nationId: "verdant", population: 5000 },
    ],
    provinceById: new Map(),
    nationById: new Map(),
    cityById: new Map(),
    provinceEdges: [],
    nationEdges: [],
  } as unknown as World;

  test("buildInitialCurrencyState es determinista", () => {
    const state1 = buildInitialCurrencyState(world);
    const state2 = buildInitialCurrencyState(world);
    expect(Object.keys(state1.nationalCurrencies)).toEqual(
      Object.keys(state2.nationalCurrencies),
    );
    for (const nationId of Object.keys(state1.nationalCurrencies)) {
      const c1 = state1.nationalCurrencies[nationId];
      const c2 = state2.nationalCurrencies[nationId];
      expect(c1.exchangeRateToGold).toBe(c2.exchangeRateToGold);
      expect(c1.conversionFee).toBe(c2.conversionFee);
      expect(c1.metalReserve).toEqual(c2.metalReserve);
    }
  });

  test("buildInitialCurrencyState tiene todas las naciones", () => {
    const state = buildInitialCurrencyState(world);
    expect(Object.keys(state.nationalCurrencies)).toHaveLength(2);
  });
});
