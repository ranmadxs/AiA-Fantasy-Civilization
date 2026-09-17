import { calculateNationCityEconomy } from "./cityEconomy";
import { calculateProvinceMilitaryLimit, getAvailableArmySize, hasCitiesForArmy } from "./provinceLimits";
import { at } from "./rngService";
import type { DiplomacyState, WarState } from "./diplomacy";
import type { GameEvent } from "./events";
import { isNationActive, isNationDefeated } from "./nationStatus";
import type { NationPolicies } from "./policyAI";
import {
  adjustNationRelation,
  getNationRelation,
  relationKey,
  type NationRelations,
} from "./relationships";
import type { NationStockpiles } from "./settlement";
import type { Province, Resource, Terrain, Tile, World } from "./types";
import type { SpyNetwork } from "./spies";

export type UnitType = "militia" | "infantry" | "lightCavalry" | "heavyCavalry" | "levy";

export type UnitStats = {
  label: string;
  hp: number;
  attack: number;
  defense: number;
  speed: number;
  upkeepGold: number;
  recruitGold: number;
};

export type ArmyUnits = Record<UnitType, number>;

export type ArmyStance = "attack" | "defend" | "garrison" | "rally" | "raid" | "retreat";

export type RecruitmentOrder = {
  id: string;
  nationId: string;
  cityId: string;
  unitType: UnitType;
  amount: number;
  startedAtMonth: number;
  completesAtMonth: number;
};

export type ArmyGroup = {
  id: string;
  nationId: string;
  locationProvinceId: string;
  destinationProvinceId?: string;
  objectiveProvinceId?: string;
  pathProvinceIds: string[];
  movementProgress: number;
  units: ArmyUnits;
  stance: ArmyStance;
  originCityId?: string;
  createdAtMonth: number;
  updatedAtMonth: number;
};

export type NationMilitary = {
  nationId: string;
  units: ArmyUnits;
  cityGarrisons: Record<string, ArmyUnits>;
  armyGroups: ArmyGroup[];
  recruitmentQueue: RecruitmentOrder[];
  morale: number;
  lastDisbandMonth?: number;
  lastUpkeepShortageMonth?: number;
  lastArmyCommandMonth?: number;
};

export type MilitaryState = Record<string, NationMilitary>;

export type WarUpdate = {
  stockpiles: NationStockpiles;
  diplomacy: DiplomacyState;
  events: GameEvent[];
  mapChanged: boolean;
  military: MilitaryState;
  relations: NationRelations;
};

export type MilitaryEconomyUpdate = {
  events: GameEvent[];
  military: MilitaryState;
  stockpiles: NationStockpiles;
};

export type MilitaryMovementUpdate = {
  events: GameEvent[];
  mapChanged: boolean;
  military: MilitaryState;
};

export type CityGarrisonSummary = {
  cityId: string;
  cityName: string;
  provinceName: string;
  totalSoldiers: number;
  units: ArmyUnits;
};

export type NationWarSummary = {
  activeWars: Array<WarState & { enemyNationId: string }>;
  army: NationMilitary;
  armyGroups: ArmyGroup[];
  cityGarrisons: CityGarrisonSummary[];
  recruitmentQueue: RecruitmentOrder[];
  totalSoldiers: number;
  monthlyUpkeep: number;
  attackPower: number;
  defensePower: number;
};

export const unitTypes: UnitType[] = ["militia", "infantry", "lightCavalry", "heavyCavalry", "levy"];

export const unitStats: Record<UnitType, UnitStats> = {
  militia: {
    attack: 4,
    defense: 3,
    hp: 60,
    label: "Militia",
    recruitGold: 0.8,
    speed: 1,
    upkeepGold: 0.001,
  },
  infantry: {
    attack: 7,
    defense: 7,
    hp: 100,
    label: "Infantry",
    recruitGold: 2,
    speed: 1,
    upkeepGold: 0.0314,
  },
  lightCavalry: {
    attack: 8,
    defense: 5,
    hp: 80,
    label: "Light Cavalry",
    recruitGold: 3.5,
    speed: 3,
    upkeepGold: 0.0471,
  },
  heavyCavalry: {
    attack: 12,
    defense: 10,
    hp: 140,
    label: "Heavy Cavalry",
    recruitGold: 6,
    speed: 2,
    upkeepGold: 0.07065,
  },
  levy: {
    attack: 2,
    defense: 2,
    hp: 30,
    label: "Levy",
    recruitGold: 0.015,
    speed: 1,
    upkeepGold: 0.0005,
  },
};

const unitRecruitResourceCosts: Record<UnitType, Partial<Record<Resource, number>>> = {
  heavyCavalry: { grain: 1.8, iron: 0.8, coal: 0.25 },
  infantry: { grain: 1.1, iron: 0.45, timber: 0.15 },
  lightCavalry: { grain: 1.6, iron: 0.25, timber: 0.45 },
  militia: { grain: 0.75, timber: 0.1 },
  levy: { grain: 0.2 },
};

const unitMonthlyResourceUpkeep: Record<UnitType, Partial<Record<Resource, number>>> = {
  heavyCavalry: { coal: 0.018, grain: 0.16, iron: 0.035 },
  infantry: { grain: 0.051, timber: 0.027, iron: 0.05225, coal: 0.2 },
  lightCavalry: { grain: 0.13, timber: 0.018 },
  militia: { grain: 0.055 },
  levy: { grain: 0.02 },
};

const truceAfterWarMonths = 60;
const armyCommandIntervalMonths = 1;

export function buildInitialMilitaryState(world: World): MilitaryState {
  return Object.fromEntries(
    world.nations.map((nation) => {
      const cities = world.cities.filter((city) => city.nationId === nation.id);
      const units = buildInitialUnits(calculateNationCityEconomy(nation.id, world).army);
      const cityGarrisons = distributeUnitsToCities(units, cities);
      const finalUnits = Object.values(cityGarrisons).reduce(
        (sum, g) => {
          const next = { ...sum };
          for (const type of unitTypes) { next[type] += g[type]; }
          return next;
        },
        emptyUnits(),
      );

      return [
        nation.id,
        {
          armyGroups: [],
          cityGarrisons,
          morale: 0.92,
          nationId: nation.id,
          recruitmentQueue: [],
          units: finalUnits,
        },
      ];
    }),
  );
}

export function advanceMilitaryEconomy(
  world: World,
  currentMilitary: MilitaryState,
  currentStockpiles: NationStockpiles,
  policies: NationPolicies,
  diplomacy: DiplomacyState,
  currentMonth: number,
  months: number,
): MilitaryEconomyUpdate {
  const events: GameEvent[] = [];
  const nextMilitary = cloneMilitary(currentMilitary);
   const nextStockpiles: NationStockpiles = Object.fromEntries(
    Object.entries(currentStockpiles).map(([nationId, stockpile]) => [
      nationId,
      { gold: stockpile.gold, water: stockpile.water, resources: { ...stockpile.resources } },
    ]),
  );

  for (const nation of world.nations) {
    if (!isNationActive(world, nation.id)) {
      clearNationMilitary(nextMilitary, nation.id);
      nextStockpiles[nation.id] = { gold: 0, water: 0, resources: {} };
      continue;
    }

    let army = nextMilitary[nation.id] ?? {
      armyGroups: [],
      cityGarrisons: {},
      morale: 0.8,
      nationId: nation.id,
      recruitmentQueue: [],
      units: emptyUnits(),
    };
    army = completeRecruitment(world, army, currentMonth, events);
    const stockpile = nextStockpiles[nation.id] ?? { gold: 0, resources: {} };

    const atWar = diplomacy.wars.some(
      (war) => war.attackerNationId === nation.id || war.defenderNationId === nation.id,
    );
    const warLogisticsMultiplier = atWar ? 1.5 : 1;

    const upkeep = calculateMonthlyUpkeep(army.units, nation.id, world) * months * warLogisticsMultiplier;

    if (upkeep <= stockpile.gold) {
      stockpile.gold -= upkeep;
      army.morale = clamp(army.morale + 0.018 * months, 0.35, 1);
    } else {
      stockpile.gold = 0;
      army.morale = clamp(army.morale - 0.055 * months, 0.28, 1);
      if (
        army.lastUpkeepShortageMonth === undefined ||
        currentMonth - army.lastUpkeepShortageMonth >= 6
      ) {
        army.lastUpkeepShortageMonth = currentMonth;
        events.push({
          description: `${nation.name} could not fully pay military upkeep; army morale fell to ${Math.round(army.morale * 100)}%.`,
          id: `event-military-shortage-${nation.id}-${currentMonth}`,
          kind: "military_upkeep_shortage",
          month: currentMonth,
          nationIds: [nation.id],
          title: "Military Upkeep Shortage",
        });
      }
    }

    const supply = payMilitarySupplies(army.units, stockpile, months);
    if (!supply.paid) {
      army.morale = clamp(army.morale - 0.035 * months, 0.25, 1);
      if (
        army.lastUpkeepShortageMonth === undefined ||
        currentMonth - army.lastUpkeepShortageMonth >= 6
      ) {
        army.lastUpkeepShortageMonth = currentMonth;
        events.push({
          description: `${nation.name} lacked military supplies; army morale fell to ${Math.round(army.morale * 100)}%.`,
          id: `event-military-supply-shortage-${nation.id}-${currentMonth}`,
          kind: "military_supply_shortage",
          month: currentMonth,
          nationIds: [nation.id],
          title: "Military Supply Shortage",
        });
      }
    }

    army = disbandExcessMilitary(world, diplomacy, army, stockpile, policies[nation.id], currentMonth, events);
    const recruited = queueRecruitmentForPolicy(world, army, stockpile, policies[nation.id], nation.id, currentMonth);
    const development = investSurplusInCities(
      world,
      recruited.stockpile,
      policies[nation.id],
      nation.id,
      currentMonth,
      events,
    );
    nextMilitary[nation.id] = recruited.army;
    nextStockpiles[nation.id] = development.stockpile;
  }

  return {
    events,
    military: nextMilitary,
    stockpiles: nextStockpiles,
  };
}

export function advanceArmyGroups(
  world: World,
  diplomacy: DiplomacyState,
  currentMilitary: MilitaryState,
  currentMonth: number,
  stockpiles?: NationStockpiles,
): MilitaryMovementUpdate {
  const events: GameEvent[] = [];
  let mapChanged = false;
  const nextMilitary = cloneMilitary(currentMilitary);

  for (const nation of world.nations) {
    if (!isNationActive(world, nation.id)) {
      clearNationMilitary(nextMilitary, nation.id);
      continue;
    }

    let army = nextMilitary[nation.id] ?? {
      armyGroups: [],
      cityGarrisons: {},
      morale: 0.8,
      nationId: nation.id,
      recruitmentQueue: [],
      units: emptyUnits(),
    };

    if (
      army.lastArmyCommandMonth === undefined ||
      currentMonth - army.lastArmyCommandMonth >= armyCommandIntervalMonths
    ) {
      const commandResult = issueArmyCommands(world, diplomacy, army, currentMonth, stockpiles);
      army = commandResult.army;
      army.lastArmyCommandMonth = currentMonth;
      events.push(...commandResult.events);
      mapChanged ||= commandResult.mapChanged;
    }

    const movement = moveArmyGroups(world, army, currentMonth);
    army = movement.army;
    events.push(...movement.events);
    mapChanged ||= movement.mapChanged;
    nextMilitary[nation.id] = recalculateNationUnits(army);
  }

  return {
    events,
    mapChanged,
    military: nextMilitary,
  };
}

export function advanceWarSystem(
  world: World,
  diplomacy: DiplomacyState,
  currentMilitary: MilitaryState,
  currentRelations: NationRelations,
  spyNetwork: SpyNetwork,
  currentStockpiles: NationStockpiles,
  currentMonth: number,
): WarUpdate {
  const events: GameEvent[] = [];
  const nextMilitary = cloneMilitary(currentMilitary);
  let relations = currentRelations;
  let mapChanged = false;
  const nextWars: WarState[] = [];
  const stockpiles = currentStockpiles;

  for (const war of diplomacy.wars) {
    const attacker = world.nationById.get(war.attackerNationId);
    const defender = world.nationById.get(war.defenderNationId);

    if (!attacker || !defender) {
      events.push(buildWarEvent({
        currentMonth,
        description: `${nationName(world, war.attackerNationId)} and ${nationName(world, war.defenderNationId)} ended their war because one side no longer controls territory.`,
        id: `event-war-ended-invalid-${war.id}-${currentMonth}`,
        kind: "war_ended",
        nationIds: [war.attackerNationId, war.defenderNationId],
        title: "War Ended",
      }));
      continue;
    }
    if (!isNationActive(world, attacker.id) || !isNationActive(world, defender.id)) {
      if (!isNationActive(world, attacker.id) && isNationActive(world, defender.id)) {
        const annexation = annexDefeatedNation(world, nextMilitary, attacker.id, defender.id, currentMonth);
        events.push(...annexation.events);
        mapChanged ||= annexation.mapChanged;
        events.push(buildWarEvent({
          currentMonth,
          description: `${attacker.name} lost its cities and population and was defeated by ${defender.name}.`,
          id: `event-nation-defeated-${attacker.id}-${currentMonth}`,
          kind: "nation_defeated",
          nationIds: [defender.id, attacker.id],
          title: "Nation Defeated",
        }));
      } else if (!isNationActive(world, defender.id) && isNationActive(world, attacker.id)) {
        const annexation = annexDefeatedNation(world, nextMilitary, defender.id, attacker.id, currentMonth);
        events.push(...annexation.events);
        mapChanged ||= annexation.mapChanged;
        events.push(buildWarEvent({
          currentMonth,
          description: `${defender.name} lost its cities and population and was defeated by ${attacker.name}.`,
          id: `event-nation-defeated-${defender.id}-${currentMonth}`,
          kind: "nation_defeated",
          nationIds: [attacker.id, defender.id],
          title: "Nation Defeated",
        }));
      }
      events.push(buildWarEvent({
        currentMonth,
        description: `${nationName(world, war.attackerNationId)} and ${nationName(world, war.defenderNationId)} ended their war because one side no longer controls territory.`,
        id: `event-war-ended-invalid-${war.id}-${currentMonth}`,
        kind: "war_ended",
        nationIds: [war.attackerNationId, war.defenderNationId],
        title: "War Ended",
      }));
      continue;
    }

    let updatedWar = { ...war };
    if (updatedWar.relationPenaltyAppliedMonth === undefined) {
      relations = worsenRelationToAtMost(relations, attacker.id, defender.id, -35, currentMonth);
      updatedWar.relationPenaltyAppliedMonth = currentMonth;
    }

    const engagements = findWarEngagements(world, nextMilitary, updatedWar);
    if (engagements.length === 0) {
      if (
        !hasWarFront(world, updatedWar.attackerNationId, updatedWar.defenderNationId) ||
        !hasReachableWarObjective(world, nextMilitary, updatedWar, diplomacy)
      ) {
        if (defenderContinuesWar(world, diplomacy, nextMilitary, relations, updatedWar)) {
          const flipped = flipWarAttacker(updatedWar);
          events.push(buildWarEvent({
            currentMonth,
            description: `${defender.name} refuses the truce and takes the offensive against ${attacker.name}. ${warDeclineReport(world, nextMilitary, diplomacy, updatedWar, "no-front", currentMonth)}`,
            id: `event-war-continued-${updatedWar.id}-${currentMonth}`,
            kind: "war_continued",
            nationIds: [flipped.attackerNationId, flipped.defenderNationId],
            title: "War Continued",
          }));
          relations = adjustNationRelation(relations, attacker.id, defender.id, -2, currentMonth);
          nextWars.push(flipped);
        } else {
          events.push(buildWarEvent({
            currentMonth,
            description: `${attacker.name} and ${defender.name} signed a truce: no viable front. ${warDeclineReport(world, nextMilitary, diplomacy, updatedWar, "no-front", currentMonth)}`,
            id: `event-war-ended-no-front-${updatedWar.id}-${currentMonth}`,
            kind: "war_ended",
            nationIds: [attacker.id, defender.id],
            title: "War Ended",
          }));
          relations = adjustNationRelation(relations, attacker.id, defender.id, -4, currentMonth);
        }
        continue;
      }
      nextWars.push(updatedWar);
      continue;
    }

    let endedWar = false;

    for (const engagement of engagements) {
      const targetProvince = world.provinceById.get(engagement.provinceId);
      if (!targetProvince) {
        continue;
      }

      const battle = resolveBattle({
        attackerNationId: attacker.id,
        attackerGroupIds: engagement.attackerGroupIds,
        currentMonth,
        defenderNationId: defender.id,
        defenderGroupIds: engagement.defenderGroupIds,
        spyNetwork,
        targetProvince,
        war: updatedWar,
        world,
        military: nextMilitary,
      });
      nextMilitary[attacker.id] = battle.attackerArmy;
      nextMilitary[defender.id] = battle.defenderArmy;
      events.push(battle.event);
      relations = adjustNationRelation(relations, attacker.id, defender.id, -2, currentMonth);

      let attackerScore = (updatedWar.attackerScore ?? 0) + (battle.attackerWon ? 1 : -0.5);
      let defenderScore = (updatedWar.defenderScore ?? 0) + (battle.attackerWon ? -0.5 : 1);

      if (battle.attackerWon && targetProvince.nationId === defender.id) {
        const transfer = transferProvince(world, targetProvince.id, attacker.id, defender.id, currentMonth);
        removeCapturedCityGarrisons(nextMilitary, transfer.capturedCities, defender.id);
        mapChanged = true;
        relations = adjustNationRelation(
          relations,
          attacker.id,
          defender.id,
          -8 - transfer.capturedCities.length * 4,
          currentMonth,
        );
        events.push(...transfer.events);
        attackerScore += transfer.capturedCities.length > 0 ? 1 : 0;

        if (isNationDefeated(world, defender.id)) {
          const annexation = annexDefeatedNation(world, nextMilitary, defender.id, attacker.id, currentMonth);
          events.push(...annexation.events);
          mapChanged ||= annexation.mapChanged;
          events.push(buildWarEvent({
            currentMonth,
            description: `${defender.name} lost its cities and population and was defeated by ${attacker.name}.`,
            id: `event-nation-defeated-${defender.id}-${currentMonth}`,
            kind: "nation_defeated",
            nationIds: [attacker.id, defender.id],
            title: "Nation Defeated",
          }));
          endedWar = true;
          break;
        }
      }

      if (!battle.attackerWon && targetProvince.nationId === attacker.id && engagement.defenderGroupIds.length > 0) {
        const transfer = transferProvince(world, targetProvince.id, defender.id, attacker.id, currentMonth);
        removeCapturedCityGarrisons(nextMilitary, transfer.capturedCities, attacker.id);
        mapChanged = true;
        relations = adjustNationRelation(
          relations,
          attacker.id,
          defender.id,
          -8 - transfer.capturedCities.length * 4,
          currentMonth,
        );
        events.push(...transfer.events);
        defenderScore += transfer.capturedCities.length > 0 ? 1 : 0;

        if (isNationDefeated(world, attacker.id)) {
          const annexation = annexDefeatedNation(world, nextMilitary, attacker.id, defender.id, currentMonth);
          events.push(...annexation.events);
          mapChanged ||= annexation.mapChanged;
          events.push(buildWarEvent({
            currentMonth,
            description: `${attacker.name} lost its cities and population and was defeated by ${defender.name}.`,
            id: `event-nation-defeated-${attacker.id}-${currentMonth}`,
            kind: "nation_defeated",
            nationIds: [defender.id, attacker.id],
            title: "Nation Defeated",
          }));
          endedWar = true;
          break;
        }
      }

      updatedWar = {
        ...updatedWar,
        attackerScore,
        battleCount: (updatedWar.battleCount ?? 0) + 1,
        defenderScore,
        lastBattleMonth: currentMonth,
        targetProvinceId: targetProvince.id,
      };

      if (shouldEndWar(updatedWar, nextMilitary[attacker.id], nextMilitary[defender.id])) {
        if (defenderContinuesWar(world, diplomacy, nextMilitary, relations, updatedWar)) {
          const flipped = flipWarAttacker(updatedWar);
          events.push(buildWarEvent({
            currentMonth,
            description: `${defender.name} refuses the truce and takes the offensive against ${attacker.name}. ${warDeclineReport(world, nextMilitary, diplomacy, updatedWar, "decisive", currentMonth)}`,
            id: `event-war-continued-${updatedWar.id}-${currentMonth}`,
            kind: "war_continued",
            nationIds: [flipped.attackerNationId, flipped.defenderNationId],
            title: "War Continued",
          }));
          relations = adjustNationRelation(relations, attacker.id, defender.id, -2, currentMonth);
          nextWars.push(flipped);
        } else {
          events.push(buildWarEvent({
            currentMonth,
            description: `${attacker.name} and ${defender.name} agreed to an ${truceAfterWarMonths}-month truce after sustained fighting. ${warDeclineReport(world, nextMilitary, diplomacy, updatedWar, "decisive", currentMonth)}`,
            id: `event-war-ended-${updatedWar.id}-${currentMonth}`,
            kind: "war_ended",
            nationIds: [attacker.id, defender.id],
            title: "War Ended",
          }));
          relations = adjustNationRelation(relations, attacker.id, defender.id, -4, currentMonth);
        }
        endedWar = true;
        break;
      }
    }

    if (endedWar) {
      continue;
    }

    // End wars stuck for over 180 months without battle
    if ((currentMonth - (updatedWar.lastBattleMonth ?? updatedWar.startedAtMonth)) > 180) {
      if (defenderContinuesWar(world, diplomacy, nextMilitary, relations, updatedWar)) {
        const flipped = flipWarAttacker(updatedWar);
        events.push(buildWarEvent({
          currentMonth,
          description: `${defender.name} refuses the truce and takes the offensive against ${attacker.name}. ${warDeclineReport(world, nextMilitary, diplomacy, updatedWar, "stuck", currentMonth)}`,
          id: `event-war-continued-${updatedWar.id}-${currentMonth}`,
          kind: "war_continued",
          nationIds: [flipped.attackerNationId, flipped.defenderNationId],
          title: "War Continued",
        }));
        relations = adjustNationRelation(relations, attacker.id, defender.id, -2, currentMonth);
        nextWars.push(flipped);
        continue;
      }
      events.push(buildWarEvent({
        currentMonth,
        description: `${attacker.name} and ${defender.name} ended their war after being stuck without contact for over 180 months. ${warDeclineReport(world, nextMilitary, diplomacy, updatedWar, "stuck", currentMonth)}`,
        id: `event-war-ended-stuck-${updatedWar.id}-${currentMonth}`,
        kind: "war_ended",
        nationIds: [attacker.id, defender.id],
        title: "War Ended",
      }));
      continue;
    }

    nextWars.push(updatedWar);
  }

  return {
    diplomacy: {
      ...diplomacy,
      truces: [
        ...diplomacy.truces.filter((truce) => truce.expiresAtMonth > currentMonth),
        ...buildTrucesForEndedEvents(events, currentMonth),
      ],
      wars: dedupeWars(nextWars).filter((war) =>
        isNationActive(world, war.attackerNationId) && isNationActive(world, war.defenderNationId),
      ),
    },
    events,
    mapChanged,
    military: nextMilitary,
    relations,
    stockpiles,
  };
}

function findWarEngagements(
  world: World,
  military: MilitaryState,
  war: WarState,
) {
  const attackerArmy = military[war.attackerNationId];
  const defenderArmy = military[war.defenderNationId];
  if (!attackerArmy || !defenderArmy) {
    return [];
  }

  const provinceIds = new Set<string>();
  for (const group of attackerArmy.armyGroups) {
    provinceIds.add(group.locationProvinceId);
  }
  for (const group of defenderArmy.armyGroups) {
    provinceIds.add(group.locationProvinceId);
  }

  return [...provinceIds]
    .map((provinceId) => {
      const province = world.provinceById.get(provinceId);
      const attackerGroupIds = attackerArmy.armyGroups
        .filter((group) => group.locationProvinceId === provinceId && totalUnits(group.units) > 0)
        .map((group) => group.id);
      const defenderGroupIds = defenderArmy.armyGroups
        .filter((group) => group.locationProvinceId === provinceId && totalUnits(group.units) > 0)
        .map((group) => group.id);
      const attackerInvading = attackerGroupIds.length > 0 && province?.nationId === war.defenderNationId;
      const defenderCounterInvading = defenderGroupIds.length > 0 && province?.nationId === war.attackerNationId;
      const directContact = attackerGroupIds.length > 0 && defenderGroupIds.length > 0;

      if (!directContact && !attackerInvading && !defenderCounterInvading) {
        return undefined;
      }

      return {
        attackerGroupIds,
        defenderGroupIds,
        provinceId,
      };
    })
    .filter((engagement): engagement is {
      attackerGroupIds: string[];
      defenderGroupIds: string[];
      provinceId: string;
    } => Boolean(engagement))
    .sort((a, b) => scoreTargetProvince(world, world.provinceById.get(b.provinceId)!) -
      scoreTargetProvince(world, world.provinceById.get(a.provinceId)!));
}

function hasWarFront(world: World, attackerNationId: string, defenderNationId: string) {
  return Boolean(pickTargetProvince(world, attackerNationId, defenderNationId)) ||
    Boolean(pickTargetProvince(world, defenderNationId, attackerNationId));
}

function hasReachableWarObjective(world: World, military: MilitaryState, war: WarState, diplomacy: DiplomacyState) {
  return canReachWarTarget(world, military[war.attackerNationId], war.defenderNationId, diplomacy) ||
    canReachWarTarget(world, military[war.defenderNationId], war.attackerNationId, diplomacy);
}

function canReachWarTarget(
  world: World,
  army: NationMilitary | undefined,
  enemyNationId: string,
  diplomacy?: DiplomacyState,
) {
  if (!army) {
    return false;
  }

  const target = pickTargetProvince(world, army.nationId, enemyNationId);
  if (!target) {
    return false;
  }

  const origins = [
    ...army.armyGroups.map((group) => group.locationProvinceId),
    ...world.cities
      .filter((city) => city.nationId === army.nationId)
      .map((city) => city.provinceId),
  ];

  return origins.some((originProvinceId) => {
    const path = findProvincePath(world, army.nationId, originProvinceId, target.id, diplomacy);
    return path.length > 1 || originProvinceId === target.id;
  });
}

export function getNationWarSummary(
  diplomacy: DiplomacyState,
  military: MilitaryState,
  world: World,
  nationId: string,
): NationWarSummary {
  const army = military[nationId] ?? {
    armyGroups: [],
    cityGarrisons: {},
    morale: 0,
    nationId,
    recruitmentQueue: [],
    units: emptyUnits(),
  };
  const activeWars = diplomacy.wars
    .filter((war) => war.attackerNationId === nationId || war.defenderNationId === nationId)
    .map((war) => ({
      ...war,
      enemyNationId: war.attackerNationId === nationId ? war.defenderNationId : war.attackerNationId,
    }));

  return {
    activeWars,
    army,
    armyGroups: [...army.armyGroups].sort((a, b) => totalUnits(b.units) - totalUnits(a.units)),
    attackPower: Math.round(calculateArmyAttackPower(army) * army.morale),
    cityGarrisons: getCityGarrisonSummaries(world, army),
    defensePower: Math.round(calculateArmyDefensePower(army) * army.morale),
    monthlyUpkeep: calculateMonthlyUpkeep(army.units, army.nationId, world),
    recruitmentQueue: [...army.recruitmentQueue].sort((a, b) => a.completesAtMonth - b.completesAtMonth),
    totalSoldiers: totalUnits(army.units),
  };
}

export function getAllArmyGroups(military: MilitaryState) {
  return Object.values(military).flatMap((army) => army.armyGroups);
}

export function calculateMilitaryPower(military: MilitaryState, nationId: string) {
  const army = military[nationId];
  if (!army) {
    return 0;
  }

  return (calculateArmyAttackPower(army) + calculateArmyDefensePower(army)) * army.morale;
}

function buildInitialUnits(armyScore: number): ArmyUnits {
  const soldiers = Math.max(90, Math.round(armyScore / 28));

  return distributeRound(
    {
      heavyCavalry: soldiers * 0.07,
      infantry: soldiers * 0.43,
      lightCavalry: soldiers * 0.12,
      militia: soldiers * 0.38,
      levy: 0,
    },
    soldiers,
  );
}

function distributeRound(raw: ArmyUnits, total: number): ArmyUnits {
  const result: ArmyUnits = {
    heavyCavalry: Math.floor(raw.heavyCavalry),
    infantry: Math.floor(raw.infantry),
    lightCavalry: Math.floor(raw.lightCavalry),
    militia: Math.floor(raw.militia),
    levy: Math.floor(raw.levy),
  };
  let remainder = total - totalUnits(result);
  const types: UnitType[] = [...unitTypes];
  const indexed = types.map((t) => ({ type: t, frac: raw[t] - Math.floor(raw[t]) }))
    .sort((a, b) => b.frac - a.frac);
  for (let i = 0; i < remainder && i < indexed.length; i += 1) {
    result[indexed[i].type] += 1;
  }
  return result;
}

function queueRecruitmentForPolicy(
  world: World,
  army: NationMilitary,
  stockpile: NationStockpiles[string],
  policy: NationPolicies[string] | undefined,
  nationId: string,
  currentMonth: number,
) {
  const currentTotal = totalUnits(army.units);
  const desiredTotal = calculateDesiredArmySize(world, nationId, policy);

  const queuedTotal = army.recruitmentQueue.reduce((sum, order) => sum + order.amount, 0);

  if (
    currentTotal + queuedTotal >= desiredTotal ||
    stockpile.gold < Math.max(30, calculateMonthlyUpkeep(army.units, army.nationId, world) * 1.25)
  ) {
    return { army, stockpile };
  }

  const cities = world.cities
    .filter((city) => city.nationId === nationId)
    .sort((a, b) => Number(b.isCapital) - Number(a.isCapital) || b.level - a.level);
  const recruitNeed = desiredTotal - currentTotal - queuedTotal;
  if (recruitNeed <= 0 || cities.length === 0) {
    return { army, stockpile };
  }

  const weights: ArmyUnits = policy?.economy.policy === "army_building"
    ? { heavyCavalry: 0.1, infantry: 0.48, lightCavalry: 0.16, militia: 0.26, levy: 0 }
    : { heavyCavalry: 0.04, infantry: 0.4, lightCavalry: 0.1, militia: 0.46, levy: 0 };
  const nextArmy: NationMilitary = cloneArmy(army);
  let remainingGold = stockpile.gold;
  let remainingNeed = Math.min(recruitNeed, Math.ceil(desiredTotal * 0.035));

  for (const city of cities) {
    if (remainingNeed <= 0) {
      break;
    }
    const existingCityOrders = nextArmy.recruitmentQueue.filter((order) => order.cityId === city.id).length;
    if (existingCityOrders >= 2) {
      continue;
    }

    const unitType = chooseRecruitmentUnitType(weights, world.seed, city.id, currentMonth + existingCityOrders);
    const amount = Math.min(remainingNeed, cityRecruitmentCapacity(city));
    const cost = amount * unitStats[unitType].recruitGold;
    const resourceCost = multiplyResourceCosts(unitRecruitResourceCosts[unitType], amount);
    if (amount <= 0 || cost > remainingGold || !hasResources(stockpile.resources, resourceCost)) {
      continue;
    }

    remainingGold -= cost;
    spendResources(stockpile.resources, resourceCost);
    remainingNeed -= amount;
    nextArmy.recruitmentQueue.push({
      amount,
      cityId: city.id,
      completesAtMonth: currentMonth + recruitmentTimeMonths(unitType, city.isCapital),
      id: `recruit-${nationId}-${city.id}-${unitType}-${currentMonth}-${nextArmy.recruitmentQueue.length}`,
      nationId,
      startedAtMonth: currentMonth,
      unitType,
    });
  }

  return {
    army: nextArmy,
    stockpile: {
      ...stockpile,
      gold: remainingGold,
    },
  };
}

function disbandExcessMilitary(
  world: World,
  diplomacy: DiplomacyState,
  army: NationMilitary,
  stockpile: NationStockpiles[string],
  policy: NationPolicies[string] | undefined,
  currentMonth: number,
  events: GameEvent[],
) {
  if (isNationAtWar(diplomacy, army.nationId) || totalUnits(army.units) <= 0) {
    return army;
  }

  if (army.lastDisbandMonth !== undefined && currentMonth - army.lastDisbandMonth < 12) {
    return army;
  }

  const currentTotal = totalUnits(army.units);
  const desiredTotal = calculateDesiredArmySize(world, army.nationId, policy);
  const monthlyUpkeep = calculateMonthlyUpkeep(army.units, army.nationId, world);
  const queuedTotal = army.recruitmentQueue.reduce((sum, order) => sum + order.amount, 0);
  const overbuilt = currentTotal + queuedTotal > desiredTotal * 1.32;
  const expensiveArmy = monthlyUpkeep > 0 && stockpile.gold < monthlyUpkeep * 2.5;
  const recoveryCut = policy?.economy.policy === "recovery" && currentTotal > desiredTotal * 1.12;

  if (!overbuilt && !expensiveArmy && !recoveryCut) {
    return army;
  }

  const pressureMultiplier = expensiveArmy ? 0.12 : 0.075;
  const targetTotal = Math.max(60, Math.round(desiredTotal * (expensiveArmy ? 1.02 : 1.12)));
  const excess = Math.max(0, currentTotal - targetTotal);
  const disbandAmount = Math.max(
    4,
    Math.min(excess, Math.ceil(currentTotal * pressureMultiplier)),
  );

  if (disbandAmount <= 0 || excess <= 0) {
    return army;
  }

  const typeOrder: UnitType[] = expensiveArmy
    ? ["levy", "heavyCavalry", "lightCavalry", "infantry", "militia"]
    : ["levy", "militia", "infantry", "lightCavalry", "heavyCavalry"];
  const result = disbandUnits(army, disbandAmount, typeOrder);
  const removedTotal = totalUnits(result.removed);

  if (removedTotal <= 0) {
    return army;
  }

  result.army.lastDisbandMonth = currentMonth;
  result.army.morale = clamp(result.army.morale - 0.018, 0.25, 1);
  events.push(buildWarEvent({
    currentMonth,
    description: `${nationName(world, army.nationId)} disbanded ${removedTotal} soldiers to reduce military expenses.`,
    id: `event-military-disbanded-${army.nationId}-${currentMonth}`,
    kind: "military_disbanded",
    nationIds: [army.nationId],
    title: "Military Disbanded",
  }));

  return result.army;
}

function calculateDesiredArmySize(
  world: World,
  nationId: string,
  policy: NationPolicies[string] | undefined,
) {
  const cityEconomy = calculateNationCityEconomy(nationId, world);
  const desiredMultiplier = policy?.economy.policy === "army_building"
    ? 1.15
    : policy?.economy.policy === "recovery"
      ? 0.82
      : 0.96;

  return Math.max(80, Math.round(cityEconomy.army / 28 * desiredMultiplier));
}

function isNationAtWar(diplomacy: DiplomacyState, nationId: string) {
  return diplomacy.wars.some((war) => war.attackerNationId === nationId || war.defenderNationId === nationId);
}

function completeRecruitment(
  world: World,
  army: NationMilitary,
  currentMonth: number,
  events: GameEvent[],
) {
  const nextArmy = cloneArmy(army);
  const remainingOrders: RecruitmentOrder[] = [];

  for (const order of nextArmy.recruitmentQueue) {
    if (order.completesAtMonth > currentMonth) {
      remainingOrders.push(order);
      continue;
    }

    const city = world.cityById.get(order.cityId);
    const cityGarrison = nextArmy.cityGarrisons[order.cityId] ?? emptyUnits();
    cityGarrison[order.unitType] += order.amount;
    nextArmy.cityGarrisons[order.cityId] = cityGarrison;
    events.push(buildWarEvent({
      currentMonth,
      description: `${order.amount} ${unitStats[order.unitType].label.toLowerCase()} finished training in ${city?.name ?? order.cityId}.`,
      id: `event-recruitment-completed-${order.id}-${currentMonth}`,
      kind: "recruitment_completed",
      nationIds: [order.nationId],
      title: "Recruitment Completed",
    }));
  }

  nextArmy.recruitmentQueue = remainingOrders;
  return recalculateNationUnits(nextArmy);
}

function chooseRecruitmentUnitType(weights: ArmyUnits, seed: string, cityId: string, currentMonth: number) {
  const roll = at(seed, `recruit:${cityId}`, currentMonth);
  let threshold = 0;

  for (const type of unitTypes) {
    threshold += weights[type];
    if (roll <= threshold) {
      return type;
    }
  }

  return "militia";
}

function recruitmentTimeMonths(unitType: UnitType, isCapital: boolean) {
  const base = {
    heavyCavalry: 5,
    infantry: 3,
    lightCavalry: 4,
    militia: 2,
    levy: 1,
  } satisfies Record<UnitType, number>;

  return Math.max(1, base[unitType] - (isCapital ? 1 : 0));
}

function cityRecruitmentCapacity(city: { isCapital: boolean; level: number }) {
  return 8 + city.level * 6 + (city.isCapital ? 12 : 0);
}

function payMilitarySupplies(
  units: ArmyUnits,
  stockpile: NationStockpiles[string],
  months: number,
) {
  const required = emptyResourceCosts();
  for (const type of unitTypes) {
    for (const [resource, amount] of Object.entries(unitMonthlyResourceUpkeep[type])) {
      required[resource as Resource] += amount * units[type] * months;
    }
  }

  if (hasResources(stockpile.resources, required)) {
    spendResources(stockpile.resources, required);
    return { paid: true };
  }

  for (const resource of Object.keys(required) as Resource[]) {
    stockpile.resources[resource] = Math.max(0, (stockpile.resources[resource] ?? 0) - required[resource]);
  }
  return { paid: false };
}

function investSurplusInCities(
  world: World,
  stockpile: NationStockpiles[string],
  policy: NationPolicies[string] | undefined,
  nationId: string,
  currentMonth: number,
  events: GameEvent[],
) {
  const cities = world.cities
    .filter((city) => city.nationId === nationId)
    .sort((a, b) => a.level - b.level || a.population - b.population);
  if (cities.length === 0) {
    return { stockpile };
  }

  const income = calculateNationCityEconomy(nationId, world);
  const shouldDevelop =
    policy?.economy.policy === "construction" ||
    stockpile.gold > income.monthlyGold * 10 ||
    Object.values(stockpile.resources).some((amount) => amount > 5000);

  if (!shouldDevelop) {
    return { stockpile };
  }

  const city = cities[0];
  const levelCostGold = 650 + city.level * 420;
  const levelCost = {
    coal: 20 + city.level * 18,
    grain: 120 + city.level * 55,
    iron: 50 + city.level * 34,
    timber: 90 + city.level * 46,
  } satisfies Partial<Record<Resource, number>>;

  if (city.level < 5 && stockpile.gold >= levelCostGold && hasResources(stockpile.resources, levelCost)) {
    const provinceTiles = world.tiles.filter((t) => t.provinceId === city.provinceId).length;
    const maxPopulation = provinceTiles * 20000;
    const projectedPop = Math.round(city.population * 1.08);
    if (projectedPop <= maxPopulation) {
      stockpile.gold -= levelCostGold;
      spendResources(stockpile.resources, levelCost);
      city.level += 1;
      city.population = projectedPop;
      events.push(buildWarEvent({
        currentMonth,
        description: `${nationName(world, nationId)} invested surplus resources to develop ${city.name} to level ${city.level}.`,
        id: `event-city-developed-${city.id}-${currentMonth}`,
        kind: "city_developed",
        nationIds: [nationId],
        title: "City Developed",
      }));
    }
    return { stockpile };
  }

  const growthGold = Math.min(
    stockpile.gold * 0.16,
    Math.max(income.monthlyGold * 8, 1500),
  );
  const growthCost = {
    coal: Math.min(stockpile.resources.coal ?? 0, 90),
    grain: Math.min(stockpile.resources.grain ?? 0, 420),
    iron: Math.min(stockpile.resources.iron ?? 0, 140),
    timber: Math.min(stockpile.resources.timber ?? 0, 150),
  } satisfies Partial<Record<Resource, number>>;

  if (growthGold >= 100 && hasResources(stockpile.resources, growthCost)) {
    const provinceTiles = world.tiles.filter((t) => t.provinceId === city.provinceId).length;
    const maxPopulation = provinceTiles * 20000;
    const growthAmount = Math.round(Math.min(9000, Math.sqrt(growthGold) * 70 + (growthCost.grain ?? 0) * 3));
    const newPopulation = Math.min(city.population + growthAmount, maxPopulation);
    if (newPopulation > city.population) {
      stockpile.gold -= growthGold;
      spendResources(stockpile.resources, growthCost);
      city.population = newPopulation;
    }
    return { stockpile };
  }

  if (stockpile.gold > income.monthlyGold * 18) {
    stockpile.gold -= stockpile.gold * 0.1;
  }
  for (const resource of Object.keys(stockpile.resources) as Resource[]) {
    if ((stockpile.resources[resource] ?? 0) > 8000) {
      stockpile.resources[resource] = Math.round((stockpile.resources[resource] ?? 0) * 0.92);
    }
  }

  return { stockpile };
}

function multiplyResourceCosts(costs: Partial<Record<Resource, number>>, amount: number) {
  return Object.fromEntries(
    Object.entries(costs).map(([resource, value]) => [resource, value * amount]),
  ) as Partial<Record<Resource, number>>;
}

function hasResources(
  resources: Partial<Record<Resource, number>>,
  costs: Partial<Record<Resource, number>>,
) {
  return Object.entries(costs).every(([resource, amount]) =>
    (resources[resource as Resource] ?? 0) >= (amount ?? 0),
  );
}

function spendResources(
  resources: Partial<Record<Resource, number>>,
  costs: Partial<Record<Resource, number>>,
) {
  for (const [resource, amount] of Object.entries(costs)) {
    const key = resource as Resource;
    resources[key] = Math.max(0, (resources[key] ?? 0) - (amount ?? 0));
  }
}

function emptyResourceCosts() {
  return {
    coal: 0,
    copper: 0,
    grain: 0,
    gold: 0,
    iron: 0,
    oil: 0,
    silver: 0,
    timber: 0,
    water: 0,
    steel: 0,
  } satisfies Record<Resource, number>;
}

function issueArmyCommands(
  world: World,
  diplomacy: DiplomacyState,
  army: NationMilitary,
  currentMonth: number,
  stockpiles?: NationStockpiles,
) {
  let nextArmy = cloneArmy(army);
  const events: GameEvent[] = [];
  let mapChanged = false;
  const wars = diplomacy.wars.filter((war) =>
    war.attackerNationId === army.nationId || war.defenderNationId === army.nationId,
  );

  if (wars.length === 0) {
    const merge = mergeArmyGroups(nextArmy, currentMonth);
    return {
      events: merge.events,
      army: merge.army,
      mapChanged: merge.mapChanged,
    };
  }

  for (const war of wars) {
    const enemyNationId = war.attackerNationId === army.nationId ? war.defenderNationId : war.attackerNationId;
    const counterattack = currentMonth - war.startedAtMonth >= 12;
    const attackTarget = war.attackerNationId === army.nationId || counterattack
      ? pickTargetProvince(world, army.nationId, enemyNationId)
      : pickDefensiveProvince(world, army.nationId, enemyNationId);
    if (!attackTarget) {
      continue;
    }

    const isOffensiveMove = war.attackerNationId === army.nationId || counterattack;
    const rallyProvinceId = isOffensiveMove
      ? pickRallyProvince(world, army.nationId, attackTarget.id) ?? attackTarget.id
      : attackTarget.id;
    const stance: ArmyStance = isOffensiveMove ? "attack" : "defend";
    const destinationProvinceId = stance === "attack" ? attackTarget.id : rallyProvinceId;

    const existingCommitted = nextArmy.armyGroups.some((group) =>
      group.objectiveProvinceId === attackTarget.id &&
      (group.stance === "attack" || group.stance === "defend" || group.stance === "rally"),
    );
    if (!existingCommitted) {
      const created = createArmyGroupFromBestCity(
        world,
        nextArmy,
        destinationProvinceId,
        attackTarget.id,
        stance,
        currentMonth,
        stockpiles ? { stockpiles, events } : undefined,
        diplomacy,
      );
      nextArmy = created.army;
      if (created.event) {
        events.push(created.event);
        mapChanged = true;
      }
    }

    const ordered = orderArmyGroupsTowardObjective(
      world,
      nextArmy,
      destinationProvinceId,
      attackTarget.id,
      stance,
      currentMonth,
      diplomacy,
    );
    nextArmy = ordered.army;
    events.push(...ordered.events);
    mapChanged ||= ordered.mapChanged;
  }

  const merge = mergeArmyGroups(nextArmy, currentMonth);
  nextArmy = merge.army;
  events.push(...merge.events);
  mapChanged ||= merge.mapChanged;

  return {
    army: recalculateNationUnits(nextArmy),
    events,
    mapChanged,
  };
}

function createArmyGroupFromBestCity(
  world: World,
  army: NationMilitary,
  destinationProvinceId: string,
  objectiveProvinceId: string,
  stance: ArmyStance,
  currentMonth: number,
  musterCtx?: { stockpiles: NationStockpiles; events: GameEvent[] },
  diplomacy?: DiplomacyState,
) {
  const cityCandidates = world.cities
    .filter((city) => city.nationId === army.nationId)
    .map((city) => ({
      city,
      distance: provinceDistance(world, city.provinceId, destinationProvinceId),
      garrison: army.cityGarrisons[city.id] ?? emptyUnits(),
    }))
    .filter(({ city, garrison }) => totalUnits(garrison) > 0)
    .sort((a, b) => {
      const scoreA = totalUnits(a.garrison) - a.distance * 18;
      const scoreB = totalUnits(b.garrison) - b.distance * 18;
      return scoreB - scoreA;
    });
  if (cityCandidates.length === 0) {
    return { army };
  }

  // Recluta concentrada: sumar aporte de varias ciudades hasta el mínimo útil.
  const nextArmy = cloneArmy(army);
  const pooled = emptyUnits();
  const musterCities: string[] = [];
  for (const { city } of cityCandidates) {
    const garrison = nextArmy.cityGarrisons[city.id] ?? emptyUnits();
    const movable = Math.max(0, totalUnits(garrison) - cityReserveTarget(city));
    if (movable <= 0) {
      continue;
    }
    const take = takeUnits(garrison, Math.floor(movable * 0.62));
    if (totalUnits(take) <= 0) {
      continue;
    }
    addUnits(pooled, take);
    nextArmy.cityGarrisons[city.id] = subtractUnits(garrison, take);
    musterCities.push(city.name);
    if (totalUnits(pooled) >= MIN_GROUP_SIZE) {
      break;
    }
  }

  // Leva automática: si el pool no alcanza, llamados de habitantes a milicia (levy).
  if (totalUnits(pooled) < MIN_GROUP_SIZE && musterCtx) {
    const stockpile = musterCtx.stockpiles[army.nationId];
    if (stockpile) {
      const levy = levyMilitia(world, army.nationId, stockpile, MIN_GROUP_SIZE - totalUnits(pooled), currentMonth, musterCtx.events);
      addUnits(pooled, levy.units);
    }
  }
  if (totalUnits(pooled) < MIN_GROUP_SIZE) {
    return { army };
  }

  const homeCity = cityCandidates[0].city;
  const path = findProvincePath(world, army.nationId, homeCity.provinceId, destinationProvinceId, diplomacy);
  const group: ArmyGroup = {
    createdAtMonth: currentMonth,
    destinationProvinceId,
    id: `army-group-${army.nationId}-${homeCity.id}-${currentMonth}-${army.armyGroups.length}`,
    locationProvinceId: homeCity.provinceId,
    movementProgress: 0,
    nationId: army.nationId,
    objectiveProvinceId,
    originCityId: homeCity.id,
    pathProvinceIds: path.slice(1),
    stance,
    units: pooled,
    updatedAtMonth: currentMonth,
  };
  nextArmy.armyGroups.push(group);

  return {
    army: recalculateNationUnits(nextArmy),
    event: buildWarEvent({
      currentMonth,
      description: `${nationName(world, army.nationId)} mustered an army group for ${formatArmyStance(stance)} from ${musterCities.slice(0, 3).join(", ")}${musterCities.length > 3 ? ` and ${musterCities.length - 3} more` : ""} and ordered it toward ${world.provinceById.get(destinationProvinceId)?.name ?? destinationProvinceId}.`,
      id: `event-army-group-created-${group.id}`,
      kind: "army_group_created",
      nationIds: [army.nationId],
      title: "Army Group Created",
    }),
  };
}

const MIN_GROUP_SIZE = 25;
const LEVY_GOLD_PER_HEAD = 0.015;
const LEVY_DESERT_RATE = 0.1;
const LEVY_MAX_POP_SHARE = 0.05;

/**
 * Llamado a la milicia: convierte habitantes en levy (stats ~mitad de soldado).
 * Cuesta 0.015 oro por cabeza; 10% deserta (determinista por seed).
 * La población se descuenta siempre, incluso por desertores; los desertores
 * se suman al tile no-nacional más cercano. Sin mutaciones si no alcanza `needed`.
 */
function levyMilitia(
  world: World,
  nationId: string,
  stockpile: NationStockpiles[string],
  needed: number,
  currentMonth: number,
  events: GameEvent[],
): { units: ArmyUnits; called: number; deserted: number; cost: number } {
  const units = emptyUnits();
  const none = { units, called: 0, deserted: 0, cost: 0 };
  if (needed <= 0) {
    return none;
  }
  const cities = world.cities
    .filter((city) => city.nationId === nationId && city.population > 0)
    .sort((a, b) => b.population - a.population);
  if (cities.length === 0) {
    return none;
  }

  // La deserción es determinista (seed+mes): se planifica con margen para que
  // los sobrevivientes cubran `needed`. Sin mutaciones si no se alcanza.
  const desertRoll = at(world.seed, `levy-desert:${nationId}`, currentMonth);
  const survivorsOf = (called: number) =>
    called - Math.min(called, Math.floor(called * LEVY_DESERT_RATE + desertRoll));
  let affordable = Math.floor((stockpile.gold ?? 0) / LEVY_GOLD_PER_HEAD);
  const plan: Array<{ city: (typeof cities)[number]; take: number }> = [];
  let called = 0;
  for (const city of cities) {
    if (survivorsOf(called) >= needed || affordable <= 0) {
      break;
    }
    // Margen extra porque parte deserta.
    const want = needed - survivorsOf(called) + 2;
    const take = Math.min(want, Math.floor(city.population * LEVY_MAX_POP_SHARE), affordable);
    if (take <= 0) {
      continue;
    }
    plan.push({ city, take });
    called += take;
    affordable -= take;
  }
  if (survivorsOf(called) < needed) {
    return none;
  }

  const cost = called * LEVY_GOLD_PER_HEAD;
  stockpile.gold = Math.max(0, (stockpile.gold ?? 0) - cost);
  for (const { city, take } of plan) {
    city.population = Math.max(0, city.population - take);
  }
  const deserted = called - survivorsOf(called);
  units.levy = called - deserted;
  if (deserted > 0) {
    settleDeserters(world, nationId, deserted);
  }
  events.push(buildWarEvent({
    currentMonth,
    description: `${nationName(world, nationId)} called ${called} inhabitants to militia duty for ${cost.toFixed(2)} gold; ${deserted} deserted.`,
    id: `event-levy-called-${nationId}-${currentMonth}`,
    kind: "levy_called",
    nationIds: [nationId],
    title: "Levy Called",
  }));
  return { units, called, deserted, cost };
}

function settleDeserters(world: World, nationId: string, count: number) {
  const anchor = world.cities.find((city) => city.nationId === nationId);
  const ax = anchor?.x ?? 0;
  const ay = anchor?.y ?? 0;
  let best: Tile | undefined;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const tile of world.tiles) {
    const province = tile.provinceId ? world.provinceById.get(tile.provinceId) : undefined;
    if (!province || province.nationId === nationId) {
      continue;
    }
    const dist = (tile.x - ax) ** 2 + (tile.y - ay) ** 2;
    if (dist < bestDist) {
      bestDist = dist;
      best = tile;
    }
  }
  if (best) {
    best.populationOnTile = (best.populationOnTile ?? 0) + count;
  }
}

function orderArmyGroupsTowardObjective(
  world: World,
  army: NationMilitary,
  destinationProvinceId: string,
  objectiveProvinceId: string,
  stance: ArmyStance,
  currentMonth: number,
  diplomacy?: DiplomacyState,
) {
  const nextArmy = cloneArmy(army);
  const events: GameEvent[] = [];
  let mapChanged = false;

  for (const group of nextArmy.armyGroups) {
    const groupProvince = world.provinceById.get(group.locationProvinceId);
    const canRetask =
      group.pathProvinceIds.length === 0 &&
      groupProvince?.nationId === army.nationId;
    if (
      totalUnits(group.units) < 25 ||
      (group.stance === "retreat" && groupProvince?.nationId !== army.nationId)
    ) {
      continue;
    }
    if (!canRetask && group.objectiveProvinceId && group.objectiveProvinceId !== objectiveProvinceId) {
      continue;
    }
    const path = findProvincePath(world, army.nationId, group.locationProvinceId, destinationProvinceId, diplomacy);
    if (path.length <= 1) {
      continue;
    }

    const changed =
      group.destinationProvinceId !== destinationProvinceId ||
      group.stance !== stance ||
      group.pathProvinceIds.join(",") !== path.slice(1).join(",");
    if (!changed) {
      continue;
    }

    group.destinationProvinceId = destinationProvinceId;
    group.objectiveProvinceId = objectiveProvinceId;
    group.pathProvinceIds = path.slice(1);
    group.stance = stance;
    group.updatedAtMonth = currentMonth;
    mapChanged = true;
    events.push(buildWarEvent({
      currentMonth,
      description: `${nationName(world, army.nationId)} redirected an army group toward ${world.provinceById.get(destinationProvinceId)?.name ?? destinationProvinceId}.`,
      id: `event-army-group-ordered-${group.id}-${currentMonth}`,
      kind: "army_group_ordered",
      nationIds: [army.nationId],
      title: "Army Group Ordered",
    }));
  }

  return {
    army: recalculateNationUnits(nextArmy),
    events,
    mapChanged,
  };
}

function moveArmyGroups(world: World, army: NationMilitary, currentMonth: number) {
  const nextArmy = cloneArmy(army);
  const events: GameEvent[] = [];
  let mapChanged = false;

  for (const group of nextArmy.armyGroups) {
    if (group.pathProvinceIds.length === 0) {
      continue;
    }

    let groupMoved = false;
    group.movementProgress += armyGroupSpeed(group.units);
    while (group.pathProvinceIds.length > 0) {
      const nextProvinceId = group.pathProvinceIds[0];
      const cost = provinceMovementCost(world, nextProvinceId, group.units);
      if (group.movementProgress < cost) {
        break;
      }

      group.movementProgress -= cost;
      group.locationProvinceId = nextProvinceId;
      group.pathProvinceIds = group.pathProvinceIds.slice(1);
      group.updatedAtMonth = currentMonth;
      groupMoved = true;
      mapChanged = true;
    }

    if (groupMoved && group.pathProvinceIds.length === 0) {
      events.push(buildWarEvent({
        currentMonth,
        description: `${nationName(world, army.nationId)} army group reached ${world.provinceById.get(group.locationProvinceId)?.name ?? group.locationProvinceId}.`,
        id: `event-army-group-arrived-${group.id}-${currentMonth}`,
        kind: "army_group_moved",
        nationIds: [army.nationId],
        title: "Army Group Moved",
      }));
    }
  }

  return {
    army: recalculateNationUnits(nextArmy),
    events,
    mapChanged,
  };
}

function mergeArmyGroups(army: NationMilitary, currentMonth: number) {
  const nextArmy = cloneArmy(army);
  const events: GameEvent[] = [];
  let mapChanged = false;
  const byProvince = new Map<string, ArmyGroup[]>();

  for (const group of nextArmy.armyGroups) {
    const groups = byProvince.get(group.locationProvinceId) ?? [];
    groups.push(group);
    byProvince.set(group.locationProvinceId, groups);
  }

  const mergedGroups: ArmyGroup[] = [];
  for (const groups of byProvince.values()) {
    if (groups.length < 2) {
      mergedGroups.push(...groups);
      continue;
    }

    const [primary, ...rest] = groups.sort((a, b) => totalUnits(b.units) - totalUnits(a.units));
    const mergedUnits = cloneUnits(primary.units);
    for (const group of rest) {
      addUnits(mergedUnits, group.units);
    }
    mergedGroups.push({
      ...primary,
      units: mergedUnits,
      updatedAtMonth: currentMonth,
    });
    events.push(buildWarEvent({
      currentMonth,
      description: `${groups.length} army groups merged in the same province.`,
      id: `event-army-groups-merged-${nextArmy.nationId}-${primary.locationProvinceId}-${currentMonth}`,
      kind: "army_group_merged",
      nationIds: [nextArmy.nationId],
      title: "Army Groups Merged",
    }));
    mapChanged = true;
  }

  nextArmy.armyGroups = mergedGroups.filter((group) => totalUnits(group.units) > 0);
  return {
    army: recalculateNationUnits(nextArmy),
    events,
    mapChanged,
  };
}

function pickDefensiveProvince(world: World, defenderNationId: string, attackerNationId: string) {
  const adjacency = buildProvinceAdjacency(world);
  const attackerProvinceIds = new Set(
    world.provinces
      .filter((province) => province.nationId === attackerNationId)
      .map((province) => province.id),
  );

  return world.provinces
    .filter((province) =>
      province.nationId === defenderNationId &&
      [...(adjacency.get(province.id) ?? [])].some((neighborId) => attackerProvinceIds.has(neighborId)),
    )
    .map((province) => ({ province, score: scoreTargetProvince(world, province) }))
    .sort((a, b) => b.score - a.score || a.province.id.localeCompare(b.province.id))[0]?.province;
}

function pickRallyProvince(world: World, nationId: string, targetProvinceId: string) {
  const adjacency = buildProvinceAdjacency(world);
  const candidateIds = [...(adjacency.get(targetProvinceId) ?? [])].filter((provinceId) =>
    world.provinceById.get(provinceId)?.nationId === nationId,
  );

  return candidateIds
    .map((provinceId) => world.provinceById.get(provinceId))
    .filter((province): province is Province => Boolean(province))
    .sort((a, b) => scoreTargetProvince(world, b) - scoreTargetProvince(world, a))[0]?.id;
}

function findProvincePath(
  world: World,
  nationId: string,
  startProvinceId: string,
  destinationProvinceId: string,
  diplomacy?: DiplomacyState,
) {
  if (startProvinceId === destinationProvinceId) {
    return [startProvinceId];
  }

  const adjacency = buildProvinceAdjacency(world);
  const frontier = [{ cost: 0, provinceId: startProvinceId }];
  const cameFrom = new Map<string, string>();
  const costSoFar = new Map<string, number>([[startProvinceId, 0]]);

  while (frontier.length > 0) {
    frontier.sort((a, b) => a.cost - b.cost);
    const current = frontier.shift();
    if (!current) {
      break;
    }
    if (current.provinceId === destinationProvinceId) {
      break;
    }

    for (const neighborId of adjacency.get(current.provinceId) ?? []) {
      const province = world.provinceById.get(neighborId);
      if (!province) {
        continue;
      }
      const isDestination = neighborId === destinationProvinceId;
      // Tránsito ponderado: propio < aliado < neutral < terceros (paso, no invasión).
      const newCost = current.cost + provincePathCost(world, neighborId) +
        transitPenalty(world, diplomacy, nationId, province.nationId, isDestination);
      if (!costSoFar.has(neighborId) || newCost < (costSoFar.get(neighborId) ?? Number.POSITIVE_INFINITY)) {
        costSoFar.set(neighborId, newCost);
        cameFrom.set(neighborId, current.provinceId);
        frontier.push({ cost: newCost, provinceId: neighborId });
      }
    }
  }

  if (!cameFrom.has(destinationProvinceId)) {
    return [startProvinceId];
  }

  const path = [destinationProvinceId];
  let current = destinationProvinceId;
  while (current !== startProvinceId) {
    const previous = cameFrom.get(current);
    if (!previous) {
      return [startProvinceId];
    }
    path.push(previous);
    current = previous;
  }

  return path.reverse();
}

function transitPenalty(
  world: World,
  diplomacy: DiplomacyState | undefined,
  nationId: string,
  ownerNationId: string | undefined,
  isDestination: boolean,
): number {
  if (ownerNationId === nationId || isDestination) {
    return 0;
  }
  if (ownerNationId === undefined) {
    return 4;
  }
  if (diplomacy?.alliances.some((alliance) =>
    relationKey(alliance.nationAId, alliance.nationBId) === relationKey(nationId, ownerNationId))) {
    return 2;
  }
  return 9;
}

function provinceDistance(world: World, startProvinceId: string, destinationProvinceId: string) {
  if (startProvinceId === destinationProvinceId) {
    return 0;
  }

  const adjacency = buildProvinceAdjacency(world);
  const queue = [{ distance: 0, provinceId: startProvinceId }];
  const seen = new Set([startProvinceId]);

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) {
      break;
    }
    for (const neighborId of adjacency.get(current.provinceId) ?? []) {
      if (neighborId === destinationProvinceId) {
        return current.distance + 1;
      }
      if (seen.has(neighborId)) {
        continue;
      }
      seen.add(neighborId);
      queue.push({ distance: current.distance + 1, provinceId: neighborId });
    }
  }

  return 99;
}

function provincePathCost(world: World, provinceId: string) {
  const terrainCounts = countProvinceTerrain(world, provinceId);
  const dominantTerrain = Object.entries(terrainCounts).sort(([, a], [, b]) => b - a)[0]?.[0] as Terrain | undefined;

  switch (dominantTerrain) {
    case "mountain":
      return 4;
    case "forest":
    case "hill":
    case "desert":
      return 2;
    case "coast":
    case "plain":
    case "ocean":
    default:
      return 1;
  }
}

function provinceMovementCost(world: World, provinceId: string, units: ArmyUnits) {
  const baseCost = provincePathCost(world, provinceId);
  const heavyPenalty = units.heavyCavalry > totalUnits(units) * 0.35 && baseCost >= 2 ? 0.35 : 0;
  const lightCavalryBonus = units.lightCavalry > totalUnits(units) * 0.45 ? 0.25 : 0;

  return Math.max(0.75, baseCost + heavyPenalty - lightCavalryBonus);
}

function armyGroupSpeed(units: ArmyUnits) {
  const total = totalUnits(units);
  if (total === 0) {
    return 0;
  }

  const slowShare = (units.militia + units.infantry + units.levy) / total;
  const lightCavalryShare = units.lightCavalry / total;
  return clamp(0.65 + lightCavalryShare * 1.1 - slowShare * 0.18, 0.45, 1.6);
}

function cityReserveTarget(city: { isCapital: boolean; level: number }) {
  return 22 + city.level * 12 + (city.isCapital ? 32 : 0);
}

function takeUnits(units: ArmyUnits, desiredAmount: number) {
  const total = totalUnits(units);
  if (total <= 0 || desiredAmount <= 0) {
    return emptyUnits();
  }

  const share = Math.min(1, desiredAmount / total);
  const taken = emptyUnits();
  for (const type of unitTypes) {
    taken[type] = Math.floor(units[type] * share);
  }
  return taken;
}

function subtractUnits(units: ArmyUnits, removed: ArmyUnits) {
  const rest = emptyUnits();
  for (const type of unitTypes) {
    rest[type] = Math.max(0, units[type] - removed[type]);
  }
  return rest;
}

function addUnits(target: ArmyUnits, source: ArmyUnits) {
  for (const type of unitTypes) {
    target[type] += source[type];
  }
}

function cloneUnits(units: ArmyUnits) {
  return { ...units };
}

function distributeUnitsToCities(units: ArmyUnits, cities: Array<{ id: string; isCapital: boolean; level: number }>) {
  if (cities.length === 0) {
    return {};
  }

  const totalWeight = cities.reduce((sum, city) => sum + city.level + (city.isCapital ? 3 : 1), 0);
  const garrisons: Record<string, ArmyUnits> = {};

  for (const city of cities) {
    const weight = (city.level + (city.isCapital ? 3 : 1)) / totalWeight;
    const cityUnits = emptyUnits();
    for (const type of unitTypes) {
      cityUnits[type] = units[type] * weight;
    }
    garrisons[city.id] = cityUnits;
  }

  const allTypes: UnitType[] = [...unitTypes];
  for (const type of allTypes) {
    const raw = cities.map((city) => ({ city, value: garrisons[city.id][type] }));
    const floors = raw.map((r) => Math.floor(r.value));
    const flooredTotal = floors.reduce((s, f) => s + f, 0);
    const remainder = units[type] - flooredTotal;
    const indexed = raw.map((r, i) => ({ index: i, frac: r.value - floors[i] }))
      .sort((a, b) => b.frac - a.frac);
    const finalFloors = [...floors];
    for (let i = 0; i < remainder && i < indexed.length; i += 1) {
      finalFloors[indexed[i].index] += 1;
    }
    cities.forEach((city, i) => {
      garrisons[city.id][type] = finalFloors[i];
    });
  }

  return garrisons;
}

function recalculateNationUnits(army: NationMilitary): NationMilitary {
  const units = emptyUnits();

  for (const garrison of Object.values(army.cityGarrisons)) {
    addUnits(units, garrison);
  }
  for (const group of army.armyGroups) {
    addUnits(units, group.units);
  }

  return {
    ...army,
    armyGroups: army.armyGroups.filter((group) => totalUnits(group.units) > 0),
    units,
  };
}

function getCityGarrisonSummaries(world: World, army: NationMilitary): CityGarrisonSummary[] {
  return Object.entries(army.cityGarrisons)
    .map(([cityId, units]) => {
      const city = world.cityById.get(cityId);
      const province = city ? world.provinceById.get(city.provinceId) : undefined;

      return {
        cityId,
        cityName: city?.name ?? cityId,
        provinceName: province?.name ?? "Unknown province",
        totalSoldiers: totalUnits(units),
        units,
      };
    })
    .filter((summary) => summary.totalSoldiers > 0)
    .sort((a, b) => b.totalSoldiers - a.totalSoldiers);
}

function formatArmyStance(stance: ArmyStance) {
  switch (stance) {
    case "attack":
      return "attack";
    case "defend":
      return "defense";
    case "garrison":
      return "garrison";
    case "raid":
      return "raiding";
    case "rally":
      return "rally";
    case "retreat":
      return "retreating";
  }
}

function resolveBattle({
  attackerNationId,
  attackerGroupIds,
  currentMonth,
  defenderNationId,
  defenderGroupIds,
  military,
  spyNetwork,
  targetProvince,
  war,
  world,
}: {
  attackerNationId: string;
  attackerGroupIds: string[];
  currentMonth: number;
  defenderNationId: string;
  defenderGroupIds: string[];
  military: MilitaryState;
  spyNetwork: SpyNetwork;
  targetProvince: Province;
  war: WarState;
  world: World;
}) {
  const attackerArmy = cloneArmy(military[attackerNationId] ?? {
    armyGroups: [],
    cityGarrisons: {},
    morale: 0.5,
    nationId: attackerNationId,
    recruitmentQueue: [],
    units: emptyUnits(),
  });
  const defenderArmy = cloneArmy(military[defenderNationId] ?? {
    armyGroups: [],
    cityGarrisons: {},
    morale: 0.5,
    nationId: defenderNationId,
    recruitmentQueue: [],
    units: emptyUnits(),
  });
  const attackerUnits = getEngagedUnits(world, attackerArmy, attackerGroupIds, targetProvince.id);
  const defenderUnits = getEngagedUnits(world, defenderArmy, defenderGroupIds, targetProvince.id);
  const defenderHasFieldOrGarrison = totalUnits(defenderUnits) > 0;
  const attackerHasFieldOrGarrison = totalUnits(attackerUnits) > 0;

  if (!defenderHasFieldOrGarrison && targetProvince.nationId === defenderNationId) {
    defenderUnits.militia = Math.max(defenderUnits.militia, Math.round(targetProvince.tileCount * 0.6));
  }
  if (!attackerHasFieldOrGarrison && targetProvince.nationId === attackerNationId) {
    attackerUnits.militia = Math.max(attackerUnits.militia, Math.round(targetProvince.tileCount * 0.6));
  }

  const terrainBonus = provinceDefenseBonus(world, targetProvince.id) * 0.85;
  const cityBonus = world.cities.some((city) => city.provinceId === targetProvince.id) ? 1.2 : 1;
  const intelBonus = hasActiveIntelligence(spyNetwork, attackerNationId, defenderNationId, currentMonth)
    ? 1.08
    : 1;
  const attackRoll = 0.88 + at(world.seed, `${war.id}:attack:${targetProvince.id}`, currentMonth) * 0.24;
  const defenseRoll = 0.9 + at(world.seed, `${war.id}:defense:${targetProvince.id}`, currentMonth) * 0.2;
  const mobilityBonus = 1 + averageSpeed(attackerUnits) * 0.035;
  const attackerPower =
    calculateUnitsAttackPower(attackerUnits) *
    attackerArmy.morale *
    mobilityBonus *
    intelBonus *
    attackRoll;
  const defenderPower =
    calculateUnitsDefensePower(defenderUnits) *
    defenderArmy.morale *
    terrainBonus *
    cityBonus *
    defenseRoll;
  const attackerWon = attackerPower > defenderPower * 0.5;
  const powerRatio = attackerWon
    ? defenderPower / Math.max(1, attackerPower)
    : attackerPower / Math.max(1, defenderPower);
  const winnerLossRate = clamp(0.045 + powerRatio * 0.06, 0.04, 0.13);
  const loserLossRate = clamp(0.095 + (1 - powerRatio) * 0.09, 0.09, 0.22);

  applyEngagementLosses(world, attackerArmy, attackerGroupIds, targetProvince.id, attackerWon ? winnerLossRate : loserLossRate);
  applyEngagementLosses(world, defenderArmy, defenderGroupIds, targetProvince.id, attackerWon ? loserLossRate : winnerLossRate);
  if (attackerWon) {
    retreatGroups(world, defenderArmy, defenderGroupIds, targetProvince.id, currentMonth);
  } else {
    retreatGroups(world, attackerArmy, attackerGroupIds, targetProvince.id, currentMonth);
  }
  attackerArmy.morale = clamp(attackerArmy.morale + (attackerWon ? 0.035 : -0.05), 0.25, 1);
  defenderArmy.morale = clamp(defenderArmy.morale + (attackerWon ? -0.055 : 0.03), 0.25, 1);

  const event = buildWarEvent({
    currentMonth,
    description: `${nationName(world, attackerNationId)} ${attackerWon ? "won" : "failed"} the battle for ${targetProvince.name} against ${nationName(world, defenderNationId)}. Attack ${Math.round(attackerPower)}, defense ${Math.round(defenderPower)}.`,
    id: `event-battle-${war.id}-${targetProvince.id}-${currentMonth}`,
    kind: "battle_fought",
    nationIds: [attackerNationId, defenderNationId],
    title: attackerWon ? "Battle Won" : "Battle Held",
  });

  return {
    attackerArmy: recalculateNationUnits(attackerArmy),
    attackerWon,
    defenderArmy: recalculateNationUnits(defenderArmy),
    event,
  };
}

function transferProvince(
  world: World,
  provinceId: string,
  newNationId: string,
  oldNationId: string,
  currentMonth: number,
) {
  const province = world.provinceById.get(provinceId);
  const capturedCities = world.cities.filter((city) => city.provinceId === provinceId);
  const events: GameEvent[] = [];

  if (!province) {
    return { capturedCities, events };
  }

  province.nationId = newNationId;
  events.push(buildWarEvent({
    currentMonth,
    description: `${nationName(world, newNationId)} occupied ${province.name}, taking control of its land and resources from ${nationName(world, oldNationId)}.`,
    id: `event-province-occupied-${provinceId}-${newNationId}-${currentMonth}`,
    kind: "province_occupied",
    nationIds: [newNationId, oldNationId],
    title: "Province Occupied",
  }));

  for (const city of capturedCities) {
    const wasCapital = city.isCapital || world.nationById.get(oldNationId)?.capitalCityId === city.id;
    city.nationId = newNationId;
    city.isCapital = false;
    events.push(buildWarEvent({
      currentMonth,
      description: `${nationName(world, oldNationId)} lost ${city.name}${wasCapital ? ", its capital city," : ""} to ${nationName(world, newNationId)}.`,
      id: `event-city-lost-${city.id}-${oldNationId}-${currentMonth}`,
      kind: "city_lost",
      nationIds: [newNationId, oldNationId],
      title: wasCapital ? "Capital Lost" : "City Lost",
    }));
  }

  normalizeNationCapitals(world);
  rebuildNationEdges(world);

  return { capturedCities, events };
}

function removeCapturedCityGarrisons(
  military: MilitaryState,
  capturedCities: Array<{ id: string }>,
  oldNationId: string,
) {
  const army = military[oldNationId];
  if (!army) {
    return;
  }

  for (const city of capturedCities) {
    delete army.cityGarrisons[city.id];
  }
  military[oldNationId] = recalculateNationUnits(army);
}

function annexDefeatedNation(
  world: World,
  military: MilitaryState,
  defeatedNationId: string,
  victorNationId: string,
  currentMonth: number,
) {
  const events: GameEvent[] = [];
  let mapChanged = false;
  const remainingProvinceIds = world.provinces
    .filter((province) => province.nationId === defeatedNationId)
    .map((province) => province.id);

  for (const provinceId of remainingProvinceIds) {
    const transfer = transferProvince(world, provinceId, victorNationId, defeatedNationId, currentMonth);
    events.push(...transfer.events);
    removeCapturedCityGarrisons(military, transfer.capturedCities, defeatedNationId);
    mapChanged = true;
  }

  clearNationMilitary(military, defeatedNationId);
  clearDefeatedNationCapital(world, defeatedNationId);
  normalizeNationCapitals(world);
  rebuildNationEdges(world);
  return { events, mapChanged };
}

function clearNationMilitary(military: MilitaryState, nationId: string) {
  military[nationId] = {
    armyGroups: [],
    cityGarrisons: {},
    morale: 0,
    nationId,
    recruitmentQueue: [],
    units: emptyUnits(),
  };
}

function clearDefeatedNationCapital(world: World, nationId: string) {
  const nation = world.nationById.get(nationId);
  if (!nation) {
    return;
  }
  nation.capitalCityId = undefined;
  nation.capitalProvinceId = "";
}

function pickTargetProvince(world: World, attackerNationId: string, defenderNationId: string) {
  const adjacency = buildProvinceAdjacency(world);
  const attackerProvinceIds = new Set(
    world.provinces
      .filter((province) => province.nationId === attackerNationId)
      .map((province) => province.id),
  );
  const allDefenderProvinces = world.provinces.filter((province) => province.nationId === defenderNationId);
  const targets = allDefenderProvinces.filter((province) => {
    return [...(adjacency.get(province.id) ?? [])].some((neighborId) => attackerProvinceIds.has(neighborId));
  });

  if (targets.length > 0) {
    return targets
      .map((province) => ({ province, score: scoreTargetProvince(world, province) }))
      .sort((a, b) => b.score - a.score || a.province.id.localeCompare(b.province.id))[0]?.province;
  }

  const allAttackerProvinces = world.provinces.filter((province) => province.nationId === attackerNationId);
  if (allAttackerProvinces.length === 0 || allDefenderProvinces.length === 0) {
    return undefined;
  }

  const attackerProvince = allAttackerProvinces[0];
  const target = allDefenderProvinces.sort((a, b) =>
    provinceDistance(world, attackerProvince.id, a.id) - provinceDistance(world, attackerProvince.id, b.id)
  )[0];
  return target;
}

function scoreTargetProvince(world: World, province: Province) {
  const cities = world.cities.filter((city) => city.provinceId === province.id);
  const resources = world.tiles.filter((tile) => tile.provinceId === province.id && tile.resource).length;
  const capitalBonus = cities.some((city) => city.isCapital) ? 180 : 0;
  const cityScore = cities.reduce((sum, city) => sum + city.level * 35 + city.population / 1200, 0);

  return province.tileCount + resources * 22 + cityScore + capitalBonus;
}

function provinceDefenseBonus(world: World, provinceId: string) {
  const terrainCounts = countProvinceTerrain(world, provinceId);
  const dominantTerrain = Object.entries(terrainCounts).sort(([, a], [, b]) => b - a)[0]?.[0] as Terrain | undefined;

  switch (dominantTerrain) {
    case "mountain":
      return 1.32;
    case "hill":
      return 1.22;
    case "forest":
      return 1.16;
    case "desert":
      return 1.06;
    case "coast":
      return 1.08;
    case "plain":
    case "ocean":
    default:
      return 1;
  }
}

function countProvinceTerrain(world: World, provinceId: string) {
  return world.tiles.reduce<Partial<Record<Terrain, number>>>((counts, tile) => {
    if (tile.provinceId !== provinceId) {
      return counts;
    }

    counts[tile.terrain] = (counts[tile.terrain] ?? 0) + 1;
    return counts;
  }, {});
}

export function buildProvinceAdjacency(world: World) {
  const tileByCoord = new Map(world.tiles.map((tile) => [`${tile.x},${tile.y}`, tile]));
  const adjacency = new Map<string, Set<string>>();

  for (const tile of world.tiles) {
    for (const [dx, dy] of [[1, 0], [0, 1]]) {
      const neighbor = tileByCoord.get(`${tile.x + dx},${tile.y + dy}`);
      if (!tile.provinceId || !neighbor?.provinceId || tile.provinceId === neighbor.provinceId) {
        continue;
      }

      addAdjacency(adjacency, tile.provinceId, neighbor.provinceId);
      addAdjacency(adjacency, neighbor.provinceId, tile.provinceId);
    }
  }

  return adjacency;
}

function addAdjacency(adjacency: Map<string, Set<string>>, provinceId: string, neighborId: string) {
  const neighbors = adjacency.get(provinceId) ?? new Set<string>();
  neighbors.add(neighborId);
  adjacency.set(provinceId, neighbors);
}

export function rebuildNationEdges(world: World) {
  const tileByCoord = new Map(world.tiles.map((tile) => [`${tile.x},${tile.y}`, tile]));
  const nationEdges = [];

  for (const tile of world.tiles) {
    const right = tileByCoord.get(`${tile.x + 1},${tile.y}`);
    const down = tileByCoord.get(`${tile.x},${tile.y + 1}`);
    addNationBorderBetween(world, tile, right, "vertical", nationEdges);
    addNationBorderBetween(world, tile, down, "horizontal", nationEdges);

    if (tile.x === 0 && tile.provinceId) {
      nationEdges.push({ x1: tile.x, y1: tile.y, x2: tile.x, y2: tile.y + 1, nationId: provinceNationId(world, tile) });
    }
    if (tile.y === 0 && tile.provinceId) {
      nationEdges.push({ x1: tile.x, y1: tile.y, x2: tile.x + 1, y2: tile.y, nationId: provinceNationId(world, tile) });
    }
    if (tile.x === world.width - 1 && tile.provinceId) {
      nationEdges.push({ x1: tile.x + 1, y1: tile.y, x2: tile.x + 1, y2: tile.y + 1, nationId: provinceNationId(world, tile) });
    }
    if (tile.y === world.height - 1 && tile.provinceId) {
      nationEdges.push({ x1: tile.x, y1: tile.y + 1, x2: tile.x + 1, y2: tile.y + 1, nationId: provinceNationId(world, tile) });
    }
  }

  world.nationEdges.splice(0, world.nationEdges.length, ...nationEdges);
}

function addNationBorderBetween(
  world: World,
  tile: Tile,
  neighbor: Tile | undefined,
  direction: "horizontal" | "vertical",
  nationEdges: World["nationEdges"],
) {
  if (!neighbor) {
    return;
  }

  const tileNationId = provinceNationId(world, tile);
  const neighborNationId = provinceNationId(world, neighbor);
  if (tileNationId === neighborNationId) {
    return;
  }

  const edge = direction === "vertical"
    ? { x1: tile.x + 1, y1: tile.y, x2: tile.x + 1, y2: tile.y + 1 }
    : { x1: tile.x, y1: tile.y + 1, x2: tile.x + 1, y2: tile.y + 1 };
  nationEdges.push({ ...edge, nationId: tileNationId ?? neighborNationId });
}

function provinceNationId(world: World, tile: Tile) {
  return tile.provinceId ? world.provinceById.get(tile.provinceId)?.nationId : undefined;
}

function normalizeNationCapitals(world: World) {
  for (const nation of world.nations) {
    const cities = world.cities
      .filter((city) => city.nationId === nation.id)
      .sort((a, b) => b.population - a.population);
    if (cities.length === 0) {
      const fallbackProvince = world.provinces.find((province) => province.nationId === nation.id);
      nation.capitalCityId = undefined;
      nation.capitalProvinceId = fallbackProvince?.id ?? nation.capitalProvinceId;
      continue;
    }

    const currentCapital = cities.find((city) => city.id === nation.capitalCityId && city.isCapital);
    const capital = currentCapital ?? cities[0];
    for (const city of cities) {
      city.isCapital = city.id === capital.id;
    }
    nation.capitalCityId = capital.id;
    nation.capitalProvinceId = capital.provinceId;
  }
}

function buildTrucesForEndedEvents(events: GameEvent[], currentMonth: number) {
  return events
    .filter((event) => event.kind === "war_ended" && event.nationIds.length >= 2)
    .map((event) => ({
      expiresAtMonth: currentMonth + truceAfterWarMonths,
      id: `truce-${relationKey(event.nationIds[0], event.nationIds[1])}-${currentMonth}`,
      nationAId: event.nationIds[0],
      nationBId: event.nationIds[1],
      signedAtMonth: currentMonth,
    }));
}

function worsenRelationToAtMost(
  relations: NationRelations,
  nationAId: string,
  nationBId: string,
  maxAttitude: number,
  currentMonth: number,
) {
  const relation = getNationRelation(relations, nationAId, nationBId);
  if (!relation || relation.attitude <= maxAttitude) {
    return relations;
  }

  return adjustNationRelation(
    relations,
    nationAId,
    nationBId,
    maxAttitude - relation.attitude,
    currentMonth,
  );
}

function shouldEndWar(war: WarState, attackerArmy: NationMilitary, defenderArmy: NationMilitary) {
  if (totalUnits(attackerArmy.units) < 45 || totalUnits(defenderArmy.units) < 45) {
    return true;
  }

  return (war.battleCount ?? 0) >= 5 && Math.abs((war.attackerScore ?? 0) - (war.defenderScore ?? 0)) >= 3;
}

export type WarEndCause = "no-front" | "stuck" | "decisive";

/** El defensor toma la ofensiva si no ha perdido, tiene músculo, quiere y alcanza. */
function defenderContinuesWar(
  world: World,
  diplomacy: DiplomacyState,
  military: MilitaryState,
  relations: NationRelations,
  war: WarState,
): boolean {
  const defenderArmy = military[war.defenderNationId];
  const attackerArmy = military[war.attackerNationId];
  if (!defenderArmy || !attackerArmy) {
    return false;
  }
  if (!isNationActive(world, war.defenderNationId) || !isNationActive(world, war.attackerNationId)) {
    return false;
  }
  const defTroops = totalUnits(defenderArmy.units);
  if (defTroops < 45) {
    return false;
  }
  const attitude = getNationRelation(relations, war.defenderNationId, war.attackerNationId)?.attitude ?? 0;
  const attTroops = Math.max(1, totalUnits(attackerArmy.units));
  const wantsToContinue = attitude <= -10 || (defTroops >= attTroops * 1.25 && attitude <= 8);
  if (!wantsToContinue) {
    return false;
  }
  return canReachWarTarget(world, defenderArmy, war.attackerNationId, diplomacy);
}

function flipWarAttacker(war: WarState): WarState {
  return {
    ...war,
    attackerNationId: war.defenderNationId,
    defenderNationId: war.attackerNationId,
    attackerScore: 0,
    defenderScore: 0,
    targetProvinceId: undefined,
  };
}

/** Parte de motivos del declive: batallas, score, contacto, tropas y frentes. */
function warDeclineReport(
  world: World,
  military: MilitaryState,
  diplomacy: DiplomacyState,
  war: WarState,
  cause: WarEndCause,
  currentMonth: number,
): string {
  const attackerId = war.attackerNationId;
  const defenderId = war.defenderNationId;
  const attackerTroops = totalUnits(military[attackerId]?.units ?? emptyUnits());
  const defenderTroops = totalUnits(military[defenderId]?.units ?? emptyUnits());
  const battles = war.battleCount ?? 0;
  const sinceText = battles > 0 && war.lastBattleMonth !== undefined
    ? `last contact ${currentMonth - war.lastBattleMonth} months ago`
    : "no contact since the war began";
  const attackerReach = canReachWarTarget(world, military[attackerId], defenderId, diplomacy) ? "yes" : "no";
  const defenderReach = canReachWarTarget(world, military[defenderId], attackerId, diplomacy) ? "yes" : "no";
  const causeText = cause === "no-front"
    ? "no viable front or reachable objective"
    : cause === "stuck"
      ? "over 180 months without contact"
      : "decisive score after sustained fighting";
  return `Decline (${causeText}): ${battles} battles (attacker ${war.attackerScore ?? 0} – defender ${war.defenderScore ?? 0}), ${sinceText}. Troops: ${nationName(world, attackerId)} ${attackerTroops} vs ${nationName(world, defenderId)} ${defenderTroops}. Reachable front: attacker ${attackerReach}, defender ${defenderReach}.`;
}

function dedupeWars(wars: WarState[]) {
  const seen = new Set<string>();
  return wars.filter((war) => {
    const key = relationKey(war.attackerNationId, war.defenderNationId);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function hasActiveIntelligence(
  spyNetwork: SpyNetwork,
  ownerNationId: string,
  targetNationId: string,
  currentMonth: number,
) {
  return spyNetwork.intelligenceReports.some((report) =>
    report.ownerNationId === ownerNationId &&
    report.targetNationId === targetNationId &&
    (report.expiresAtMonth === undefined || report.expiresAtMonth > currentMonth),
  );
}

function cloneMilitary(military: MilitaryState): MilitaryState {
  return Object.fromEntries(
    Object.entries(military).map(([nationId, army]) => [nationId, cloneArmy(army)]),
  );
}

function cloneArmy(army: NationMilitary): NationMilitary {
  return {
    ...army,
    armyGroups: army.armyGroups.map((group) => ({
      ...group,
      pathProvinceIds: [...group.pathProvinceIds],
      units: { ...group.units },
    })),
    cityGarrisons: Object.fromEntries(
      Object.entries(army.cityGarrisons).map(([cityId, units]) => [cityId, { ...units }]),
    ),
    recruitmentQueue: army.recruitmentQueue.map((order) => ({ ...order })),
    units: { ...army.units },
  };
}

function emptyUnits(): ArmyUnits {
  return {
    heavyCavalry: 0,
    infantry: 0,
    lightCavalry: 0,
    militia: 0,
    levy: 0,
  };
}

function calculateArmyAttackPower(army: NationMilitary) {
  return calculateUnitsAttackPower(army.units);
}

function calculateArmyDefensePower(army: NationMilitary) {
  return calculateUnitsDefensePower(army.units);
}

function calculateUnitsAttackPower(units: ArmyUnits) {
  return unitTypes.reduce((sum, type) => sum + units[type] * unitStats[type].attack, 0);
}

function calculateUnitsDefensePower(units: ArmyUnits) {
  return unitTypes.reduce((sum, type) => sum + units[type] * unitStats[type].defense, 0);
}

function calculateMonthlyUpkeep(units: ArmyUnits, nationId: string, world: World): number {
  const totalUnits = unitTypes.reduce((sum, type) => sum + units[type], 0);
  if (totalUnits === 0) return 0;

  const provinceIds = world.provinces.filter(p => p.nationId === nationId).map(p => p.id);
  // Fuente única de población: las ciudades (Province no tiene campo population).
  const totalPopulation = world.cities
    .filter((city) => city.nationId === nationId)
    .reduce((sum, city) => sum + city.population, 0);

  const baseUpkeep = unitTypes.reduce((sum, type) => sum + units[type] * unitStats[type].upkeepGold, 0);
  const densityMultiplier = Math.min(2, Math.max(0.5, totalPopulation / Math.max(1, provinceIds.length * 50)));

  return Math.round(baseUpkeep * densityMultiplier);
}

function totalUnits(units: ArmyUnits) {
  return unitTypes.reduce((sum, type) => sum + units[type], 0);
}

function disbandUnits(army: NationMilitary, amount: number, typeOrder: UnitType[]) {
  const nextArmy = cloneArmy(army);
  const removed = emptyUnits();
  let remaining = amount;

  for (const type of typeOrder) {
    if (remaining <= 0) {
      break;
    }

    const removable = Math.min(remaining, nextArmy.units[type]);
    if (removable <= 0) {
      continue;
    }

    removed[type] = removeUnitTypeFromArmy(nextArmy, type, removable);
    remaining -= removed[type];
  }

  return {
    army: recalculateNationUnits(nextArmy),
    removed,
  };
}

function removeUnitTypeFromArmy(army: NationMilitary, unitType: UnitType, amount: number) {
  let remaining = amount;
  let removed = 0;

  for (const [cityId, garrison] of Object.entries(army.cityGarrisons)) {
    if (remaining <= 0) {
      break;
    }
    const removedFromGarrison = Math.min(remaining, garrison[unitType]);
    garrison[unitType] -= removedFromGarrison;
    remaining -= removedFromGarrison;
    removed += removedFromGarrison;
    army.cityGarrisons[cityId] = garrison;
  }

  for (const group of army.armyGroups) {
    if (remaining <= 0) {
      break;
    }
    const removedFromGroup = Math.min(remaining, group.units[unitType]);
    group.units[unitType] -= removedFromGroup;
    remaining -= removedFromGroup;
    removed += removedFromGroup;
  }

  return removed;
}

function averageSpeed(units: ArmyUnits) {
  const total = totalUnits(units);
  if (total === 0) {
    return 0;
  }

  return unitTypes.reduce((sum, type) => sum + units[type] * unitStats[type].speed, 0) / total;
}

function applyLosses(units: ArmyUnits, lossRate: number) {
  for (const type of unitTypes) {
    const typeLossRate = type === "levy"
      ? lossRate * 1.3
      : type === "militia"
        ? lossRate * 1.2
        : type === "heavyCavalry"
          ? lossRate * 0.72
          : lossRate;
    units[type] = Math.max(0, units[type] - Math.ceil(units[type] * typeLossRate));
  }
}

function applyLossesToMilitary(army: NationMilitary, lossRate: number) {
  for (const group of army.armyGroups) {
    applyLosses(group.units, lossRate * 1.08);
  }

  for (const [cityId, garrison] of Object.entries(army.cityGarrisons)) {
    army.cityGarrisons[cityId] = applyLossesCopy(garrison, lossRate * 0.82);
  }

  const recalculated = recalculateNationUnits(army);
  army.units = recalculated.units;
  army.armyGroups = recalculated.armyGroups;
}

function applyLossesCopy(units: ArmyUnits, lossRate: number) {
  const next = cloneUnits(units);
  applyLosses(next, lossRate);
  return next;
}

function getEngagedUnits(
  world: World,
  army: NationMilitary,
  groupIds: string[],
  provinceId: string,
) {
  const units = emptyUnits();
  const groupIdSet = new Set(groupIds);

  for (const group of army.armyGroups) {
    if (groupIdSet.has(group.id)) {
      addUnits(units, group.units);
    }
  }

  for (const city of world.cities) {
    if (city.nationId !== army.nationId || city.provinceId !== provinceId) {
      continue;
    }
    addUnits(units, army.cityGarrisons[city.id] ?? emptyUnits());
  }

  return units;
}

function applyEngagementLosses(
  world: World,
  army: NationMilitary,
  groupIds: string[],
  provinceId: string,
  lossRate: number,
) {
  const groupIdSet = new Set(groupIds);
  for (const group of army.armyGroups) {
    if (groupIdSet.has(group.id)) {
      applyLosses(group.units, lossRate * 1.08);
      if (totalUnits(group.units) <= 8) {
        group.units = emptyUnits();
      }
    }
  }

  for (const city of world.cities) {
    if (city.nationId !== army.nationId || city.provinceId !== provinceId) {
      continue;
    }
    army.cityGarrisons[city.id] = applyLossesCopy(
      army.cityGarrisons[city.id] ?? emptyUnits(),
      lossRate * 0.82,
    );
  }

  const recalculated = recalculateNationUnits(army);
  army.units = recalculated.units;
  army.armyGroups = recalculated.armyGroups;
}

function retreatGroups(
  world: World,
  army: NationMilitary,
  groupIds: string[],
  fromProvinceId: string,
  currentMonth: number,
) {
  if (groupIds.length === 0) {
    return;
  }

  const retreatProvinceId = pickRetreatProvince(world, army.nationId, fromProvinceId);
  if (!retreatProvinceId) {
    return;
  }

  const groupIdSet = new Set(groupIds);
  for (const group of army.armyGroups) {
    if (!groupIdSet.has(group.id) || totalUnits(group.units) <= 0) {
      continue;
    }

    group.destinationProvinceId = retreatProvinceId;
    group.locationProvinceId = retreatProvinceId;
    group.movementProgress = 0;
    group.pathProvinceIds = [];
    group.stance = "retreat";
    group.updatedAtMonth = currentMonth;
  }
}

function pickRetreatProvince(world: World, nationId: string, fromProvinceId: string) {
  const adjacency = buildProvinceAdjacency(world);
  const candidates = [...(adjacency.get(fromProvinceId) ?? [])]
    .map((provinceId) => world.provinceById.get(provinceId))
    .filter((province): province is Province => province?.nationId === nationId);

  return candidates
    .sort((a, b) => scoreTargetProvince(world, b) - scoreTargetProvince(world, a))[0]?.id;
}

function buildWarEvent({ currentMonth, ...event }: Omit<GameEvent, "month"> & { currentMonth: number }): GameEvent {
  return {
    ...event,
    month: currentMonth,
  };
}

function nationName(world: World, nationId: string) {
  return world.nationById.get(nationId)?.name ?? nationId;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function handleDeserters(
  world: World,
  military: MilitaryState,
  currentMonth: number,
): { military: MilitaryState; events: GameEvent[] } {
  const events: GameEvent[] = [];
  const nextMilitary = cloneMilitary(military);

  for (const nation of world.nations) {
    const army = nextMilitary[nation.id];
    if (!army) continue;

    const cities = world.cities.filter((c) => c.nationId === nation.id);
    const validCityIds = new Set(cities.map((c) => c.id));

    for (const group of army.armyGroups) {
      if (!validCityIds.has(group.originCityId ?? "")) {
        const deserters = group.units;
        const totalDeserters = totalUnits(deserters);
        if (totalDeserters > 0) {
          events.push(buildWarEvent({
            currentMonth,
            description: `${nationName(world, nation.id)} army group in ${world.provinceById.get(group.locationProvinceId)?.name ?? group.locationProvinceId} had deserters (${totalDeserters} soldiers) due to no valid home city.`,
            id: `event-desertion-${nation.id}-${group.id}-${currentMonth}`,
            kind: "desertion",
            nationIds: [nation.id],
            title: "Desertion",
          }));
          group.units = emptyUnits();
        }
      }
    }
  }

  return { military: nextMilitary, events };
}

function enforceProvinceMilitaryLimits(
  military: MilitaryState,
  world: World,
  eraStates: Record<string, string>,
): MilitaryState {
  const nextMilitary = cloneMilitary(military);

  for (const nation of world.nations) {
    const army = nextMilitary[nation.id];
    if (!army) continue;

    const era = eraStates[nation.id] ?? "stone";
    const provinceLimits = new Map<string, number>();

    for (const province of world.provinces) {
      if (province.nationId !== nation.id) continue;
      const limit = calculateProvinceMilitaryLimit(province.id, world, era);
      provinceLimits.set(province.id, limit.maxArmySize);
    }

    for (const group of army.armyGroups) {
      const maxSize = provinceLimits.get(group.locationProvinceId) ?? 0;
      if (maxSize > 0 && totalUnits(group.units) > maxSize) {
        const excess = totalUnits(group.units) - maxSize;
        group.units = takeUnits(group.units, totalUnits(group.units) - excess);
      }
    }

    const cityGarrisons = army.cityGarrisons;
    for (const [cityId, garrison] of Object.entries(cityGarrisons)) {
      const city = world.cityById.get(cityId);
      if (!city) continue;
      const province = world.provinceById.get(city.provinceId);
      if (!province) continue;
      const maxSize = calculateProvinceMilitaryLimit(province.id, world, era).maxArmySize;
      const totalGarrison = totalUnits(garrison);
      if (totalGarrison > maxSize) {
        cityGarrisons[cityId] = takeUnits(garrison, totalGarrison - maxSize);
      }
    }
  }

  return nextMilitary;
}
