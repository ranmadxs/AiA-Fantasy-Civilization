import type { ArmyUnits } from "./war";
import type { World } from "./types";

/** Carretas: equipo de grupo, no unidad. 1 lleva hasta 50 a pie. */
export const CART_CAPACITY_FOOT = 50;
/** Mantención por carreta y turno. */
export const CART_UPKEEP_WOOD = 10;
/** Precio mínimo de oferta externa: siempre superior al costo (1 oro). */
export const CART_TRADE_MIN_PRICE = 2;
/** Costo de traslado interno por carreta. */
export const CART_INTERNAL_COST_GOLD = 1;
/** Ritmo de envío (provincias por mes). */
export const CART_SHIPMENT_SPEED = 1.5;

export type Shipment = {
  id: string;
  nationId: string;
  fromProvinceId: string;
  toProvinceId: string;
  toNationId?: string;
  carts: number;
  departsMonth: number;
  arrivesMonth: number;
  /** 0 = interno; >0 = precio pactado por carreta (oro, lo pone la IA vendedora). */
  pricePerCart: number;
};

export type CartOffer = {
  id: string;
  sellerNationId: string;
  targetNationId: string;
  carts: number;
  pricePerCart: number;
  createdMonth: number;
  expiresMonth: number;
};

export function footUnits(units: ArmyUnits): number {
  return (units.militia ?? 0) + (units.infantry ?? 0) + (units.levy ?? 0);
}

/** Carretas que necesita un grupo: 1 por cada 50 a pie menos las que lleva. */
export function cartsNeededForUnits(units: ArmyUnits, cartsHave: number): number {
  return Math.max(0, Math.ceil(footUnits(units) / CART_CAPACITY_FOOT) - Math.max(0, cartsHave));
}

/** Carretas que necesitan los grupos de una provincia (solo a pie sin carro). */
export function provinceCartNeed(
  groups: Array<{ locationProvinceId: string; units: ArmyUnits; carts?: number }>,
  provinceId: string,
): number {
  return groups
    .filter((g) => g.locationProvinceId === provinceId)
    .reduce((sum, g) => sum + cartsNeededForUnits(g.units, g.carts ?? 0), 0);
}

/** Unidades pagables con el stockpile dado un costo unitario (oro/madera/carbón). */
export function affordableUnits(
  unitCost: Record<string, number>,
  stockpile: { gold: number; resources: Record<string, number> },
): number {
  let n = Number.POSITIVE_INFINITY;
  const parts: Array<[string, number]> = [["gold", unitCost.gold ?? 0]];
  for (const [k, v] of Object.entries(unitCost)) {
    if (k === "gold" || !v) continue;
    parts.push([k, v]);
  }
  for (const [k, v] of parts) {
    if (!v || v <= 0) continue;
    const have = k === "gold" ? stockpile.gold : (stockpile.resources[k] ?? 0);
    n = Math.min(n, Math.floor(have / v));
  }
  return Number.isFinite(n) ? Math.max(0, n) : 0;
}

/** Meses de viaje por tramos de provincia (mínimo 1). */
export function shipmentTravelMonths(hops: number): number {
  return Math.max(1, Math.ceil(Math.max(0, hops) / CART_SHIPMENT_SPEED));
}

/** Tramos BFS entre provincias (mismo criterio que frentes: adyacencia física). */
export function provinceHops(world: World, fromProvinceId: string, toProvinceId: string): number {
  if (fromProvinceId === toProvinceId) return 0;
  const tileByCoord = new Map(world.tiles.map((t) => [`${t.x},${t.y}`, t]));
  const neighbors = new Map<string, Set<string>>();
  const link = (a: string, b: string) => {
    if (a === b) return;
    let set = neighbors.get(a);
    if (!set) {
      set = new Set<string>();
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
  const visited = new Set<string>([fromProvinceId]);
  const queue: { id: string; d: number }[] = [{ id: fromProvinceId, d: 0 }];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    for (const next of neighbors.get(cur.id) ?? []) {
      if (next === toProvinceId) return cur.d + 1;
      if (!visited.has(next)) {
        visited.add(next);
        queue.push({ id: next, d: cur.d + 1 });
      }
    }
  }
  return Number.POSITIVE_INFINITY;
}

export type OfferProblem = "carts" | "price" | "stock" | "target" | "duplicate";

/** Valida oferta externa decidida por la IA (precio siempre > costo). */
export function validateCartOffer(args: {
  sellerPool: number;
  carts: number;
  pricePerCart: number;
  targetOk: boolean;
  duplicate: boolean;
}): OfferProblem | undefined {
  if (!Number.isFinite(args.carts) || args.carts < 1) return "carts";
  if (!Number.isFinite(args.pricePerCart) || args.pricePerCart < CART_TRADE_MIN_PRICE) return "price";
  if (args.carts > args.sellerPool) return "stock";
  if (!args.targetOk) return "target";
  if (args.duplicate) return "duplicate";
  return undefined;
}

export type MoveProblem = "carts" | "source" | "dest" | "stock" | "gold";

/** Valida traslado interno entre provincias propias (1 oro por carreta). */
export function validateCartMove(args: {
  ownSource: boolean;
  ownDest: boolean;
  pool: number;
  carts: number;
  gold: number;
}): MoveProblem | undefined {
  if (!Number.isFinite(args.carts) || args.carts < 1) return "carts";
  if (!args.ownSource) return "source";
  if (!args.ownDest) return "dest";
  if (args.carts > args.pool) return "stock";
  if (args.gold < args.carts * CART_INTERNAL_COST_GOLD) return "gold";
  return undefined;
}
