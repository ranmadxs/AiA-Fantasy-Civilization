import { getLocalizedName, type Language } from "./localization";
import type { City } from "./types";

export type SettlementKind = "pueblo" | "ciudad" | "reino";

/** Etiqueta de ciudad en el mapa: nombre + nivel. */
export function formatCityMapLabel(
  city: Pick<City, "name" | "nameEn" | "nameZh" | "nameEs" | "level">,
  language: Language,
): string {
  return `${getLocalizedName(city, language)} · Nv${city.level ?? 1}`;
}

/** Radio del punto en el mapa político (la capital usa icono aparte). */
export function cityDotRadius(city: Pick<City, "tipo">): number {
  return (city.tipo ?? "pueblo") === "ciudad" ? 3.6 : 2.6;
}

/** Alfa del sombreado de huella real por tipo de asentamiento. */
export function footprintAlphaFor(kind: SettlementKind): number {
  if (kind === "reino") return 0.95;
  if (kind === "ciudad") return 0.9;
  return 0.88;
}

/** Tiles ocupados realmente por un dueño (ciudad o reino vía reservedBy). */
export function tilesForOwner(
  tiles: Array<{ x: number; y: number; reservedBy?: string }>,
  ownerId: string,
): Array<{ x: number; y: number }> {
  const out: Array<{ x: number; y: number }> = [];
  for (const t of tiles) {
    if (t.reservedBy === ownerId) out.push({ x: t.x, y: t.y });
  }
  return out;
}
