import type { GameEvent, GameEventKind } from "./events";

export type TopEventTab = "general" | "nacion" | "guerra" | "mercado";
export type GeneralSubTab = "todo" | "diplomacia" | "expansiones" | "espionaje" | "ingenieria";
export type GuerraSubTab = "todos" | "combate" | "logistica";
export type MercadoSubTab = "ofertas" | "transacciones";

export const COMBAT_EVENT_KINDS: GameEventKind[] = [
  "war_declared",
  "war_ended",
  "war_continued",
  "battle_fought",
  "province_occupied",
  "city_lost",
  "nation_defeated",
];

export const LOGISTICS_EVENT_KINDS: GameEventKind[] = [
  "army_group_created",
  "army_group_ordered",
  "army_group_moved",
  "army_group_merged",
  "recruitment_completed",
  "levy_called",
  "military_upkeep_shortage",
  "military_supply_shortage",
  "military_disbanded",
  "desertion",
];

export const WAR_EVENT_KINDS: GameEventKind[] = [...COMBAT_EVENT_KINDS, ...LOGISTICS_EVENT_KINDS];

export const DIPLOMACY_EVENT_KINDS: GameEventKind[] = [
  "alliance_signed",
  "alliance_dissolved",
  "proposal_created",
  "proposal_accepted",
  "truce_signed",
  "vassalage_signed",
  "vassalage_broken",
];

export const SPY_EVENT_KINDS: GameEventKind[] = [
  "spy_dispatched",
  "intelligence_acquired",
  "relations_improved",
  "relations_damaged",
  "relations_sowed_discord",
];

export const EXPANSION_EVENT_KINDS: GameEventKind[] = ["peaceful_expand"];

export const INGENIERIA_EVENT_KINDS: GameEventKind[] = ["construction", "city_developed", "era"];

export const MARKET_EVENT_KINDS: GameEventKind[] = ["market"];

export const GENERAL_TODO_KINDS: GameEventKind[] = ["hunger", "construction", "currency", "era", "city_developed"];

export function isSpyEventKind(kind: GameEventKind): boolean {
  return (SPY_EVENT_KINDS as string[]).includes(kind);
}

export function isCombatEventKind(kind: GameEventKind): boolean {
  return (COMBAT_EVENT_KINDS as string[]).includes(kind);
}

export function isLogisticsEventKind(kind: GameEventKind): boolean {
  return (LOGISTICS_EVENT_KINDS as string[]).includes(kind);
}

export function isDiplomacyEventKind(kind: GameEventKind): boolean {
  return (DIPLOMACY_EVENT_KINDS as string[]).includes(kind);
}

export function isExpansionEventKind(kind: GameEventKind): boolean {
  return (EXPANSION_EVENT_KINDS as string[]).includes(kind);
}

export function isIngenieriaEventKind(kind: GameEventKind): boolean {
  return (INGENIERIA_EVENT_KINDS as string[]).includes(kind);
}

export function getEventCacheKey(kind: GameEventKind): string | null {
  if (COMBAT_EVENT_KINDS.includes(kind)) return "guerra-combate";
  if (LOGISTICS_EVENT_KINDS.includes(kind)) return "guerra-logistica";
  if (DIPLOMACY_EVENT_KINDS.includes(kind)) return "general-diplomacia";
  if (SPY_EVENT_KINDS.includes(kind)) return "general-espionaje";
  if (EXPANSION_EVENT_KINDS.includes(kind)) return "general-expansiones";
  if (INGENIERIA_EVENT_KINDS.includes(kind)) return "general-ingenieria";
  if (GENERAL_TODO_KINDS.includes(kind)) return null;
  return null;
}


