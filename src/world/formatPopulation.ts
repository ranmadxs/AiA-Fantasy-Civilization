/** Formato de población: <1000 exacto, >=1000 en K, >=1M en M con espacio. */
export function formatPopulation(population: number): string {
  if (!Number.isFinite(population)) return "0";
  const p = Math.max(0, Math.round(population));
  if (p < 1000) return `${p}`;
  if (p < 1000000) return `${(p / 1000).toFixed(1)}K`;
  return `${(p / 1000000).toFixed(1)} M`;
}
