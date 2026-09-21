import { calculateNationCityEconomy } from "./cityEconomy";
import { resourceTypes } from "./economy";
import { isNationActive } from "./nationStatus";
import { HEGEMONY_ALERT_SHARE, VICTORY_RUSH_SHARE, getDomination } from "./nationStatus";
import { getNationRelationsFor, otherNationId, type NationRelations } from "./relationships";
import { calculateNationMonthlyIncome, type NationStockpiles } from "./settlement";
import type { Resource, Tile, World } from "./types";
import { buildProvinceAdjacency } from "./war";
import { ERA_CONFIGS, eraChangeCost, getNationEra, nextEra } from "./era";
import type { EraState } from "./era";

export const policyDecisionIntervalMonths = 2;

/** Oro mínimo para intentar expansión pacífica (colonizar neutrales cuesta 1 oro, sin tributo). */
export const PEACEFUL_EXPAND_MIN_GOLD = 1;

export type ExpansionPolicy = "none" | "control_city" | "control_resource" | "decisive_battle" | "peaceful_expand";
export type EconomyPolicy = "construction" | "recovery" | "army_building";
export type DiplomacyPolicy =
  | "none"
  | "declare_war"
  | "demand_vassalage"
  | "seek_alliance"
  | "seek_peace"
  | "seek_vassalage"
  | "surrender";
export type SpyMissionPolicy =
  | "damage_relations"
  | "gather_intelligence"
  | "improve_relations"
  | "sow_discord";
export type EraPolicy = "stay" | "advance_era" | "skip_dark";

export type PolicyDirection<TPolicy extends string> = {
  policy: TPolicy;
  label: string;
  rationale: string;
  targetNationId?: string;
  targetResource?: Resource;
  decidedAtMonth?: number;
  nextDecisionMonth?: number;
};

export type SpyMissionIntent = PolicyDirection<SpyMissionPolicy> & {
  id: string;
  secondaryTargetNationId?: string;
};

export type NationPolicyState = {
  expansion: PolicyDirection<ExpansionPolicy>;
  economy: PolicyDirection<EconomyPolicy>;
  diplomacy: PolicyDirection<DiplomacyPolicy>;
  spyMissions: SpyMissionIntent[];
  /** Cambio de era (opcional): si falta, la nación se queda. */
  era?: PolicyDirection<EraPolicy>;
  decidedAtMonth: number;
  nextDecisionMonth: number;
};

export type NationPolicies = Record<string, NationPolicyState>;

const expansionLabels: Record<ExpansionPolicy, string> = {
  peaceful_expand: "Peaceful Expansion",
  control_city: "Control Cities",
  control_resource: "Control Resources",
  decisive_battle: "Decisive Battle",
  none: "No Expansion",
};

const economyLabels: Record<EconomyPolicy, string> = {
  army_building: "Army Building",
  construction: "Construction",
  recovery: "Recovery",
};

const diplomacyLabels: Record<DiplomacyPolicy, string> = {
  declare_war: "Declare War",
  demand_vassalage: "Demand Vassalage",
  none: "No Diplomatic Move",
  seek_alliance: "Seek Alliance",
  seek_peace: "Seek Peace",
  seek_vassalage: "Seek Vassalage",
  surrender: "Surrender",
};

const spyMissionLabels: Record<SpyMissionPolicy, string> = {
  damage_relations: "Damage Relations",
  gather_intelligence: "Gather Intelligence",
  improve_relations: "Improve Relations",
  sow_discord: "Sow Discord",
};

const eraLabels: Record<EraPolicy, string> = {
  stay: "Stay in Era",
  advance_era: "Advance Era",
  skip_dark: "Skip Dark Age",
};

export function buildInitialNationPolicies(
  world: World,
  relations: NationRelations,
  stockpiles: NationStockpiles,
  currentMonth: number,
): NationPolicies {
  return Object.fromEntries(
    world.nations.map((nation) => [
      nation.id,
      decideNationPolicy(world, relations, stockpiles, nation.id, currentMonth),
    ]),
  );
}

export function advanceNationPolicies(
  world: World,
  relations: NationRelations,
  stockpiles: NationStockpiles,
  currentPolicies: NationPolicies,
  fromMonth: number,
  toMonth: number,
  eraStates?: Record<string, EraState>,
): NationPolicies {
  let changed = false;
  const nextPolicies = { ...currentPolicies };

  for (const nation of world.nations) {
    if (!isNationActive(world, nation.id)) {
      continue;
    }

    const currentPolicy =
      nextPolicies[nation.id] ??
      decideNationPolicy(world, relations, stockpiles, nation.id, fromMonth, eraStates);

    if (toMonth < currentPolicy.nextDecisionMonth) {
      nextPolicies[nation.id] = currentPolicy;
      continue;
    }

    nextPolicies[nation.id] = decideNationPolicy(world, relations, stockpiles, nation.id, toMonth, eraStates);
    changed = true;
  }

  return changed ? nextPolicies : currentPolicies;
}

export function decideNationPolicy(
  world: World,
  relations: NationRelations,
  stockpiles: NationStockpiles,
  nationId: string,
  currentMonth: number,
  eraStates?: Record<string, EraState>,
): NationPolicyState {
  const profile = buildNationPolicyProfile(world, relations, stockpiles, nationId);
  // Diplomacia primero: la expansión se empareja al mismo objetivo solo si hay guerra.
  const diplomacy = decideDiplomacy(profile, world, stockpiles);
  const warTargetId = diplomacy.policy === "declare_war" ? diplomacy.targetNationId : undefined;

  return {
    expansion: decideExpansion(profile, warTargetId),
    economy: decideEconomy(profile),
    diplomacy,
    spyMissions: decideSpyMissions(profile),
    era: decideEra(profile, world, stockpiles, eraStates, currentMonth),
    decidedAtMonth: currentMonth,
    nextDecisionMonth: currentMonth + policyDecisionIntervalMonths,
  };
}

/** Belicosidad 0–1 determinista por nación (deriva de seed+nación, no consume RNG). */
export function nationBellicosity(seed: string, nationId: string): number {
  let hash = 2166136261;
  const value = `${seed}:bellicosity:${nationId}`;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967295;
}

export type BellicosityTier = "pacífica" | "equilibrada" | "belicosa";

export function bellicosityTier(bellicosity: number): BellicosityTier {
  if (bellicosity > 0.66) return "belicosa";
  if (bellicosity < 0.33) return "pacífica";
  return "equilibrada";
}

/** Ventaja de poder exigida para atacar por ambición según belicosidad. */
export function ambitionPowerRatio(bellicosity: number): number {
  const tier = bellicosityTier(bellicosity);
  if (tier === "belicosa") return 1.15;
  if (tier === "pacífica") return 2.0;
  return 1.3;
}

/** Músculo mínimo (tropas por cada 1000 hab.) para ir a la guerra según belicosidad. */
export function warMuscleThreshold(bellicosity: number): number {
  const tier = bellicosityTier(bellicosity);
  if (tier === "belicosa") return 8;
  if (tier === "pacífica") return 12;
  return 10;
}

function nationStrength(world: World, stockpiles: NationStockpiles, nationId: string): number {
  const economy = calculateNationCityEconomy(nationId, world);
  const stockpile = stockpiles[nationId] ?? { gold: 0, resources: {} };
  return economy.army + economy.monthlyGold * 18 + economy.population / 18 + stockpile.gold / 2;
}

export function buildNationPolicyProfile(
  world: World,
  relations: NationRelations,
  stockpiles: NationStockpiles,
  nationId: string,
) {
  const provinces = world.provinces.filter((province) => province.nationId === nationId);
  const cities = world.cities.filter((city) => city.nationId === nationId);
  const economy = calculateNationCityEconomy(nationId, world);
  const income = calculateNationMonthlyIncome(world, nationId);
  const stockpile = stockpiles[nationId] ?? { gold: 0, resources: {} };
  const relationList = getNationRelationsFor(relations, nationId);
  const adjacentNationIds = getAdjacentNationIds(world, nationId);
  const adjacentRelations = relationList.filter((relation) =>
    adjacentNationIds.has(otherNationId(relation, nationId)),
  );
  const hostileRelations = relationList.filter((relation) => relation.attitude <= -25);
  const friendlyRelations = relationList.filter((relation) => relation.attitude >= 25);
  const worstRelation = relationList[0];
  const bestRelation = [...relationList].sort((a, b) => b.attitude - a.attitude)[0];
  const resourceDiversity = resourceTypes.filter((resource) => (income.resources[resource] ?? 0) > 0).length;
  const lowestResource = [...resourceTypes].sort(
    (a, b) => (stockpile.resources[a] ?? 0) + (income.resources[a] ?? 0) * 6 -
      ((stockpile.resources[b] ?? 0) + (income.resources[b] ?? 0) * 6),
  )[0];
  const openBuildingSlots = cities.reduce((sum, city) => sum + (city.isCapital ? 12 : 8), 0);
  const armyPerThousand = economy.population > 0 ? economy.army / (economy.population / 1000) : 0;
  const strength = economy.army + economy.monthlyGold * 18 + economy.population / 18 + stockpile.gold / 2;
  // Dominación: las IA conocen el share de cada nación (victoria al 98%).
  const domination = getDomination(world);
  const ownShare = domination.shares[nationId] ?? 0;
  const leaderId = domination.leaderNationId !== nationId ? domination.leaderNationId : undefined;
  const leaderShare = leaderId ? (domination.shares[leaderId] ?? 0) : 0;

  return {
    armyPerThousand,
    bestRelation,
    adjacentRelations,
    cities,
    domination: { ownShare, leaderId, leaderShare },
    economy,
    friendlyRelations,
    hostileRelations,
    income,
    lowestResource,
    nationId,
    openBuildingSlots,
    provinces,
    relationList,
    resourceDiversity,
    stockpile,
    strength,
    worstRelation,
    world,
  };
}

function decideExpansion(profile: ReturnType<typeof buildNationPolicyProfile>, pairedWarTargetId?: string): PolicyDirection<ExpansionPolicy> {
  if (profile.adjacentRelations.length === 0) {
    if (profile.stockpile.gold >= PEACEFUL_EXPAND_MIN_GOLD) {
      return {
        policy: "peaceful_expand",
        label: expansionLabels.peaceful_expand,
        rationale: "Expanding peacefully by colonizing nearby neutral territory.",
      };
    }
    return {
      policy: "none",
      label: expansionLabels.none,
      rationale: "No adjacent nations and not enough gold for peaceful expansion.",
    };
  }

  const borderHostileRelation = profile.adjacentRelations.find((relation) => relation.attitude <= -10);
  const borderOpportunityRelation = profile.adjacentRelations.find((relation) => relation.attitude <= 12);

  const targetRelation = borderHostileRelation ?? borderOpportunityRelation;
  if (!targetRelation) {
    // Sin objetivo militar viable, solo queda colonizar neutrales si hay oro.
    if (profile.stockpile.gold >= PEACEFUL_EXPAND_MIN_GOLD) {
      return {
        policy: "peaceful_expand",
        label: expansionLabels.peaceful_expand,
        rationale: "No hostile neighbor; colonizing neutral territory.",
      };
    }
    return {
      policy: "none",
      label: expansionLabels.none,
      rationale: "No viable expansion target among adjacent nations.",
    };
  }
  const targetNationId = otherNationId(targetRelation, profile.nationId);

  // Si diplomacia ya declaró guerra (odio o ambición), la expansión apunta al mismo objetivo.
  if (pairedWarTargetId) {
    if (profile.resourceDiversity < 4) {
      return {
        policy: "control_resource",
        label: expansionLabels.control_resource,
        rationale: "Supporting the war effort by seizing supplies from the war target.",
        targetNationId: pairedWarTargetId,
        targetResource: profile.lowestResource,
      };
    }
    if (profile.cities.length < Math.max(3, Math.floor(profile.provinces.length / 7))) {
      return {
        policy: "control_city",
        label: expansionLabels.control_city,
        rationale: "Supporting the war effort by capturing cities from the war target.",
        targetNationId: pairedWarTargetId,
      };
    }
    return {
      policy: "decisive_battle",
      label: expansionLabels.decisive_battle,
      rationale: "Full-scale confrontation against the war target.",
      targetNationId: pairedWarTargetId,
    };
  }

  // Si el vecino es hostil y tenemos músculo, la vía militar compite con la pacífica.
  const bellicosity = nationBellicosity(profile.world.seed, profile.nationId);
  const canPeaceful = profile.stockpile.gold >= PEACEFUL_EXPAND_MIN_GOLD;
  const hasMilitaryEdge = profile.armyPerThousand >= warMuscleThreshold(bellicosity) || profile.strength > 9000;
  if (borderHostileRelation && hasMilitaryEdge && !canPeaceful) {
    // sin oro -> militar directo (caso clásico)
  } else if (borderHostileRelation && hasMilitaryEdge && targetRelation.attitude <= -25) {
    // hostilidad severa: aunque haya oro, no esconder la opción militar;
    // se deja que decideDiplomacy declare la guerra y la expansión elija objetivo militar.
    if (profile.resourceDiversity < 4) {
      return {
        policy: "control_resource",
        label: expansionLabels.control_resource,
        rationale: `Hostile border (attitude ${targetRelation.attitude}); seizing supplies despite gold reserves.`,
        targetNationId,
        targetResource: profile.lowestResource,
      };
    }
    return {
      policy: "decisive_battle",
      label: expansionLabels.decisive_battle,
      rationale: `Severe hostility (${targetRelation.attitude}) with military edge; confronting directly.`,
      targetNationId,
    };
  }

  if (canPeaceful) {
    return {
      policy: "peaceful_expand",
      label: expansionLabels.peaceful_expand,
      rationale: "Expanding peacefully through diplomacy and gold payment (neutral territory only).",
    };
  }

  if (profile.resourceDiversity < 4) {
    return {
      policy: "control_resource",
      label: expansionLabels.control_resource,
      rationale: `Resource diversity is ${profile.resourceDiversity}/5, so expansion favors missing supplies.`,
      targetNationId,
      targetResource: profile.lowestResource,
    };
  }

  if (profile.cities.length < Math.max(3, Math.floor(profile.provinces.length / 7))) {
    return {
      policy: "control_city",
      label: expansionLabels.control_city,
      rationale: "Urban control is low compared with territorial size.",
      targetNationId,
    };
  }

  return {
    policy: "decisive_battle",
    label: expansionLabels.decisive_battle,
    rationale: "Expanding through direct confrontation.",
    targetNationId,
  };
}

function decideEconomy(profile: ReturnType<typeof buildNationPolicyProfile>): PolicyDirection<EconomyPolicy> {
  if (profile.stockpile.gold < profile.income.gold * 1.5 || profile.resourceDiversity <= 2) {
    return {
      policy: "recovery",
      label: economyLabels.recovery,
      rationale: "Reserves are thin, so the economy is conserving gold and resources.",
    };
  }

  if (profile.armyPerThousand < 15 || profile.hostileRelations.length >= 1) {
    return {
      policy: "army_building",
      label: economyLabels.army_building,
      rationale: `Army density is ${profile.armyPerThousand.toFixed(1)} per 1K population.`,
    };
  }

  return {
    policy: "construction",
    label: economyLabels.construction,
    rationale: `${profile.openBuildingSlots} empty building slots are available.`,
  };
}

/**
 * Decisión de era (motor): avanzar si hay oro para el costo del cambio
 * y ciudades suficientes para la era siguiente. Sin eraStates → stay.
 */
function decideEra(
  profile: ReturnType<typeof buildNationPolicyProfile>,
  world: World,
  stockpiles: NationStockpiles,
  eraStates: Record<string, EraState> | undefined,
  currentMonth: number,
): PolicyDirection<EraPolicy> {
  void currentMonth;
  const stay: PolicyDirection<EraPolicy> = {
    policy: "stay",
    label: eraLabels.stay,
    rationale: "Holding current era.",
  };
  if (!eraStates) return stay;
  const current = getNationEra(profile.nationId, eraStates);
  const cities = world.cities.filter((c) => c.nationId === profile.nationId).length;
  const gold = stockpiles[profile.nationId]?.gold ?? 0;
  // Era oscura opcional: en medieval, si alcanza para modern directo se salta.
  if (current === "medieval") {
    const skipCost = eraChangeCost("modern");
    const skipNeed = ERA_CONFIGS["modern"]?.unlockCities ?? 0;
    if (gold >= skipCost && cities >= skipNeed) {
      return {
        policy: "skip_dark",
        label: eraLabels.skip_dark,
        rationale: `Skipping optional dark age to modern for ${skipCost} gold (${cities} cities).`,
      };
    }
  }
  const next = nextEra(current);
  if (!next) return stay;
  const cost = eraChangeCost(next);
  const needCities = ERA_CONFIGS[next]?.unlockCities ?? 0;
  if (gold >= cost && cities >= needCities) {
    return {
      policy: "advance_era",
      label: eraLabels.advance_era,
      rationale: `Advancing to ${next} for ${cost} gold (${cities} cities).`,
    };
  }
  return stay;
}

function decideDiplomacy(
  profile: ReturnType<typeof buildNationPolicyProfile>,
  world: World,
  stockpiles: NationStockpiles,
): PolicyDirection<DiplomacyPolicy> {
  const bellicosity = nationBellicosity(world.seed, profile.nationId);
  const muscleThreshold = warMuscleThreshold(bellicosity);
  const canPeacefulExpand = profile.stockpile.gold >= PEACEFUL_EXPAND_MIN_GOLD;
  const hostileAdjacent = profile.adjacentRelations.filter((r) => r.attitude <= -10);
  const hasMilitaryEdge = profile.armyPerThousand >= muscleThreshold || profile.strength > 9000;

  // 1. Odio: guerra por hostilidad severa aunque haya oro.
  const severeHostile = hostileAdjacent.find((r) => r.attitude <= -25);
  if (severeHostile && hasMilitaryEdge) {
    const targetNationId = otherNationId(severeHostile, profile.nationId);
    return {
      policy: "declare_war",
      label: diplomacyLabels.declare_war,
      rationale: "Severe border hostility with military edge; declaring war despite reserves.",
      targetNationId,
    };
  }

  // 1b. Miedo al hegemón: hostil (no severo) + músculo basta contra el líder.
  const hegemonFearId = profile.domination.leaderShare >= HEGEMONY_ALERT_SHARE
    ? profile.domination.leaderId
    : undefined;
  if (hegemonFearId && hasMilitaryEdge) {
    const hegemonHostile = hostileAdjacent.find(
      (r) => otherNationId(r, profile.nationId) === hegemonFearId,
    );
    if (hegemonHostile) {
      return {
        policy: "declare_war",
        label: diplomacyLabels.declare_war,
        rationale: "Hegemon threatens domination; striking first with military edge.",
        targetNationId: hegemonFearId,
      };
    }
  }

  // 2. Ambición: atacar al vecino adyacente más débil si la ventaja de poder
  // supera el umbral de belicosidad (belicosa 1.15×, equilibrada 1.3×, pacífica 2×).
  // La guerra cuesta (upkeep ×1.5, bajas, moral, treguas): solo compensa al fuerte.
  // Las IA conocen la dominación: ante un hegemón (≥70%) lo prefieren como
  // objetivo, y el líder en rush (≥90%) baja su exigencia.
  if (hasMilitaryEdge && profile.armyPerThousand >= 6) {
    const hegemonId = profile.domination.leaderShare >= HEGEMONY_ALERT_SHARE
      ? profile.domination.leaderId
      : undefined;
    const rushing = profile.domination.ownShare >= VICTORY_RUSH_SHARE;
    const ordered = [...profile.adjacentRelations].sort((a, b) => {
      const aIsHegemon = hegemonId !== undefined && otherNationId(a, profile.nationId) === hegemonId ? 0 : 1;
      const bIsHegemon = hegemonId !== undefined && otherNationId(b, profile.nationId) === hegemonId ? 0 : 1;
      return aIsHegemon - bIsHegemon;
    });
    let weakestId: string | undefined;
    let bestRatio = 0;
    let bestRationale = "";
    for (const relation of ordered) {
      const targetId = otherNationId(relation, profile.nationId);
      const targetStrength = nationStrength(world, stockpiles, targetId);
      if (targetStrength <= 0) continue;
      const ratio = profile.strength / targetStrength;
      let neededRatio = ambitionPowerRatio(bellicosity);
      let motive = "war of ambition";
      if (targetId === hegemonId) {
        neededRatio *= 0.9;
        motive = "anti-hegemony war";
      } else if (rushing) {
        neededRatio *= 0.85;
        motive = "final rush to domination";
      }
      if (ratio >= neededRatio && ratio > bestRatio) {
        bestRatio = ratio;
        weakestId = targetId;
        bestRationale = `Power advantage ${ratio.toFixed(2)}× over neighbor justifies ${motive} (${bellicosityTier(bellicosity)}).`;
      }
    }
    if (weakestId) {
      return {
        policy: "declare_war",
        label: diplomacyLabels.declare_war,
        rationale: bestRationale,
        targetNationId: weakestId,
      };
    }
  }

  if (hostileAdjacent.length > 0 && !canPeacefulExpand) {
    const target = hostileAdjacent[0];
    const targetNationId = otherNationId(target, profile.nationId);
    return {
      policy: "declare_war",
      label: diplomacyLabels.declare_war,
      rationale: "Hostile border target detected, declaring war to expand.",
      targetNationId,
    };
  }

  const borderOpportunity = profile.adjacentRelations.find((relation) => relation.attitude <= 8);
  if (borderOpportunity && !canPeacefulExpand) {
    const targetNationId = otherNationId(borderOpportunity, profile.nationId);
    return {
      policy: "declare_war",
      label: diplomacyLabels.declare_war,
      rationale: "Nearby target available, declaring war to expand.",
      targetNationId,
    };
  }

  if (profile.worstRelation && profile.worstRelation.attitude <= -70 && profile.armyPerThousand < 6) {
    return {
      policy: "seek_vassalage",
      label: diplomacyLabels.seek_vassalage,
      rationale: "Severe hostility and weak army density make protection attractive.",
      targetNationId: otherNationId(profile.worstRelation, profile.nationId),
    };
  }

  if (profile.bestRelation && profile.bestRelation.attitude >= 35) {
    return {
      policy: "seek_alliance",
      label: diplomacyLabels.seek_alliance,
      rationale: "A friendly partner is available for future mutual defense.",
      targetNationId: otherNationId(profile.bestRelation, profile.nationId),
    };
  }

  if (profile.worstRelation && profile.worstRelation.attitude <= -35 && profile.strength > 9000) {
    return {
      policy: "demand_vassalage",
      label: diplomacyLabels.demand_vassalage,
      rationale: "The nation is strong enough to pressure a weaker rival.",
      targetNationId: otherNationId(profile.worstRelation, profile.nationId),
    };
  }

  return {
    policy: "none",
    label: diplomacyLabels.none,
    rationale: "No diplomatic action has a strong enough advantage yet.",
  };
}

function decideSpyMissions(profile: ReturnType<typeof buildNationPolicyProfile>): SpyMissionIntent[] {
  const missions: SpyMissionIntent[] = [];
  const addMission = (mission: Omit<SpyMissionIntent, "id">) => {
    if (missions.length >= 3) {
      return;
    }

    missions.push({
      ...mission,
      id: `${profile.nationId}-spy-${missions.length}`,
    });
  };

  if (profile.worstRelation && profile.worstRelation.attitude < 25) {
    addMission({
      policy: "gather_intelligence",
      label: spyMissionLabels.gather_intelligence,
      rationale: profile.worstRelation.attitude <= -35
        ? "The most hostile nation should be watched first."
        : "The least trusted neighbor should be watched before policy changes.",
      targetNationId: otherNationId(profile.worstRelation, profile.nationId),
    });
  }

  if (profile.hostileRelations.length >= 2) {
    addMission({
      policy: "sow_discord",
      label: spyMissionLabels.sow_discord,
      rationale: "Multiple hostile neighbors make rivalry manipulation valuable.",
      targetNationId: otherNationId(profile.hostileRelations[0], profile.nationId),
      secondaryTargetNationId: otherNationId(profile.hostileRelations[1], profile.nationId),
    });
  }

  if (profile.bestRelation && profile.bestRelation.attitude >= 20 && profile.bestRelation.attitude < 60) {
    addMission({
      policy: "improve_relations",
      label: spyMissionLabels.improve_relations,
      rationale: "A promising partner can be nudged toward closer cooperation.",
      targetNationId: otherNationId(profile.bestRelation, profile.nationId),
    });
  }

  const merelyWaryRelation = profile.relationList.find(
    (relation) => relation.attitude > -35 && relation.attitude <= -15,
  );
  if (merelyWaryRelation) {
    addMission({
      policy: "damage_relations",
      label: spyMissionLabels.damage_relations,
      rationale: "A wary rival can be contained by worsening its external relations.",
      targetNationId: otherNationId(merelyWaryRelation, profile.nationId),
    });
  }

  return missions;
}

export function getAdjacentNationIds(world: World, nationId: string) {
  const adjacentNationIds = new Set<string>();
  const tileByCoord = new Map(world.tiles.map((tile) => [`${tile.x},${tile.y}`, tile]));

  for (const tile of world.tiles) {
    const province = tile.provinceId ? world.provinceById.get(tile.provinceId) : undefined;
    if (province?.nationId !== nationId) {
      continue;
    }

    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const neighbor = tileByCoord.get(`${tile.x + dx},${tile.y + dy}`);
      const neighborProvince = neighbor?.provinceId ? world.provinceById.get(neighbor.provinceId) : undefined;
      if (neighborProvince?.nationId && neighborProvince.nationId !== nationId) {
        adjacentNationIds.add(neighborProvince.nationId);
      }
    }
  }

  return adjacentNationIds;
}


export function getAdjacentTiles(world: World, nationId: string): Tile[] {
  const adjacency = buildProvinceAdjacency(world);
  const nationProvinceIds = new Set(world.provinces.filter(p => p.nationId === nationId).map(p => p.id));
  const adjacentTiles: Tile[] = [];
  for (const provinceId of nationProvinceIds) {
    for (const neighborId of adjacency.get(provinceId) ?? []) {
      const neighbor = world.provinceById.get(neighborId);
      if (neighbor) {
        const tile = world.tiles.find(t => t.provinceId === neighborId);
        if (tile && !adjacentTiles.find(t => t.provinceId === neighborId)) {
          adjacentTiles.push(tile);
        }
      }
    }
  }
  return adjacentTiles;
}

export function getAdjacentEnemyTiles(world: World, nationId: string, profile: ReturnType<typeof buildNationPolicyProfile>): Tile[] {
  const adjacency = buildProvinceAdjacency(world);
  const nationProvinceIds = new Set(world.provinces.filter(p => p.nationId === nationId).map(p => p.id));
  const enemyTiles: Tile[] = [];
  for (const provinceId of nationProvinceIds) {
    for (const neighborId of adjacency.get(provinceId) ?? []) {
      const neighbor = world.provinceById.get(neighborId);
      if (neighbor && neighbor.nationId !== undefined && neighbor.nationId !== nationId) {
        const tile = world.tiles.find(t => t.provinceId === neighborId);
        if (tile && !enemyTiles.find(t => t.provinceId === neighborId)) {
          enemyTiles.push(tile);
        }
      }
    }
  }
  return enemyTiles;
}

export function calculatePeacefulExpandCost(tile: Tile, world: World, stableDiscount = false, eraDiscount = 1): { gold: number; population: number; tribute: number; type: "neutral" | "province" } {
  const province = world.provinces.find(p => p.id === tile.provinceId);
  const cityCount = world.cities.filter(c => c.provinceId === tile.provinceId).length;
  // Fuente única de población: las ciudades (Province no tiene campo population).
  const tilePopulation = world.cities
    .filter((c) => c.provinceId === tile.provinceId)
    .reduce((sum, c) => sum + c.population, 0);
  const isNeutral = !province || province.nationId === undefined;

  if (isNeutral) {
    // Colonizar neutral cuesta 1 oro fijo (0.5 con establo adyacente),
    // sin reembolso posterior (sin exploit). Descuento de era acumulativo.
    const base = stableDiscount ? 0.5 : 1;
    return { gold: Math.round(base * eraDiscount * 100) / 100, population: 0, tribute: 0, type: "neutral" };
  }

  // Provincias con dueño NO se pueden tomar pacíficamente (requieren guerra).
  // Se devuelve coste impagable para bloquear la vía pacífica hacia enemigos.
  const populationTribute = Math.round(tilePopulation * 0.05 * 100) / 100;
  const cityTribute = cityCount * 30;

  return { gold: Number.POSITIVE_INFINITY, population: tilePopulation, tribute: populationTribute + cityTribute, type: "province" };
}

export function canAffordPeacefulExpand(cost: {gold: number; population: number; tribute: number; type: string}, stockpile: {gold: number; resources: Record<string, number>}): boolean {
  return stockpile.gold >= cost.gold;
}

/** Cupo de anexiones por turno: 2 base, 3 con 1 establo vecino, 4 con ≥2. */
export function maxExpandsFor(stableNeighbors: number): number {
  if (stableNeighbors >= 2) return 4;
  if (stableNeighbors >= 1) return 3;
  return 2;
}

/** Costo escalado n-ésima anexión del turno: base × (1 + 0.25×(n-1)). */
export function peacefulExpandCostFor(nth: number, stableDiscount = false, eraDiscount = 1): number {
  const base = stableDiscount ? 0.5 : 1;
  const scaled = base * (1 + 0.25 * (Math.max(1, nth) - 1));
  return Math.round(scaled * eraDiscount * 100) / 100;
}

/** Intención de construcción que la IA/LLM puede decidir (fase 1). */
export type ConstructionIntent = "pueblo" | "ciudad" | "reino" | "auto";
