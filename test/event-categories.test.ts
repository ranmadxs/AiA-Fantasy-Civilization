import {
  COMBAT_EVENT_KINDS,
  DIPLOMACY_EVENT_KINDS,
  EXPANSION_EVENT_KINDS,
  LOGISTICS_EVENT_KINDS,
  MARKET_EVENT_KINDS,
  RESUMEN_TODO_KINDS,
  SPY_EVENT_KINDS,
  WAR_EVENT_KINDS,
  getEventCacheKey,
  isCombatEventKind,
  isDiplomacyEventKind,
  isExpansionEventKind,
  isLogisticsEventKind,
  isSpyEventKind,
} from "../src/world/eventCategories";
import { unitStats } from "../src/world/war";

describe("eventCategories", () => {
  test("listas base disjuntas (salvo WAR = combate+logística)", () => {
    const bases = [
      COMBAT_EVENT_KINDS,
      LOGISTICS_EVENT_KINDS,
      DIPLOMACY_EVENT_KINDS,
      SPY_EVENT_KINDS,
      EXPANSION_EVENT_KINDS,
      MARKET_EVENT_KINDS,
      RESUMEN_TODO_KINDS,
    ];
    for (let i = 0; i < bases.length; i += 1) {
      for (let j = i + 1; j < bases.length; j += 1) {
        const overlap = bases[i].filter((k) => (bases[j] as string[]).includes(k));
        expect(overlap).toEqual([]);
      }
    }
    expect([...WAR_EVENT_KINDS].sort()).toEqual([...COMBAT_EVENT_KINDS, ...LOGISTICS_EVENT_KINDS].sort());
  });

  test("diplomacia no incluye espionaje", () => {
    expect(isDiplomacyEventKind("alliance_signed" as any)).toBe(true);
    expect(isDiplomacyEventKind("spy_dispatched" as any)).toBe(false);
    expect(isSpyEventKind("spy_dispatched" as any)).toBe(true);
    expect(isSpyEventKind("alliance_signed" as any)).toBe(false);
  });

  test("expansiones solo peaceful_expand", () => {
    expect(isExpansionEventKind("peaceful_expand" as any)).toBe(true);
    expect(isExpansionEventKind("city_developed" as any)).toBe(false);
  });

  test("combate tiene su marca (badge ⚔️)", () => {
    expect(isCombatEventKind("battle_fought" as any)).toBe(true);
    expect(isCombatEventKind("war_declared" as any)).toBe(true);
    expect(isCombatEventKind("war_continued" as any)).toBe(true);
    expect(isCombatEventKind("recruitment_completed" as any)).toBe(false);
    expect(isCombatEventKind("spy_dispatched" as any)).toBe(false);
  });

  test("logística tiene su marca (badge 📦)", () => {
    expect(isLogisticsEventKind("recruitment_completed" as any)).toBe(true);
    expect(isLogisticsEventKind("army_group_moved" as any)).toBe(true);
    expect(isLogisticsEventKind("levy_called" as any)).toBe(true);
    expect(isLogisticsEventKind("battle_fought" as any)).toBe(false);
    expect(isLogisticsEventKind("spy_dispatched" as any)).toBe(false);
  });

  test("getEventCacheKey rutea cada kind a su tab", () => {
    expect(getEventCacheKey("battle_fought" as any)).toBe("guerra-combate");
    expect(getEventCacheKey("war_continued" as any)).toBe("guerra-combate");
    expect(getEventCacheKey("recruitment_completed" as any)).toBe("guerra-logistica");
    expect(getEventCacheKey("levy_called" as any)).toBe("guerra-logistica");
    expect(getEventCacheKey("alliance_signed" as any)).toBe("resumen-diplomacia");
    expect(getEventCacheKey("spy_dispatched" as any)).toBe("resumen-espionaje");
    expect(getEventCacheKey("peaceful_expand" as any)).toBe("resumen-expansiones");
    expect(getEventCacheKey("market" as any)).toBeNull();
    expect(getEventCacheKey("hunger" as any)).toBeNull();
  });

  test("levy tiene stats de mitad de soldado a 0.015 oro", () => {
    expect(unitStats.levy.attack).toBeLessThanOrEqual(unitStats.militia.attack / 2);
    expect(unitStats.levy.defense).toBeLessThanOrEqual(unitStats.militia.defense);
    expect(unitStats.levy.hp).toBeLessThanOrEqual(unitStats.militia.hp / 2);
    expect(unitStats.levy.recruitGold).toBe(0.015);
  });
});
