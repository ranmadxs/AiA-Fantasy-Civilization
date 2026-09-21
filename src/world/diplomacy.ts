import { calculateNationCityEconomy } from "./cityEconomy";
import type { GameEvent } from "./events";
import type { Tile } from "./types";
import { isNationActive } from "./nationStatus";
import type { NationPolicies } from "./policyAI";
import { getAdjacentTiles, calculatePeacefulExpandCost, maxExpandsFor, peacefulExpandCostFor } from "./policyAI";
import type { ProvinceBuildings } from "./construction";
import { buildProvinceAdjacency, rebuildNationEdges } from "./war";
import { eraExploreDiscount, getNationEra } from "./era";
import type { EraState } from "./era";
import { getNationRelation, relationKey, type NationRelations } from "./relationships";
import type { Resource, World } from "./types";
import { ev, nationNameL, provinceNameL, type EventLang } from "./eventText";

export type WarState = {
  id: string;
  attackerNationId: string;
  defenderNationId: string;
  startedAtMonth: number;
  lastBattleMonth?: number;
  battleCount?: number;
  attackerScore?: number;
  defenderScore?: number;
  relationPenaltyAppliedMonth?: number;
  targetProvinceId?: string;
  expansionPolicy?: "control_city" | "decisive_battle" | "control_resource" | "peaceful_expand" | "none";
  targetNationIdForCapture?: string;
};

export type AllianceTreaty = {
  id: string;
  nationAId: string;
  nationBId: string;
  signedAtMonth: number;
  mutualDefense: boolean;
};

export type VassalContract = {
  id: string;
  overlordNationId: string;
  vassalNationId: string;
  signedAtMonth: number;
  goldTributeRate: number;
  resourceTributeRate: number;
};

export type TruceAgreement = {
  id: string;
  nationAId: string;
  nationBId: string;
  signedAtMonth: number;
  expiresAtMonth: number;
};

export type ProposalType = "alliance" | "peace" | "vassalage_offer" | "vassalage_demand";

export type PeaceTerms = "status_quo" | "reparations" | "cede_province";

export type DiplomaticProposal = {
  id: string;
  type: ProposalType;
  fromNationId: string;
  toNationId: string;
  createdAtMonth: number;
  expiresAtMonth: number;
  offeredGold?: number;
  offeredResources?: Partial<Record<Resource, number>>;
  requestedProvinceIds?: string[];
  peaceTerms?: PeaceTerms;
};

export type DiplomacyState = {
  wars: WarState[];
  alliances: AllianceTreaty[];
  vassalContracts: VassalContract[];
  truces: TruceAgreement[];
  proposals: DiplomaticProposal[];
};

export type NationDiplomacySummary = {
  wars: WarState[];
  alliances: AllianceTreaty[];
  overlordContract?: VassalContract;
  vassalContracts: VassalContract[];
  truces: TruceAgreement[];
  proposals: DiplomaticProposal[];
};

export type DiplomacyUpdate = {
  diplomacy: DiplomacyState;
  events: GameEvent[];
};

export function buildInitialDiplomacyState(_world: World): DiplomacyState {
  return {
    alliances: [],
    proposals: [],
    truces: [],
    vassalContracts: [],
    wars: [],
  };
}

export function executeDiplomacyPolicies(
  diplomacy: DiplomacyState,
  policies: NationPolicies,
  currentMonth: number,
): DiplomacyState {
  return executeDiplomacyPoliciesWithEvents(diplomacy, policies, undefined, currentMonth).diplomacy;
}

export function executeDiplomacyPoliciesWithEvents(
  diplomacy: DiplomacyState,
  policies: NationPolicies,
  world: World | undefined,
  currentMonth: number,
): DiplomacyUpdate {
  let changed = false;
  const events: GameEvent[] = [];
  const next: DiplomacyState = {
    alliances: [...diplomacy.alliances],
    proposals: diplomacy.proposals.filter((proposal) => proposal.expiresAtMonth > currentMonth),
    truces: diplomacy.truces.filter((truce) => truce.expiresAtMonth > currentMonth),
    vassalContracts: [...diplomacy.vassalContracts],
    wars: [...diplomacy.wars],
  };

  if (next.proposals.length !== diplomacy.proposals.length || next.truces.length !== diplomacy.truces.length) {
    changed = true;
  }

  for (const [nationId, policyState] of Object.entries(policies)) {
    if (policyState.decidedAtMonth !== currentMonth) {
      continue;
    }

    const diplomacyPolicy = policyState.diplomacy;
    const targetNationId = diplomacyPolicy.targetNationId;

    if (!targetNationId || nationId === targetNationId) {
      continue;
    }
    if (world && (!isNationActive(world, nationId) || !isNationActive(world, targetNationId))) {
      continue;
    }

    switch (diplomacyPolicy.policy) {
      case "declare_war":
        if (canDeclareWar(next, nationId, targetNationId, currentMonth, world)) {
          const nationPolicy = policies[nationId];
          next.wars.push({
            attackerNationId: nationId,
            defenderNationId: targetNationId,
            id: `war-${relationKey(nationId, targetNationId)}-${currentMonth}`,
            startedAtMonth: currentMonth,
            expansionPolicy: nationPolicy?.expansion?.policy,
            targetNationIdForCapture: nationPolicy?.expansion?.targetNationId ?? targetNationId,
          });
          events.push(buildDiplomacyEvent({
            currentMonth,
            description: `${nationName(world, nationId)} declared war on ${nationName(world, targetNationId)}.`,
            id: `event-war-${relationKey(nationId, targetNationId)}-${currentMonth}`,
            kind: "war_declared",
            nationIds: [nationId, targetNationId],
            title: "War Declared",
          }));
          changed = true;
        }
        break;
      case "seek_alliance":
        if (canProposeAlliance(next, nationId, targetNationId)) {
          const proposal = buildProposal("alliance", nationId, targetNationId, currentMonth);
          next.proposals.push(proposal);
          events.push(buildProposalEvent(proposal, world, currentMonth, "proposal_created"));
          changed = true;
        }
        break;
      case "seek_peace":
        if (areNationsAtWar(next, nationId, targetNationId) && !hasProposal(next, "peace", nationId, targetNationId)) {
          const proposal = {
            ...buildProposal("peace", nationId, targetNationId, currentMonth),
            peaceTerms: "status_quo",
          } satisfies DiplomaticProposal;
          next.proposals.push(proposal);
          events.push(buildProposalEvent(proposal, world, currentMonth, "proposal_created"));
          changed = true;
        }
        break;
      case "seek_vassalage":
        if (canProposeVassalage(next, nationId, targetNationId)) {
          const proposal = buildProposal("vassalage_offer", nationId, targetNationId, currentMonth);
          next.proposals.push(proposal);
          events.push(buildProposalEvent(proposal, world, currentMonth, "proposal_created"));
          changed = true;
        }
        break;
      case "demand_vassalage":
        if (canProposeVassalage(next, targetNationId, nationId)) {
          const proposal = buildProposal("vassalage_demand", nationId, targetNationId, currentMonth);
          next.proposals.push(proposal);
          events.push(buildProposalEvent(proposal, world, currentMonth, "proposal_created"));
          changed = true;
        }
        break;
      case "none":
      case "surrender":
        break;
    }
  }

  return {
    diplomacy: changed ? next : diplomacy,
    events,
  };
}

export function evaluateDiplomaticProposals(
  diplomacy: DiplomacyState,
  world: World,
  relations: NationRelations,
  currentMonth: number,
): DiplomacyState {
  return evaluateDiplomaticProposalsWithEvents(diplomacy, world, relations, currentMonth).diplomacy;
}

export function evaluateDiplomaticProposalsWithEvents(
  diplomacy: DiplomacyState,
  world: World,
  relations: NationRelations,
  currentMonth: number,
): DiplomacyUpdate {
  let changed = false;
  const events: GameEvent[] = [];
  const next: DiplomacyState = {
    alliances: [...diplomacy.alliances],
    proposals: [],
    truces: diplomacy.truces.filter((truce) => truce.expiresAtMonth > currentMonth),
    vassalContracts: [...diplomacy.vassalContracts],
    wars: [...diplomacy.wars],
  };

  if (next.truces.length !== diplomacy.truces.length) {
    changed = true;
  }

  const treatyMaintenanceEvents = maintainLongTermTreaties(next, world, relations, currentMonth);
  if (treatyMaintenanceEvents.length > 0) {
    events.push(...treatyMaintenanceEvents);
    changed = true;
  }

  for (const proposal of diplomacy.proposals) {
    if (!isNationActive(world, proposal.fromNationId) || !isNationActive(world, proposal.toNationId)) {
      changed = true;
      continue;
    }

    if (proposal.expiresAtMonth <= currentMonth) {
      changed = true;
      continue;
    }

    if (currentMonth <= proposal.createdAtMonth) {
      next.proposals.push(proposal);
      continue;
    }

    if (shouldAcceptProposal(proposal, next, world, relations, currentMonth)) {
      const acceptedEvents = applyAcceptedProposal(proposal, next, world, currentMonth);
      events.push(buildProposalEvent(proposal, world, currentMonth, "proposal_accepted"), ...acceptedEvents);
      changed = true;
      continue;
    }

    changed = true;
  }

  return {
    diplomacy: changed ? next : diplomacy,
    events,
  };
}

export function getNationDiplomacySummary(
  diplomacy: DiplomacyState,
  nationId: string,
): NationDiplomacySummary {
  return {
    alliances: diplomacy.alliances.filter((alliance) =>
      treatyIncludesNation(alliance.nationAId, alliance.nationBId, nationId),
    ),
    overlordContract: diplomacy.vassalContracts.find((contract) => contract.vassalNationId === nationId),
    proposals: diplomacy.proposals.filter((proposal) =>
      proposal.fromNationId === nationId || proposal.toNationId === nationId,
    ),
    truces: diplomacy.truces.filter((truce) =>
      treatyIncludesNation(truce.nationAId, truce.nationBId, nationId),
    ),
    vassalContracts: diplomacy.vassalContracts.filter((contract) => contract.overlordNationId === nationId),
    wars: diplomacy.wars.filter((war) =>
      treatyIncludesNation(war.attackerNationId, war.defenderNationId, nationId),
    ),
  };
}

export function areNationsAtWar(
  diplomacy: DiplomacyState,
  nationAId: string,
  nationBId: string,
) {
  return diplomacy.wars.some((war) =>
    relationKey(war.attackerNationId, war.defenderNationId) === relationKey(nationAId, nationBId),
  );
}

export function areNationsAllied(
  diplomacy: DiplomacyState,
  nationAId: string,
  nationBId: string,
) {
  return diplomacy.alliances.some((alliance) =>
    relationKey(alliance.nationAId, alliance.nationBId) === relationKey(nationAId, nationBId),
  );
}

export function hasActiveTruce(
  diplomacy: DiplomacyState,
  nationAId: string,
  nationBId: string,
  currentMonth: number,
) {
  return diplomacy.truces.some((truce) =>
    relationKey(truce.nationAId, truce.nationBId) === relationKey(nationAId, nationBId) &&
    truce.expiresAtMonth > currentMonth,
  );
}

export function getOtherTreatyNationId(
  nationAId: string,
  nationBId: string,
  perspectiveNationId: string,
) {
  return nationAId === perspectiveNationId ? nationBId : nationAId;
}

export function formatProposalType(type: ProposalType) {
  switch (type) {
    case "alliance":
      return "Alliance Request";
    case "peace":
      return "Peace Offer";
    case "vassalage_demand":
      return "Vassalage Demand";
    case "vassalage_offer":
      return "Vassalage Offer";
  }
}

function shouldAcceptProposal(
  proposal: DiplomaticProposal,
  diplomacy: DiplomacyState,
  world: World,
  relations: NationRelations,
  currentMonth: number,
) {
  const relation = getNationRelation(relations, proposal.fromNationId, proposal.toNationId);
  const attitude = relation?.attitude ?? 0;
  const proposerPower = calculateNationPower(world, proposal.fromNationId);
  const receiverPower = calculateNationPower(world, proposal.toNationId);

  switch (proposal.type) {
    case "alliance":
      return (
        attitude >= 45 &&
        !areNationsAtWar(diplomacy, proposal.fromNationId, proposal.toNationId) &&
        !areNationsAllied(diplomacy, proposal.fromNationId, proposal.toNationId) &&
        !hasVassalTie(diplomacy, proposal.fromNationId, proposal.toNationId)
      );
    case "peace": {
      const war = diplomacy.wars.find((existingWar) =>
        relationKey(existingWar.attackerNationId, existingWar.defenderNationId) ===
        relationKey(proposal.fromNationId, proposal.toNationId),
      );
      const warAge = war ? currentMonth - war.startedAtMonth : 0;
      const receiverIsWeaker = receiverPower < proposerPower * 0.86;

      return Boolean(war) && (attitude >= -35 || warAge >= 6 || receiverIsWeaker);
    }
    case "vassalage_offer":
      return (
        attitude >= -10 &&
        proposerPower < receiverPower * 0.9 &&
        !hasVassalTie(diplomacy, proposal.fromNationId, proposal.toNationId)
      );
    case "vassalage_demand":
      return (
        receiverPower < proposerPower * 0.62 ||
        (attitude >= 35 && receiverPower < proposerPower * 0.82)
      ) && !hasVassalTie(diplomacy, proposal.fromNationId, proposal.toNationId);
  }
}

function applyAcceptedProposal(
  proposal: DiplomaticProposal,
  diplomacy: DiplomacyState,
  world: World,
  currentMonth: number,
) {
  const events: GameEvent[] = [];

  switch (proposal.type) {
    case "alliance":
      if (!areNationsAllied(diplomacy, proposal.fromNationId, proposal.toNationId)) {
        diplomacy.alliances.push({
          id: `alliance-${relationKey(proposal.fromNationId, proposal.toNationId)}-${currentMonth}`,
          mutualDefense: true,
          nationAId: proposal.fromNationId,
          nationBId: proposal.toNationId,
          signedAtMonth: currentMonth,
        });
        events.push(buildDiplomacyEvent({
          currentMonth,
          description: `${nationName(world, proposal.fromNationId)} and ${nationName(world, proposal.toNationId)} signed a mutual defense alliance.`,
          id: `event-alliance-${relationKey(proposal.fromNationId, proposal.toNationId)}-${currentMonth}`,
          kind: "alliance_signed",
          nationIds: [proposal.fromNationId, proposal.toNationId],
          title: "Alliance Signed",
        }));
      }
      break;
    case "peace":
      diplomacy.wars = diplomacy.wars.filter((war) =>
        relationKey(war.attackerNationId, war.defenderNationId) !==
        relationKey(proposal.fromNationId, proposal.toNationId),
      );
      diplomacy.truces.push({
        expiresAtMonth: currentMonth + 24,
        id: `truce-${relationKey(proposal.fromNationId, proposal.toNationId)}-${currentMonth}`,
        nationAId: proposal.fromNationId,
        nationBId: proposal.toNationId,
        signedAtMonth: currentMonth,
      });
      events.push(buildDiplomacyEvent({
        currentMonth,
        description: `${nationName(world, proposal.fromNationId)} and ${nationName(world, proposal.toNationId)} agreed to a 24-month truce.`,
        id: `event-truce-${relationKey(proposal.fromNationId, proposal.toNationId)}-${currentMonth}`,
        kind: "truce_signed",
        nationIds: [proposal.fromNationId, proposal.toNationId],
        title: "Truce Signed",
      }));
      break;
    case "vassalage_offer":
      diplomacy.vassalContracts.push({
        goldTributeRate: 0.12,
        id: `vassal-${proposal.toNationId}-${proposal.fromNationId}-${currentMonth}`,
        overlordNationId: proposal.toNationId,
        resourceTributeRate: 0.08,
        signedAtMonth: currentMonth,
        vassalNationId: proposal.fromNationId,
      });
      events.push(buildDiplomacyEvent({
        currentMonth,
        description: `${nationName(world, proposal.fromNationId)} became a vassal of ${nationName(world, proposal.toNationId)}.`,
        id: `event-vassal-${proposal.toNationId}-${proposal.fromNationId}-${currentMonth}`,
        kind: "vassalage_signed",
        nationIds: [proposal.fromNationId, proposal.toNationId],
        title: "Vassalage Accepted",
      }));
      break;
    case "vassalage_demand":
      diplomacy.vassalContracts.push({
        goldTributeRate: 0.16,
        id: `vassal-${proposal.fromNationId}-${proposal.toNationId}-${currentMonth}`,
        overlordNationId: proposal.fromNationId,
        resourceTributeRate: 0.1,
        signedAtMonth: currentMonth,
        vassalNationId: proposal.toNationId,
      });
      events.push(buildDiplomacyEvent({
        currentMonth,
        description: `${nationName(world, proposal.toNationId)} submitted to ${nationName(world, proposal.fromNationId)} as a vassal.`,
        id: `event-vassal-${proposal.fromNationId}-${proposal.toNationId}-${currentMonth}`,
        kind: "vassalage_signed",
        nationIds: [proposal.fromNationId, proposal.toNationId],
        title: "Vassalage Accepted",
      }));
      break;
  }

  return events;
}

function maintainLongTermTreaties(
  diplomacy: DiplomacyState,
  world: World,
  relations: NationRelations,
  currentMonth: number,
) {
  const events: GameEvent[] = [];

  diplomacy.alliances = diplomacy.alliances.filter((alliance) => {
    if (!isNationActive(world, alliance.nationAId) || !isNationActive(world, alliance.nationBId)) {
      return false;
    }

    const age = currentMonth - alliance.signedAtMonth;
    const relation = getNationRelation(relations, alliance.nationAId, alliance.nationBId);
    if (age < 144 || (relation?.attitude ?? 0) >= 20) {
      return true;
    }

    events.push(buildDiplomacyEvent({
      currentMonth,
      description: `${nationName(world, alliance.nationAId)} and ${nationName(world, alliance.nationBId)} dissolved their alliance after relations cooled.`,
      id: `event-alliance-dissolved-${alliance.id}-${currentMonth}`,
      kind: "alliance_dissolved",
      nationIds: [alliance.nationAId, alliance.nationBId],
      title: "Alliance Dissolved",
    }));
    return false;
  });

  diplomacy.vassalContracts = diplomacy.vassalContracts.filter((contract) => {
    if (!isNationActive(world, contract.overlordNationId) || !isNationActive(world, contract.vassalNationId)) {
      return false;
    }

    const age = currentMonth - contract.signedAtMonth;
    if (age < 120) {
      return true;
    }

    const relation = getNationRelation(relations, contract.overlordNationId, contract.vassalNationId);
    const overlordPower = calculateNationPower(world, contract.overlordNationId);
    const vassalPower = calculateNationPower(world, contract.vassalNationId);
    const shouldBreak =
      (relation?.attitude ?? 0) <= -45 ||
      vassalPower >= overlordPower * 0.72;

    if (!shouldBreak) {
      return true;
    }

    events.push(buildDiplomacyEvent({
      currentMonth,
      description: `${nationName(world, contract.vassalNationId)} broke vassalage with ${nationName(world, contract.overlordNationId)}.`,
      id: `event-vassal-broken-${contract.id}-${currentMonth}`,
      kind: "vassalage_broken",
      nationIds: [contract.overlordNationId, contract.vassalNationId],
      title: "Vassalage Broken",
    }));

    if (!areNationsAtWar(diplomacy, contract.overlordNationId, contract.vassalNationId)) {
      diplomacy.wars.push({
        attackerNationId: contract.vassalNationId,
        defenderNationId: contract.overlordNationId,
        id: `war-rebellion-${relationKey(contract.overlordNationId, contract.vassalNationId)}-${currentMonth}`,
        startedAtMonth: currentMonth,
      });
      events.push(buildDiplomacyEvent({
        currentMonth,
        description: `${nationName(world, contract.vassalNationId)} rebelled against ${nationName(world, contract.overlordNationId)}.`,
        id: `event-vassal-rebellion-${contract.id}-${currentMonth}`,
        kind: "war_declared",
        nationIds: [contract.overlordNationId, contract.vassalNationId],
        title: "Vassal Rebellion",
      }));
    }

    return false;
  });

  return events;
}

function treatyIncludesNation(nationAId: string, nationBId: string, nationId: string) {
  return nationAId === nationId || nationBId === nationId;
}

function calculateNationPower(world: World, nationId: string) {
  const economy = calculateNationCityEconomy(nationId, world);
  const provinceCount = world.provinces.filter((province) => province.nationId === nationId).length;
  const cityCount = world.cities.filter((city) => city.nationId === nationId).length;

  return economy.army + economy.monthlyGold * 20 + economy.population / 20 + provinceCount * 80 + cityCount * 260;
}

function buildProposal(
  type: ProposalType,
  fromNationId: string,
  toNationId: string,
  currentMonth: number,
): DiplomaticProposal {
  return {
    createdAtMonth: currentMonth,
    expiresAtMonth: currentMonth + 6,
    fromNationId,
    id: `proposal-${type}-${relationKey(fromNationId, toNationId)}-${currentMonth}`,
    toNationId,
    type,
  };
}

function canDeclareWar(
  diplomacy: DiplomacyState,
  nationAId: string,
  nationBId: string,
  currentMonth: number,
  world?: World,
) {
  return (
    !areNationsAtWar(diplomacy, nationAId, nationBId) &&
    !areNationsAllied(diplomacy, nationAId, nationBId) &&
    !hasVassalTie(diplomacy, nationAId, nationBId) &&
    !hasActiveTruce(diplomacy, nationAId, nationBId, currentMonth)
  );
}

/** Anexión pacífica de ciudades: solo cambian de dueño las que están
 * en la provincia anexada y cuya nación NO está activa (sin dueño con
 * quien pelear). Las de naciones activas requieren guerra y se respetan. */
export function annexProvinceCities(
  world: World,
  provinceId: string,
  nationId: string,
): { flipped: string[]; skipped: string[] } {
  const flipped: string[] = [];
  const skipped: string[] = [];
  for (const city of world.cities) {
    if (city.provinceId !== provinceId || city.nationId === nationId) continue;
    if (isNationActive(world, city.nationId)) {
      skipped.push(city.id);
      continue;
    }
    city.nationId = nationId;
    flipped.push(city.id);
  }
  return { flipped, skipped };
}

export function executePeacefulExpansion(
  world: World,
  policies: NationPolicies,
  stockpiles: Record<string, {gold: number; water: number; resources: Record<string, number>}>,
  currentMonth: number,
  provinceBuildings?: ProvinceBuildings,
  eraStates?: Record<string, EraState>,
  lang?: EventLang,
): { events: GameEvent[]; mapChanged: boolean } {
  const events: GameEvent[] = [];
  let mapChanged = false;
  const adjacency = buildProvinceAdjacency(world);
  for (const [nationId, policyState] of Object.entries(policies)) {
    if (policyState.expansion.policy !== "peaceful_expand") {
      continue;
    }
    if (policyState.decidedAtMonth > currentMonth) continue;
    if (!isNationActive(world, nationId)) continue;
    const nationStockpile = stockpiles[nationId] ?? {gold: 0, water: 0, resources: {}};
    const adjacentTiles = getAdjacentTiles(world, nationId);
    // Solo territorio neutral: robar provincias enemigas requiere guerra (war.ts).
    // Se excluyen tiles de provincias con ciudades de naciones activas: eso
    // sí tendría con quién pelear y no entra por vía pacífica.
    let expandableTiles = adjacentTiles.filter((tile) => {
      const province = tile.provinceId ? world.provinceById.get(tile.provinceId) : undefined;
      if (!province) return false;
      if (province.nationId !== undefined) return false;
      const hasActiveForeignCity = world.cities.some(
        (c) => c.provinceId === province.id && c.nationId !== nationId && isNationActive(world, c.nationId),
      );
      return !hasActiveForeignCity;
    });

    if (expandableTiles.length === 0) {
      expandableTiles = findNearestFreeTile(world, nationId);
    }
    if (expandableTiles.length === 0) {
      continue;
    }

    // Buff de establo + escalado fase 1: cupo 2 base, 3 con 1 establo
    // vecino, 4 con ≥2. Costo n-ésima ×(1+0.25×(n-1)). Era acumulativo.
    const eraDiscount = eraExploreDiscount(getNationEra(nationId, eraStates ?? {}));
    const stableProvinces = new Set(
      world.provinces
        .filter((p) => p.nationId === nationId && provinceBuildings?.[p.id]?.stable === true)
        .map((p) => p.id),
    );
    const stableCountFor = (provinceId: string | undefined): number => {
      const neighbors = [...(adjacency.get(provinceId ?? "") ?? [])];
      return neighbors.filter((id) => stableProvinces.has(id)).length;
    };
    const turnCap = Math.max(2, ...expandableTiles.map((t) => maxExpandsFor(stableCountFor(t.provinceId))));
    let expands = 0;
    for (const tile of expandableTiles) {
      if (expands >= turnCap) break;
      const stableNeighbors = stableCountFor(tile.provinceId);
      const fromStable = stableNeighbors >= 1;
      const province = tile.provinceId ? world.provinceById.get(tile.provinceId) : undefined;
      if (!province || province.nationId !== undefined) continue;
      const baseCost = calculatePeacefulExpandCost(tile, world, fromStable, 1);
      if (!Number.isFinite(baseCost.gold)) continue;
      const scaledGold = peacefulExpandCostFor(expands + 1, fromStable, eraDiscount);
      if (nationStockpile.gold < scaledGold) continue;

      province.nationId = nationId;
      // Anexión pacífica: las ciudades sin nación activa pasan al colonizador
      // (no hay con quién pelear); las de naciones activas se respetan.
      const annexed = annexProvinceCities(world, province.id, nationId);
      if (annexed.flipped.length > 0) {
        const names = annexed.flipped.map((id) => {
          const c = world.cityById.get(id);
          return c ? ev(lang, c.name, c.nameEs ?? c.name) : id;
        });
        events.push({
          id: `event-peaceful-annex-${province.id}-${nationId}-${currentMonth}`,
          month: currentMonth,
          kind: "peaceful_expand",
          title: ev(lang, "Peaceful Annexation", "Anexión pacífica"),
          description: ev(lang,
            `${nationNameL(world, nationId, lang)} peacefully annexed ${names.join(", ")} in ${provinceNameL(world, province.id, lang)} (no owner to fight).`,
            `${nationNameL(world, nationId, lang)} anexó pacíficamente ${names.join(", ")} en ${provinceNameL(world, province.id, lang)} (sin dueño con quien pelear).`),
          nationIds: [nationId],
          ...(lang ? { lang } : {}),
        });
      }
      nationStockpile.gold -= scaledGold;
      rebuildNationEdges(world);
      (world as any).mapRevision = ((world as any).mapRevision || 0) + 1;
      mapChanged = true;
      expands += 1;

      // Sin tributo de vuelta: colonizar cuesta, no genera oro neto (fix exploit).
      events.push({
        month: currentMonth,
        nationIds: [nationId],
        kind: "peaceful_expand",
        title: ev(lang, "Peaceful Expansion", "Expansión Pacífica"),
        description: ev(lang,
          `${nationName(world, nationId)} peacefully colonized ${province.name} (neutral territory) for ${scaledGold} gold${fromStable ? " (establo: mitad de costo)" : ""}${eraDiscount < 1 ? ` (era: dto. ${Math.round((1 - eraDiscount) * 100)}%)` : ""}${expands > 1 ? ` (escalado ×${(1 + 0.25 * (expands - 1)).toFixed(2)})` : ""}.`,
          `${nationNameL(world, nationId, lang)} colonizó pacíficamente ${ev(lang, province.name, province.nameEs ?? province.name)} (territorio neutral) por ${scaledGold} oro${fromStable ? " (establo: mitad de costo)" : ""}${eraDiscount < 1 ? ` (era: dto. ${Math.round((1 - eraDiscount) * 100)}%)` : ""}${expands > 1 ? ` (escalado ×${(1 + 0.25 * (expands - 1)).toFixed(2)})` : ""}.`),
        id: `peaceful-expand-${nationId}-${province.id}-${currentMonth}`,
        ...(lang ? { lang } : {}),
      } as any);
    }
  }
  return { events, mapChanged };
}

function findNearestFreeTile(world: World, nationId: string): Tile[] {
  const nationProvinceIds = new Set(world.provinces.filter(p => p.nationId === nationId).map(p => p.id));
  const adjacency = buildProvinceAdjacency(world);
  const visited = new Set<string>();
  const queue: string[] = [];
  const result: Tile[] = [];

  for (const provinceId of nationProvinceIds) {
    queue.push(provinceId);
    visited.add(provinceId);
  }

  while (queue.length > 0 && result.length < 5) {
    const provinceId = queue.shift()!;
    const province = world.provinceById.get(provinceId);
    if (!province) continue;

    const tile = world.tiles.find(t => t.provinceId === provinceId);
    if (tile && province.nationId === undefined) {
      result.push(tile);
    }

    for (const neighborId of adjacency.get(provinceId) ?? []) {
      if (!visited.has(neighborId)) {
        visited.add(neighborId);
        queue.push(neighborId);
      }
    }
  }

  return result;
}

function areAdjacentNations(world: World, nationAId: string, nationBId: string) {
  const tileByCoord = new Map(world.tiles.map((tile) => [`${tile.x},${tile.y}`, tile]));

  for (const tile of world.tiles) {
    const province = tile.provinceId ? world.provinceById.get(tile.provinceId) : undefined;
    if (province?.nationId !== nationAId) {
      continue;
    }

    const neighbors = [
      tileByCoord.get(`${tile.x + 1},${tile.y}`),
      tileByCoord.get(`${tile.x - 1},${tile.y}`),
      tileByCoord.get(`${tile.x},${tile.y + 1}`),
      tileByCoord.get(`${tile.x},${tile.y - 1}`),
    ];
    if (neighbors.some((neighbor) => {
      const neighborProvince = neighbor?.provinceId ? world.provinceById.get(neighbor.provinceId) : undefined;
      return neighborProvince?.nationId === nationBId;
    })) {
      return true;
    }
  }

  return false;
}

function canProposeAlliance(
  diplomacy: DiplomacyState,
  nationAId: string,
  nationBId: string,
) {
  return (
    !areNationsAtWar(diplomacy, nationAId, nationBId) &&
    !areNationsAllied(diplomacy, nationAId, nationBId) &&
    !hasVassalTie(diplomacy, nationAId, nationBId) &&
    !hasProposal(diplomacy, "alliance", nationAId, nationBId)
  );
}

function canProposeVassalage(
  diplomacy: DiplomacyState,
  vassalNationId: string,
  overlordNationId: string,
) {
  return (
    !areNationsAtWar(diplomacy, vassalNationId, overlordNationId) &&
    !areNationsAllied(diplomacy, vassalNationId, overlordNationId) &&
    !hasVassalTie(diplomacy, vassalNationId, overlordNationId) &&
    !hasProposal(diplomacy, "vassalage_offer", vassalNationId, overlordNationId) &&
    !hasProposal(diplomacy, "vassalage_demand", overlordNationId, vassalNationId)
  );
}

function hasVassalTie(
  diplomacy: DiplomacyState,
  nationAId: string,
  nationBId: string,
) {
  return diplomacy.vassalContracts.some((contract) =>
    relationKey(contract.overlordNationId, contract.vassalNationId) === relationKey(nationAId, nationBId),
  );
}

function hasProposal(
  diplomacy: DiplomacyState,
  type: ProposalType,
  nationAId: string,
  nationBId: string,
) {
  return diplomacy.proposals.some((proposal) =>
    proposal.type === type &&
    relationKey(proposal.fromNationId, proposal.toNationId) === relationKey(nationAId, nationBId),
  );
}

function buildProposalEvent(
  proposal: DiplomaticProposal,
  world: World | undefined,
  currentMonth: number,
  kind: "proposal_accepted" | "proposal_created",
): GameEvent {
  const proposalLabel = formatProposalType(proposal.type);
  const action = {
    proposal_accepted: "accepted",
    proposal_created: "created",
  }[kind];

  return buildDiplomacyEvent({
    currentMonth,
    description: `${proposalLabel} from ${nationName(world, proposal.fromNationId)} to ${nationName(world, proposal.toNationId)} was ${action}.`,
    id: `event-${kind}-${proposal.id}-${currentMonth}`,
    kind,
    nationIds: [proposal.fromNationId, proposal.toNationId],
    title: `${proposalLabel} ${capitalize(action)}`,
  });
}

function buildDiplomacyEvent({
  currentMonth,
  description,
  id,
  kind,
  nationIds,
  title,
}: {
  currentMonth: number;
  description: string;
  id: string;
  kind: GameEvent["kind"];
  nationIds: string[];
  title: string;
}): GameEvent {
  return {
    description,
    id,
    kind,
    month: currentMonth,
    nationIds,
    title,
  };
}

function nationName(world: World | undefined, nationId: string) {
  return world?.nationById.get(nationId)?.name ?? nationId;
}

/**
 * Devuelve las provincias fronterizas de una nación:
 * provincias propias que colindan con al menos una provincia enemiga.
 * Solo estas pueden ser atacadas por el LLM.
 */
export function getFrontierProvinces(nationId: string, world: World, diplomacy: DiplomacyState): World["provinces"] {
  const adjacency = buildProvinceAdjacency(world);
  const enemyNationIds = new Set<string>();
  for (const war of diplomacy.wars) {
    if (war.attackerNationId === nationId) enemyNationIds.add(war.defenderNationId);
    else if (war.defenderNationId === nationId) enemyNationIds.add(war.attackerNationId);
  }
  if (enemyNationIds.size === 0) return [];

  return world.provinces.filter((p) => {
    if (p.nationId !== nationId) return false;
    const neighbors = adjacency.get(p.id) ?? new Set();
    for (const neighborId of neighbors) {
      const neighbor = world.provinceById.get(neighborId);
      if (neighbor && neighbor.nationId && enemyNationIds.has(neighbor.nationId)) return true;
    }
    return false;
  });
}

/** Objetivo atacable: provincia de otro dueño adyacente a territorio propio.
 * (Ojo: getFrontierProvinces devuelve las propias; esto valida la enemiga.) */
export function isAttackableFrontier(world: World, nationId: string, provinceId: string): boolean {
  const province = world.provinceById.get(provinceId);
  if (!province?.nationId || province.nationId === nationId) return false;
  const adjacency = buildProvinceAdjacency(world);
  const own = new Set(
    world.provinces.filter((p) => p.nationId === nationId).map((p) => p.id),
  );
  return [...(adjacency.get(provinceId) ?? [])].some((id) => own.has(id));
}

function capitalize(value: string) {  return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}
