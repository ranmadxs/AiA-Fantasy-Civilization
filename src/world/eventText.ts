import type { City, Nation, Province, World } from "./types";

/** Idioma de generación de eventos en la fuente (vía B). Solo EN+ES por ahora. */
export type EventLang = "en" | "es";

/** Elige texto según idioma: la sim genera el string final, sin regex después. */
export function ev(lang: EventLang | undefined, en: string, es: string): string {
  return lang === "es" ? es : en;
}

function pickName(
  entity: Pick<Nation, "name" | "nameEs"> | Pick<Province, "name" | "nameEs"> | Pick<City, "name" | "nameEs"> | undefined,
  fallbackId: string,
  lang: EventLang | undefined,
): string {
  if (!entity) return fallbackId;
  if (lang === "es") return entity.nameEs ?? entity.name ?? fallbackId;
  return entity.name ?? fallbackId;
}

/** Nombre de nación localizado en la fuente (ES → nameEs). */
export function nationNameL(world: World, nationId: string, lang: EventLang | undefined): string {
  return pickName(world.nationById.get(nationId), nationId, lang);
}

/** Nombre de provincia localizado en la fuente (ES → nameEs). */
export function provinceNameL(world: World, provinceId: string, lang: EventLang | undefined): string {
  return pickName(world.provinceById.get(provinceId), provinceId, lang);
}

/** Nombre de ciudad localizado en la fuente (ES → nameEs). */
export function cityNameL(world: World, cityId: string, lang: EventLang | undefined): string {
  const city = world.cityById.get(cityId);
  if (!city) return cityId;
  if (lang === "es") return city.nameEs ?? city.name ?? cityId;
  return city.name ?? cityId;
}

/** Postura de ejército como sustantivo en minúsculas (coherente con staticEs). */
const STANCE_ES: Record<string, string> = {
  attack: "ataque",
  defend: "defensa",
  garrison: "guarnición",
  raid: "incursión",
  rally: "reunión",
  retreat: "retirada",
};

/** Etiqueta de postura para descripciones generadas en fuente. */
export function stanceLabelL(stance: string, lang: EventLang | undefined): string {
  if (lang === "es") return STANCE_ES[stance] ?? stance;
  return stance;
}
