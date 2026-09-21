/** Formato español: punto de miles, coma decimal. <1000 exacto, >=1000 en K, >=1M en M con espacio. */
export function formatPopulation(population: number): string {
  if (!Number.isFinite(population)) return "0";
  const p = Math.max(0, Math.round(population));
  if (p < 1000) return `${p}`;
  if (p < 1000000) return `${(p / 1000).toFixed(1).replace(".", ",")}K`;
  return `${(p / 1000000).toFixed(1).replace(".", ",")} M`;
}

function groupThousands(intPart: string): string {
  return intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

/** Enteros con punto de miles (ej: 1.234, 1.234.567). Siempre agrupa de 3. */
export function formatInteger(value: number): string {
  if (!Number.isFinite(value)) return "0";
  const rounded = Math.round(value);
  const sign = rounded < 0 ? "-" : "";
  return sign + groupThousands(String(Math.abs(rounded)));
}

/** Decimales con punto de miles y coma decimal (ej: 1.234,5). */
export function formatDecimal(value: number, digits: number): string {
  if (!Number.isFinite(value)) return (0).toFixed(digits).replace(".", ",");
  const fixed = value.toFixed(digits);
  const sign = fixed.startsWith("-") ? "-" : "";
  const unsigned = sign ? fixed.slice(1) : fixed;
  const [intPart, decPart] = unsigned.split(".");
  const grouped = groupThousands(intPart ?? "0");
  return decPart !== undefined ? `${sign}${grouped},${decPart}` : `${sign}${grouped}`;
}
