/**
 * worldSvg — renderer SVG ÚNICO para todos los scripts de AiA.
 *
 * Antes cada script (svg_generate, init_world_002/003/004) traía su propia
 * copia del generador y solo svg_generate inyectaba el overlay Tolkien
 * (bug: los map_year_N.html del 004 salían sin filtros).
 *
 * Ahora: buildDemoWorld calcula world.mapSkin (genérico) y ESTE módulo es el
 * único que lo dibuja, vía generateWorldSVG(world, { withTolkien }).
 * Las diferencias cosméticas entre scripts van por opts, no por copias.
 */

export const TILE_SIZE = 10;
export const PADDING = 2;
export const TERRAIN_COLORS = {
  ocean: "#315f8f",
  coast: "#4a89a8",
  plain: "#88a95f",
  forest: "#477457",
  hill: "#9a8d65",
  mountain: "#7d7f85",
  desert: "#c9b06b",
  lake: "#2e7d9e",
};

/** O(p + t): provinceId -> nationId, luego 1 pasada por tiles. */
export function buildTileNationMap(world) {
  const provinceNation = new Map();
  for (const province of world.provinces) {
    if (province.nationId) provinceNation.set(province.id, province.nationId);
  }
  const tileNationMap = new Map();
  for (const tile of world.tiles) {
    const nid = provinceNation.get(tile.provinceId);
    if (nid) tileNationMap.set(`${tile.x},${tile.y}`, nid);
  }
  return tileNationMap;
}

/**
 * Renderiza el mundo a SVG.
 * @param {object} world mundo de buildDemoWorld (con mapSkin opcional)
 * @param {object} opts
 *   withTolkien: incrusta world.mapSkin.overlaySvg (default true)
 *   neon: grupo neon-borders animado (default false; lo usa svg_generate)
 *   deadMarkers: calaveras de naciones derrotadas (default false; lo usa svg_generate)
 *   aliveOpacity/neutralOpacity: opacidad de los tiles de nación (004: 0.3/0.05)
 *   nationStroke: borde por tile de nación (004: false)
 *   background: rect de fondo (004: null, usa backgroundStyle)
 *   backgroundStyle: style del <svg> cuando no hay rect de fondo (004: "background: #1a2332;")
 *   svgId/svgExtraStyle: attrs del <svg> (svg_generate: id + display fijo)
 *   riverWidth: rect de río ancho (004: true)
 *   skipLakeRivers: no dibuja río sobre lagos (004: true)
 */
export function generateWorldSVG(world, opts = {}) {
  const {
    withTolkien = true,
    neon = false,
    deadMarkers = false,
    aliveOpacity = 0.45,
    neutralOpacity = 0.1,
    nationStroke = true,
    background = "#132028",
    backgroundStyle = null,
    svgId = null,
    svgExtraStyle = "",
    riverWidth = false,
    skipLakeRivers = false,
  } = opts;

  const W = world.width + 2;
  const H = world.height + 2;
  const terrainColors = TERRAIN_COLORS;
  const padding = PADDING;

  const tileNationMap = buildTileNationMap(world);

  const allTileKeys = new Set();
  for (const tile of world.tiles) allTileKeys.add(`${tile.x},${tile.y}`);
  for (const [tileKey] of tileNationMap) allTileKeys.delete(tileKey);

  const nationTiles = {};
  for (const [tileKey, nid] of tileNationMap) {
    if (!nationTiles[nid]) nationTiles[nid] = [];
    nationTiles[nid].push(tileKey);
  }
  if (allTileKeys.size > 0) nationTiles["__neutral__"] = [...allTileKeys];

  const mapPixelW = W * TILE_SIZE;
  const mapPixelH = H * TILE_SIZE;
  const idAttr = svgId ? ` id="${svgId}"` : "";
  const styleAttr = svgExtraStyle
    ? ` style="${svgExtraStyle}"`
    : backgroundStyle
      ? ` style="${backgroundStyle}"`
      : "";
  let svg = `<svg${idAttr} xmlns="http://www.w3.org/2000/svg" width="${mapPixelW}" height="${mapPixelH}" viewBox="0 0 ${mapPixelW} ${mapPixelH}"${styleAttr}>`;
  if (background) svg += `<rect x="0" y="0" width="${mapPixelW}" height="${mapPixelH}" fill="${background}"/>`;

  for (const tile of world.tiles) svg += `<rect x="${(padding + tile.x) * TILE_SIZE}" y="${(padding + tile.y) * TILE_SIZE}" width="${TILE_SIZE}" height="${TILE_SIZE}" fill="${terrainColors[tile.terrain] || "#333"}"/>`;
  for (const tile of world.tiles) {
    if (!tile.river) continue;
    if (skipLakeRivers && tile.terrain === "lake") continue;
    if (riverWidth) {
      const rw = tile.riverWidth || 1;
      const rx = (padding + tile.x) * TILE_SIZE - ((rw - 1) * TILE_SIZE) / 2;
      svg += `<rect x="${rx}" y="${(padding + tile.y) * TILE_SIZE}" width="${rw * TILE_SIZE}" height="${TILE_SIZE}" fill="#1a5276" opacity="0.7"/>`;
    } else {
      svg += `<rect x="${(padding + tile.x) * TILE_SIZE}" y="${(padding + tile.y) * TILE_SIZE}" width="${TILE_SIZE}" height="${TILE_SIZE}" fill="#1a5276" opacity="0.7"/>`;
    }
  }

  // ★ Overlay Tolkien genérico (world.mapSkin, calculado en buildDemoWorld):
  // tras el terreno y ríos, antes de naciones/ciudades para no tapar el gameplay.
  if (withTolkien && world.mapSkin) svg += `\n<!-- Tolkien overlay (genérico, buildDemoWorld) -->\n${world.mapSkin.overlaySvg}`;

  for (const nid of Object.keys(nationTiles).sort()) {
    const nation = world.nationById.get(nid);
    const color = nation ? nation.color : "#888";
    const name = nation ? nation.name : "Neutral";
    const isNeutral = nid === "__neutral__";
    const opacity = isNeutral ? neutralOpacity : aliveOpacity;
    svg += `<g id="nation-${nid}" data-name="${name}" data-color="${color}">`;
    for (const tileKey of nationTiles[nid]) {
      const [tx, ty] = tileKey.split(",").map(Number);
      const sx = (padding + tx) * TILE_SIZE;
      const sy = (padding + ty) * TILE_SIZE;
      const strokeAttr = !isNeutral && nationStroke ? ` stroke="${color}" stroke-opacity="1" stroke-width="1"` : "";
      svg += `<rect x="${sx}" y="${sy}" width="${TILE_SIZE}" height="${TILE_SIZE}" fill="${color}" opacity="${opacity}"${strokeAttr} data-nation="${nid}"/>`;
      if (!isNeutral) {
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const ntx = tx + dx, nty = ty + dy;
          const neighborNid = tileNationMap.get(`${ntx},${nty}`);
          if (neighborNid !== nid) {
            if (dx === 1) svg += `<line x1="${sx + TILE_SIZE}" y1="${sy}" x2="${sx + TILE_SIZE}" y2="${sy + TILE_SIZE}" stroke="${color}" stroke-opacity="1" stroke-width="2" data-nation="${nid}"/>`;
            else if (dx === -1) svg += `<line x1="${sx}" y1="${sy}" x2="${sx}" y2="${sy + TILE_SIZE}" stroke="${color}" stroke-opacity="1" stroke-width="2" data-nation="${nid}"/>`;
            else if (dy === 1) svg += `<line x1="${sx}" y1="${sy + TILE_SIZE}" x2="${sx + TILE_SIZE}" y2="${sy + TILE_SIZE}" stroke="${color}" stroke-opacity="1" stroke-width="2" data-nation="${nid}"/>`;
            else if (dy === -1) svg += `<line x1="${sx}" y1="${sy}" x2="${sx + TILE_SIZE}" y2="${sy}" stroke="${color}" stroke-opacity="1" stroke-width="2" data-nation="${nid}"/>`;
          }
        }
      }
    }
    svg += `</g>`;
  }

  if (neon) {
    svg += `
  <defs>
    <filter id="neon-glow" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur stdDeviation="3" result="blur"/>
      <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>
  <g id="neon-borders" opacity="0">
    ${Object.keys(nationTiles).filter(nid => nid !== "__neutral__").map(nid => {
        const nation = world.nationById.get(nid);
        if (!nation) return "";
        const color = nation.color;
        const tiles = nationTiles[nid];
        let edges = [];
        for (const tileKey of tiles) {
          const [tx, ty] = tileKey.split(",").map(Number);
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const ntx = tx + dx, nty = ty + dy;
            const neighborNid = tileNationMap.get(`${ntx},${nty}`);
            if (neighborNid !== nid) {
              const sx = (padding + tx) * TILE_SIZE;
              const sy = (padding + ty) * TILE_SIZE;
              if (dx === 1) edges.push(`<line x1="${sx + TILE_SIZE}" y1="${sy}" x2="${sx + TILE_SIZE}" y2="${sy + TILE_SIZE}" stroke="${color}" stroke-width="3" filter="url(#neon-glow)" data-nation="${nid}"/>`);
              else if (dx === -1) edges.push(`<line x1="${sx}" y1="${sy}" x2="${sx}" y2="${sy + TILE_SIZE}" stroke="${color}" stroke-width="3" filter="url(#neon-glow)" data-nation="${nid}"/>`);
              else if (dy === 1) edges.push(`<line x1="${sx}" y1="${sy + TILE_SIZE}" x2="${sx + TILE_SIZE}" y2="${sy + TILE_SIZE}" stroke="${color}" stroke-width="3" filter="url(#neon-glow)" data-nation="${nid}"/>`);
              else if (dy === -1) edges.push(`<line x1="${sx}" y1="${sy}" x2="${sx + TILE_SIZE}" y2="${sy}" stroke="${color}" stroke-width="3" filter="url(#neon-glow)" data-nation="${nid}"/>`);
            }
          }
        }
        return edges.join("");
      }).join("\n")}
  </g>
  <script>
    var neonGroup = document.getElementById('neon-borders');
    if (neonGroup) {
      var opacity = 0.3;
      var dir = 1;
      setInterval(function() {
        opacity += 0.02 * dir;
        if (opacity > 0.8) { opacity = 0.8; dir = -1; }
        if (opacity < 0.1) { opacity = 0.1; dir = 1; }
        neonGroup.setAttribute('opacity', opacity);
      }, 50);
    }
  <\/script>
  `;
  }

  for (const city of world.cities) {
    const x = city.x * TILE_SIZE + TILE_SIZE / 2, y = city.y * TILE_SIZE + TILE_SIZE / 2;
    const nation = world.nationById.get(city.nationId);
    svg += `<circle cx="${x}" cy="${y}" r="${city.isCapital ? 5 : 3}" fill="${nation ? nation.color : "#fff"}" opacity="0.9"/>`;
  }

  const deadNations = [];
  for (const nation of world.nations) {
    const capitalCity = nation.capitalCityId ? world.cityById.get(nation.capitalCityId) : undefined;
    const capitalProvince = world.provinceById.get(nation.capitalProvinceId);
    const cx = (capitalCity?.x ?? capitalProvince?.centerX) ?? 0;
    const cy = (capitalCity?.y ?? capitalProvince?.centerY) ?? 0;
    const capitalTileKey = `${cx},${cy}`;
    const ownsCapitalTile = capitalCity && tileNationMap.get(capitalTileKey) === nation.id;
    svg += `<text x="${cx * TILE_SIZE + TILE_SIZE * 0.7}" y="${cy * TILE_SIZE - TILE_SIZE * 0.9}" fill="#fff" font-size="12" font-weight="bold" stroke="none">${nation.name}</text>`;
    if (deadMarkers && ((!ownsCapitalTile && world.cities.filter((c) => c.nationId === nation.id).length === 0) || world.provinces.filter((p) => p.nationId === nation.id).length === 0)) {
      deadNations.push(nation.id);
      const bx = cx * TILE_SIZE + TILE_SIZE * 0.7;
      const by = cy * TILE_SIZE - TILE_SIZE * 0.9;
      svg += `<g id="dead-${nation.id}" transform="translate(${bx},${by})"><circle cx="0" cy="-2" r="7"/><circle cx="-3" cy="-4" r="2.5" fill="#1a1a1a"/><circle cx="3" cy="-4" r="2.5" fill="#1a1a1a"/><path d="M-2,2 Q0,5 2,2" fill="none" stroke="#1a1a1a" stroke-width="1"/><line x1="-5" y1="5" x2="-2" y2="9" stroke="#ff0000" stroke-width="2.5" stroke-linecap="round"/><line x1="5" y1="5" x2="2" y2="9" stroke="#ff0000" stroke-width="2.5" stroke-linecap="round"/></g>`;
    }
  }

  svg += `</svg>`;
  return { svg, deadNations, mapPixelW, mapPixelH };
}

/** Sabor 004: el look clásico de init_world_004 (fondo #1a2332, sin neón). */
export const FLAVOR_004 = {
  background: null,
  backgroundStyle: "background: #1a2332;",
  aliveOpacity: 0.3,
  neutralOpacity: 0.05,
  nationStroke: false,
  neon: false,
  deadMarkers: false,
  riverWidth: true,
  skipLakeRivers: true,
};

/** Sabor svg_generate: marco fijo + neón + calaveras. */
export const FLAVOR_SVG_GENERATE = {
  background: "#132028",
  neon: true,
  deadMarkers: true,
  aliveOpacity: 0.45,
  neutralOpacity: 0.1,
  nationStroke: true,
  svgId: "map-svg",
  svgExtraStyle: "border:none;overflow:hidden;display:block;width:980px;height:660px",
  riverWidth: false,
  skipLakeRivers: false,
};
