import {
  CART_CAPACITY_FOOT,
  CART_TRADE_MIN_PRICE,
  CART_UPKEEP_WOOD,
  cartsNeededForUnits,
  shipmentTravelMonths,
  validateCartMove,
  validateCartOffer,
} from "../src/world/carts";
import { buildDemoWorld } from "../src/world/buildDemoWorld";
import { advanceCartTrade } from "../src/world/turnSimulation";

function cartWorld() {
  const world = buildDemoWorld("carts-001", { nationCount: 2, cityCount: 4 });
  const provinces = world.provinces.filter((p) => p.nationId);
  return { world, provinces };
}

const FOOT_120 = { militia: 60, infantry: 40, lightCavalry: 0, heavyCavalry: 0, levy: 20, caballeria: 0 };

describe("carretas", () => {
  test("necesidad: 1 por cada 50 a pie menos las que ya lleva", () => {
    expect(cartsNeededForUnits(FOOT_120, 0)).toBe(3);
    expect(cartsNeededForUnits(FOOT_120, 2)).toBe(1);
    expect(cartsNeededForUnits(FOOT_120, 5)).toBe(0);
    expect(cartsNeededForUnits({ militia: 0, infantry: 0, lightCavalry: 10, heavyCavalry: 0, levy: 0, caballeria: 4 }, 0)).toBe(0);
  });

  test("viaje: meses por tramos, mínimo 1", () => {
    expect(shipmentTravelMonths(0)).toBe(1);
    expect(shipmentTravelMonths(1)).toBe(1);
    expect(shipmentTravelMonths(3)).toBe(2);
    expect(shipmentTravelMonths(6)).toBe(4);
  });

  test("oferta: precio siempre superior al costo (mínimo 2)", () => {
    expect(CART_TRADE_MIN_PRICE).toBeGreaterThan(1);
    expect(validateCartOffer({ sellerPool: 5, carts: 3, pricePerCart: 1, targetOk: true, duplicate: false })).toBe("price");
    expect(validateCartOffer({ sellerPool: 5, carts: 3, pricePerCart: 2, targetOk: true, duplicate: false })).toBeUndefined();
    expect(validateCartOffer({ sellerPool: 2, carts: 3, pricePerCart: 5, targetOk: true, duplicate: false })).toBe("stock");
    expect(validateCartOffer({ sellerPool: 5, carts: 0, pricePerCart: 5, targetOk: true, duplicate: false })).toBe("carts");
    expect(validateCartOffer({ sellerPool: 5, carts: 3, pricePerCart: 5, targetOk: false, duplicate: false })).toBe("target");
    expect(validateCartOffer({ sellerPool: 5, carts: 3, pricePerCart: 5, targetOk: true, duplicate: true })).toBe("duplicate");
  });

  test("traslado interno: provincias propias, pool suficiente, costo 1 oro", () => {
    expect(validateCartMove({ ownSource: true, ownDest: true, pool: 4, carts: 3, gold: 100 })).toBeUndefined();
    expect(validateCartMove({ ownSource: true, ownDest: true, pool: 2, carts: 3, gold: 100 })).toBe("stock");
    expect(validateCartMove({ ownSource: false, ownDest: true, pool: 4, carts: 3, gold: 100 })).toBe("source");
    expect(validateCartMove({ ownSource: true, ownDest: true, pool: 4, carts: 3, gold: 2 })).toBe("gold");
  });

  test("constantes: 50 por carreta, upkeep 10 madera", () => {
    expect(CART_CAPACITY_FOOT).toBe(50);
    expect(CART_UPKEEP_WOOD).toBe(10);
  });

  test("reparto: pool llena necesidad del grupo chico primero + convoy", () => {
    const { world } = cartWorld();
    const nationId = world.nations[0].id;
    const provinceId = world.provinces.find((p) => p.nationId === nationId)!.id;
    const foot = { militia: 60, infantry: 40, lightCavalry: 0, heavyCavalry: 0, levy: 20, caballeria: 0 };
    const military: any = {
      [nationId]: {
        nationId, units: foot, cityGarrisons: {}, recruitmentQueue: [], morale: 0.8,
        armyGroups: [{ id: "g1", nationId, locationProvinceId: provinceId, pathProvinceIds: [], movementProgress: 0, units: foot, stance: "defend", createdAtMonth: 0, updatedAtMonth: 0 }],
      },
    };
    const stockpiles: any = { [nationId]: { gold: 100, water: 0, resources: { timber: 1000 } } };
    const aserraderos: any = [{ id: "e1", nationId, provinceId, era: "stone", activa: true, nivel: 3, carts: 5 }];
    const res = advanceCartTrade({
      world, military, stockpiles, aserraderos, policies: {}, shipments: [], offers: [],
      diplomacy: { wars: [] }, nationRelations: {}, nextMonth: 1,
    });
    expect(military[nationId].armyGroups[0].carts).toBe(3);
    expect(military[nationId].armyGroups[0].convoy).toBe(true);
    // Sin otra provincia con necesidad, el sobrante queda en el pool.
    expect(aserraderos[0].carts).toBe(2);
    expect(res.shipments).toHaveLength(0);
    expect(res.events.some((e) => e.title.includes("Convoy") || e.id.includes("convoy"))).toBe(true);
  });

  test("mantención impaga pierde carretas y deja botín", () => {
    const { world } = cartWorld();
    const nationId = world.nations[0].id;
    const provinceId = world.provinces.find((p) => p.nationId === nationId)!.id;
    const military: any = { [nationId]: { nationId, units: {}, cityGarrisons: {}, recruitmentQueue: [], morale: 0.8, armyGroups: [] } };
    const stockpiles: any = { [nationId]: { gold: 100, water: 0, resources: { timber: 5 } } };
    const aserraderos: any = [{ id: "e1", nationId, provinceId, era: "stone", activa: true, nivel: 3, carts: 4, x: 0, y: 0 }];
    const res = advanceCartTrade({
      world, military, stockpiles, aserraderos, policies: {}, shipments: [], offers: [],
      diplomacy: { wars: [] }, nationRelations: {}, nextMonth: 1,
    });
    // 4 carretas × 10 madera con 5 disponible: keeps 0, pierde 4.
    expect(aserraderos[0].carts).toBe(0);
    expect(res.events.some((e) => e.id.includes("carts-lost"))).toBe(true);
    const loot = world.tiles.find((t) => (t.lostCarts ?? 0) > 0);
    expect(loot).toBeDefined();
  });
});
