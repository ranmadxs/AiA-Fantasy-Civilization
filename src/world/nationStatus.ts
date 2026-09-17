import type { World } from "./types";

/**
 * 判断国家是否已经失去全部城市与人口。
 *
 * @param world 当前世界；战争结算会直接更新其中的城市归属
 * @param nationId 待检查的国家ID
 * @returns 没有任何归属城市且总人口为零时返回 true
 */
export function isNationDefeated(world: World, nationId: string) {
  const cities = world.cities.filter((city) => city.nationId === nationId);
  const population = cities.reduce((sum, city) => sum + city.population, 0);
  const provinces = world.provinces.filter((p) => p.nationId === nationId);
  return provinces.length === 0 || (cities.length === 0 && population <= 0);
}

/** 判断国家是否仍可参与经济、政策、外交、间谍和军事行动。 */
export function isNationActive(world: World, nationId: string) {
  return !isNationDefeated(world, nationId);
}

/** Fracción de tiles para victoria por dominación (sobre tierra con provincia). */
export const DOMINATION_VICTORY_SHARE = 0.98;
/** Share a partir del cual el líder se considera hegemón (las IA reaccionan). */
export const HEGEMONY_ALERT_SHARE = 0.7;
/** Share a partir del cual el líder acelera el rush final. */
export const VICTORY_RUSH_SHARE = 0.9;

export type DominationInfo = {
  leaderNationId?: string;
  leaderShare: number;
  shares: Record<string, number>;
  claimedTiles: number;
};

/** Share de tiles en provincias por nación (denominador: tierra con provincia). */
export function getDomination(world: World): DominationInfo {
  const tilesByNation = new Map<string, number>();
  let claimedTiles = 0;
  for (const tile of world.tiles) {
    const province = tile.provinceId ? world.provinceById.get(tile.provinceId) : undefined;
    if (!province?.nationId) {
      continue;
    }
    claimedTiles += 1;
    tilesByNation.set(province.nationId, (tilesByNation.get(province.nationId) ?? 0) + 1);
  }
  const shares: Record<string, number> = {};
  let leaderNationId: string | undefined;
  let leaderShare = 0;
  for (const [nationId, count] of tilesByNation) {
    const share = claimedTiles > 0 ? count / claimedTiles : 0;
    shares[nationId] = share;
    if (share > leaderShare) {
      leaderShare = share;
      leaderNationId = nationId;
    }
  }
  return { leaderNationId, leaderShare, shares, claimedTiles };
}

/** Victoria por dominación: alguna nación con >=98% de la tierra con provincia. */
export function checkDominationVictory(world: World): string | undefined {
  const { leaderNationId, leaderShare } = getDomination(world);
  if (leaderNationId && leaderShare >= DOMINATION_VICTORY_SHARE) {
    return leaderNationId;
  }
  return undefined;
}
