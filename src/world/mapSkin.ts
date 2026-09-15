/**
 * mapSkin — capa visual Tolkien/edge-blend sobre los tiles del mundo.
 *
 * 100% COSMÉTICA: solo lee `tiles`, nunca los muta. Provincias, recursos,
 * naciones y ciudades quedan idénticos con y sin skin (mismo seed → mismo mundo).
 *
 * Se ejecuta en `buildDemoWorld` justo después de `buildTiles` (tiles +
 * resourceAt + generateRivers ya listos) y justo antes de `chooseProvinceSeeds`.
 *
 * Disciplina de semilla: NO consume el `rng` principal (mulberry32 del seed).
 * Deriva su propio RNG `seedHash ^ 0x70CC1E` para el overlay, así el mundo
 * lógico es bit-idéntico al que se generaba antes de este módulo.
 */
import type { RiverTrail, Tile } from "./types";
// @ts-ignore — plugin JS puro (allowJs:false); verificado en runtime vía svg_generate.mjs
import { parseBiomeMap, buildTolkienSVG, createRNG } from "../../plugins/map-yard/index.js";

export const SKIN_TILE_SIZE = 10;
export const SKIN_PADDING = 2;
const SKIN_RNG_XOR = 0x70cc1e;

/** Misma paleta que scripts/svg_generate.mjs (la que entiende PALETTE_AIA). */
export const SKIN_TERRAIN_COLORS: Record<string, string> = {
  ocean: "#315f8f",
  coast: "#4a89a8",
  plain: "#88a95f",
  forest: "#477457",
  hill: "#9a8d65",
  mountain: "#7d7f85",
  desert: "#c9b06b",
  lake: "#2e7d9e",
};

export type MapSkin = {
  /** SVG pelado (solo rects de terreno). Input exacto del filtro. */
  baseSvg: string;
  /** Solo el overlay Tolkien (pergamino, costas, ríos, montañas…), sin el HTML envolvente. */
  overlaySvg: string;
  /** Conteo de celdas por bioma detectado. */
  biomeCounts: Record<string, number>;
  cols: number;
  rows: number;
  tileSize: number;
  mapPixelW: number;
  mapPixelH: number;
  /** Nº de ríos reales dibujados (trails de generateRivers). */
  riverCount: number;
};

function buildCleanSvgString(tiles: Tile[], width: number, height: number): { svg: string; mapPixelW: number; mapPixelH: number } {
  const W = width + 2;
  const H = height + 2;
  const mapPixelW = W * SKIN_TILE_SIZE;
  const mapPixelH = H * SKIN_TILE_SIZE;
  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${mapPixelW}" height="${mapPixelH}" viewBox="0 0 ${mapPixelW} ${mapPixelH}">`,
  ];
  for (const tile of tiles) {
    parts.push(
      `<rect x="${(SKIN_PADDING + tile.x) * SKIN_TILE_SIZE}" y="${(SKIN_PADDING + tile.y) * SKIN_TILE_SIZE}" width="${SKIN_TILE_SIZE}" height="${SKIN_TILE_SIZE}" fill="${SKIN_TERRAIN_COLORS[tile.terrain] ?? "#333"}"/>`,
    );
  }
  parts.push(`</svg>`);
  return { svg: parts.join(""), mapPixelW, mapPixelH };
}

/**
 * Genera el skin visual a partir de los tiles. Pura y determinista:
 * mismo (tiles, seedHash, trails) → mismo skin, siempre.
 * Los ríos se dibujan desde los trails reales (generateRivers), no procedurales.
 */
export function applyBaseMapSkin(
  tiles: Tile[],
  seedHash: number,
  dims: { width: number; height: number },
  trails: RiverTrail[] = [],
): MapSkin {
  const { svg: baseSvg, mapPixelW, mapPixelH } = buildCleanSvgString(tiles, dims.width, dims.height);
  const baseHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>${baseSvg}</body></html>`;

  const parsed = parseBiomeMap(baseHtml);
  const rng = createRNG((seedHash ^ SKIN_RNG_XOR) >>> 0);
  const terrainByCoord = new Map(tiles.map((t) => [`${t.x},${t.y}`, t.terrain]));
  const tolkienHtml: string = buildTolkienSVG(baseHtml, parsed.biomeMap, parsed.tileSize, rng, String(seedHash), {
    width: mapPixelW,
    height: mapPixelH,
    padding: SKIN_PADDING,
    realTrails: trails,
    terrainAt: (x: number, y: number) => terrainByCoord.get(`${x},${y}`),
  });

  // Extrae solo el overlay: buildTolkienSVG = pre + body(sin ríos base) + overlay + post.
  // Como el body de entrada es exactamente baseSvg, el overlay es lo que sobra.
  const bodyIdx = tolkienHtml.indexOf(baseSvg);
  let overlaySvg: string;
  if (bodyIdx >= 0) {
    const afterBody = bodyIdx + baseSvg.length;
    const closeIdx = tolkienHtml.lastIndexOf("</svg>");
    overlaySvg = tolkienHtml.slice(afterBody, closeIdx);
  } else {
    // Fallback: si el body fue alterado (strip de ríos base), usa todo tras el primer <svg…>.
    const openEnd = tolkienHtml.indexOf(">", tolkienHtml.indexOf("<svg")) + 1;
    overlaySvg = tolkienHtml.slice(openEnd, tolkienHtml.lastIndexOf("</svg>"));
  }

  const biomeCounts: Record<string, number> = {};
  for (const key of Object.values(parsed.biomeMap) as string[]) {
    biomeCounts[key] = (biomeCounts[key] ?? 0) + 1;
  }

  return {
    baseSvg,
    overlaySvg,
    biomeCounts,
    cols: parsed.cols,
    rows: parsed.rows,
    tileSize: parsed.tileSize,
    mapPixelW,
    mapPixelH,
    riverCount: trails.length,
  };
}
