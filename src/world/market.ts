import type { Resource } from "./types";
import type { GameEvent } from "./events";
import { stream, at } from "./rngService";

export type MarketOffer = {
  id: string;
  sellerNationId: string;
  buyerNationId: string | "system" | "any";
  resourceType: string;
  quantity: number;
  unitPrice: number;
  currency: string;
  validFrom: number;
  validUntil: number;
  status: "offered" | "accepted" | "expired" | "executed";
};

export type Transaction = {
  id: string;
  offers: string[];
  totalGold: number;
  transportCost: number;
  executedAt: number;
  status: "pending" | "completed" | "failed";
};

export type MarketState = {
  offers: MarketOffer[];
  transactions: Transaction[];
  basePrices: Record<string, number>;
  currentPhase: "MARKET_START" | "MARKET_END" | "CLOSED";
  currentTurn: number;
};

const TRANSPORT_FACTOR = 0.01;
const SYSTEM_MARKUP = 1.2;
const SYSTEM_FLUCTUATION = 0.1;

export function buildInitialMarketState(turn: number): MarketState {
  return {
    offers: [],
    transactions: [],
    basePrices: {},
    currentPhase: "MARKET_START",
    currentTurn: turn,
  };
}

export function calculateBasePrices(): Record<string, number> {
  const prices: Record<string, number> = {};
  const resources = ["grain", "timber", "iron", "coal", "oil", "water", "gold", "silver", "copper"];
  for (const resource of resources) {
    prices[resource] = 1;
  }
  return prices;
}

export function generateOffers(
  offers: MarketOffer[],
  nationIds: string[],
  currentTurn: number,
  seed: string,
): MarketOffer[] {
  const rng = stream(seed, "market");
  const newOffers: MarketOffer[] = [];
  const resources: Resource[] = ["grain", "timber", "iron", "coal", "oil", "water", "gold", "silver", "copper"];

  for (const nationId of nationIds) {
    const numOffers = Math.floor(rng() * 3) + 1;
    for (let i = 0; i < numOffers; i += 1) {
      const resource = resources[Math.floor(rng() * resources.length)];
      const isSelling = rng() > 0.5;
      const basePrice = 1;
      const fluctuation = (rng() - 0.5) * 0.2;
      const price = Math.max(0.01, basePrice * (1 + fluctuation) * (isSelling ? 0.9 : 1.1));
      const quantity = Math.floor(rng() * 500) + 50;

      newOffers.push({
        id: `offer-${currentTurn}-${nationId}-${i}`,
        sellerNationId: isSelling ? nationId : "system",
        buyerNationId: isSelling ? "any" : nationId,
        resourceType: resource,
        quantity,
        unitPrice: Math.round(price * 1000) / 1000,
        currency: "gold",
        validFrom: currentTurn,
        validUntil: currentTurn + 1,
        status: "offered",
      });
    }
  }

  return newOffers;
}

export function calculateMarketPrice(basePrice: number, demandRatio: number, supplyRatio: number): number {
  return basePrice * (1 + demandRatio - supplyRatio);
}

export function calculateTransportCost(distance: number, units: number): number {
  return distance * units * TRANSPORT_FACTOR;
}

export function executeTransactions(
  marketState: MarketState,
  currentTurn: number,
): { marketState: MarketState; transactions: Transaction[]; events: GameEvent[] } {
  const executedTransactions: Transaction[] = [];
  const activeOffers = marketState.offers.filter(
    (offer) => offer.status === "offered" && offer.validUntil > currentTurn,
  );

  for (const offer of activeOffers) {
    offer.status = "executed";
    const transportCost = offer.buyerNationId === "system"
      ? 0
      : calculateTransportCost(1, offer.quantity);

    const transaction: Transaction = {
      id: `tx-${currentTurn}-${offer.id}`,
      offers: [offer.id],
      totalGold: offer.unitPrice * offer.quantity,
      transportCost,
      executedAt: currentTurn,
      status: "completed",
    };

    executedTransactions.push(transaction);
  }

  let expiredCount = 0;
  for (const offer of marketState.offers) {
    if (offer.status === "offered" && offer.validUntil <= currentTurn) {
      offer.status = "expired";
      expiredCount += 1;
    }
  }

  const newMarketState: MarketState = {
    ...marketState,
    offers: [...marketState.offers],
    transactions: [...marketState.transactions, ...executedTransactions],
    currentPhase: "MARKET_END",
  };

  return { marketState: newMarketState, transactions: executedTransactions, events: buildMarketEvents(newMarketState, executedTransactions, expiredCount, currentTurn) };
}

export function buildMarketEvents(
  marketState: MarketState,
  executed: Transaction[],
  expiredCount: number,
  currentTurn: number,
): GameEvent[] {
  const offeredCount = marketState.offers.filter((o) => o.validFrom === currentTurn).length;
  // Resumen agregado: máximo 1 evento/mes para no inundar el log (slice -240).
  if (offeredCount === 0 && executed.length === 0 && expiredCount === 0) return [];
  const totalGold = Math.round(executed.reduce((s, t) => s + t.totalGold, 0));
  return [{
    id: `event-market-${currentTurn}`,
    month: currentTurn,
    kind: "market",
    title: "Market Summary",
    description: `Market: ${offeredCount} offers, ${executed.length} executed (${totalGold} gold), ${expiredCount} expired.`,
    nationIds: [],
  }];
}

export function systemSellResource(
  resourceType: string,
  quantity: number,
  basePrice: number,
  seed: string,
  currentTurn: number,
): MarketOffer {
  const rng = stream(seed, "market");
  const price = basePrice * SYSTEM_MARKUP * (1 + (rng() - 0.5) * SYSTEM_FLUCTUATION * 2);
  return {
    id: `system-sell-${resourceType}-${at(seed, "system-sell", currentTurn)}`,
    sellerNationId: "system",
    buyerNationId: "any",
    resourceType,
    quantity,
    unitPrice: Math.round(price * 1000) / 1000,
    currency: "gold",
    validFrom: 0,
    validUntil: Infinity,
    status: "offered",
  };
}
