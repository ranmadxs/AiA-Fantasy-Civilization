/**
 * Filtro de relieve geográfico — plugin @aia/map-yard (ESM puro).
 * Origen: map-yard/script/relief_filter.js
 *
 * Uso librería:
 *   import { parseBiomeMap, buildEnhancedSVG, createRNG } from '@aia/map-yard';
 */

import { waterFeather } from './edgeBlend.js';

const biomeColors = {
  ocean: '#0a2a4a',
  lake: '#5aa8d8',
  plain: '#8fbc8f',
  forest: '#2c5f2d',
  mountain: '#a0a0a0',
  desert: '#d2b48c',
  snow: '#f5f5f5'
};

const biomeColorAlt = {
  '#2d5a2d': 'forest',
  '#8c8c8c': 'mountain',
  '#c1a968': 'desert',
  '#f8f8f8': 'snow'
};

// Colores de overlay que nunca deben contaminar el mapa de biomas
// (#ffffff = línea de costa, #88c8f8 = ríos)
// Ampliado para AiA: fondo #132028 y ríos AiA #1a5276 tampoco son biomas.
export const skipFills = new Set(['#ffffff', '#88c8f8', '#132028', '#1a5276']);

const biomeElevation = {
  ocean: -0.8,
  lake: -0.35,
  plain: 0.0,
  forest: 0.1,
  mountain: 0.35,
  desert: 0.45,
  snow: 0.6
};

const biomeNames = Object.keys(biomeColors);

export function parseBiomeMap(htmlContent) {
  const rectRegex = /<rect\s+x="(\d+)"\s+y="(\d+)"\s+width="(\d+)"\s+height="(\d+)"\s+fill="([^"]+)"\s*\/>/g;
  const circleRegex = /<circle\s+cx="(\d+\.?\d*)"\s+cy="(\d+\.?\d*)"\s+r="(\d+\.?\d*)"\s+fill="([^"]+)"\s*\/>/g;
  const biomeMap = {};
  let match;
  let maxX = 0, maxY = 0;
  const sizeVotes = new Map();

  // Primera pasada: contar tamaños (sin fijar ts todavía) para no envenenar con el fondo.
  const rawRects = [];
  while ((match = rectRegex.exec(htmlContent)) !== null) {
    const x = parseInt(match[1], 10);
    const y = parseInt(match[2], 10);
    const w = parseInt(match[3], 10);
    const h = parseInt(match[4], 10);
    const fill = match[5];
    if (skipFills.has(fill)) continue;
    sizeVotes.set(w, (sizeVotes.get(w) || 0) + 1);
    rawRects.push({ x, y, w, h, fill });
  }
  let detectedTileSize = 16;
  let bestVotes = -1;
  for (const [size, votes] of sizeVotes) {
    if (votes > bestVotes) { bestVotes = votes; detectedTileSize = size; }
  }
  for (const { x, y, w, h, fill } of rawRects) {

    let biome = null;
    for (const name of biomeNames) {
      if (biomeColors[name] === fill) {
        biome = name;
        break;
      }
    }
    if (!biome && biomeColorAlt[fill]) {
      biome = biomeColorAlt[fill];
    }
    if (!biome) continue;

    const col = Math.floor(x / detectedTileSize);
    const row = Math.floor(y / detectedTileSize);
    biomeMap[`${row},${col}`] = biome;
    if (x + w > maxX) maxX = x + w;
    if (y + h > maxY) maxY = y + h;
  }

  while ((match = circleRegex.exec(htmlContent)) !== null) {
    const cx = parseFloat(match[1]);
    const cy = parseFloat(match[2]);
    const fill = match[4];

    if (skipFills.has(fill)) continue;

    let biome = null;
    for (const name of biomeNames) {
      if (biomeColors[name] === fill) {
        biome = name;
        break;
      }
    }
    if (!biome && biomeColorAlt[fill]) {
      biome = biomeColorAlt[fill];
    }
    if (!biome || biome === 'ocean') continue;

    const col = Math.floor(cx / detectedTileSize);
    const row = Math.floor(cy / detectedTileSize);
    const key = `${row},${col}`;
    const existing = biomeMap[key];
    if (!existing || existing === 'ocean') {
      biomeMap[key] = biome;
    }
    if (cx > maxX) maxX = cx;
    if (cy > maxY) maxY = cy;
  }

  const tileSizeDetected = detectedTileSize;
  const detailTileSizeDetected = 3;
  return { biomeMap, cols: Math.ceil(maxX / tileSizeDetected), rows: Math.ceil(maxY / tileSizeDetected), tileSize: tileSizeDetected, detailTileSize: detailTileSizeDetected };
}

function getBiomeAt(biomeMap, col, row) {
  return biomeMap[`${row},${col}`] || 'ocean';
}

function getBiomeElevation(biomeMap, col, row) {
  const biome = getBiomeAt(biomeMap, col, row);
  return biomeElevation[biome];
}

function getDetailBiome(biomeMap, detailCols, detailRows, dx, dy, dts, ts) {
  const col = Math.floor(dx * dts / ts);
  const row = Math.floor(dy * dts / ts);
  return getBiomeAt(biomeMap, col, row);
}

function getDetailCell(biomeMap, dx, dy, dts, ts) {
  const col = Math.floor(dx * dts / ts);
  const row = Math.floor(dy * dts / ts);
  return { col, row, biome: getBiomeAt(biomeMap, col, row) };
}

function hasBiomeNearby(biomeMap, col, row, target, radius) {
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx === 0 && dy === 0) continue;
      if (getBiomeAt(biomeMap, col + dx, row + dy) === target) return true;
    }
  }
  return false;
}

function hasSnowNearby(biomeMap, col, row, radius) {
  return hasBiomeNearby(biomeMap, col, row, 'snow', radius == null ? 2 : radius);
}

function hasForestNearby(biomeMap, col, row, radius) {
  return hasBiomeNearby(biomeMap, col, row, 'forest', radius == null ? 2 : radius);
}

// Zona sin árboles: 'high-rocky-snow' si hay nieve cerca,
// 'tundra' si no hay nieve cerca. null si no aplica.
function getTreelessZone(biomeMap, col, row) {
  const biome = getBiomeAt(biomeMap, col, row);
  if (biome !== 'mountain' && biome !== 'desert' && biome !== 'plain' && biome !== 'snow') return null;
  if (biome === 'snow') return 'high-rocky-snow';
  if (hasSnowNearby(biomeMap, col, row, 2)) return 'high-rocky-snow';
  return 'tundra';
}

function noiseRadial(x, y, cx, cy, rng) {
  const dx = x - cx;
  const dy = y - cy;
  const dist = Math.sqrt(dx * dx + dy * dy) / Math.max(1, Math.sqrt(cx * cx + cy * cy));
  const angle = Math.atan2(dy, dx) / (2 * Math.PI);
  const n1 = rng();
  const n2 = rng();
  const n3 = rng();
  const hashVal = (angle * 1000 + dist * 1000 + n1 * 500 + n2 * 300 + n3 * 100) | 0;
  return (hashVal % 1000) / 500 - 1;
}

export function createRNG(seed) {
  let s = seed;
  return function() {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

// ============================================================
// CAPA DE DETALLE
// ============================================================

function generateMountainDetail(biomeMap, detailCols, detailRows, dts, ts, rng) {
  let svg = '';

  for (let y = 0; y < detailRows; y++) {
    for (let x = 0; x < detailCols; x++) {
      const cell = getDetailCell(biomeMap, x, y, dts, ts);
      if (cell.biome !== 'mountain') continue;
      if (rng() > 0.8) continue;

      const snowNear = hasSnowNearby(biomeMap, cell.col, cell.row, 2);
      const px = x * dts + dts / 2;
      const py = y * dts + dts / 2;

      const localNoise = noiseRadial(x * 2, y * 2, x, y, rng);
      const numPeaks = localNoise > 0.5 ? 2 : 1;

      for (let p = 0; p < numPeaks; p++) {
        const offsetX = (rng() - 0.5) * dts * 0.6;
        const offsetY = (rng() - 0.5) * dts * 0.6;
        const peakX = px + offsetX;
        const peakY = py + offsetY;
        const peakH = snowNear ? 8 + rng() * 30 : 6 + rng() * 22;
        const baseWidth = snowNear ? 6 + rng() * 9 : 5 + rng() * 8;

        const lightSide = (x + y + p) % 2 === 0;
        const lightFactor = lightSide ? 1.0 : 0.6;
        const r = Math.floor(139 * lightFactor);
        const g = Math.floor(115 * lightFactor);
        const b = Math.floor(85 * lightFactor);
        const fillColor = `#${r.toString(16).padStart(2,'0')}${g.toString(16).padStart(2,'0')}${b.toString(16).padStart(2,'0')}`;

        const darkFactor = lightSide ? 0.6 : 1.0;
        const dr = Math.floor(100 * darkFactor);
        const dg = Math.floor(80 * darkFactor);
        const db = Math.floor(60 * darkFactor);
        const shadowColor = `#${dr.toString(16).padStart(2,'0')}${dg.toString(16).padStart(2,'0')}${db.toString(16).padStart(2,'0')}`;

        svg += `<polygon points="${peakX},${peakY - peakH} ${peakX - baseWidth/2},${peakY + 3} ${peakX + baseWidth/2},${peakY + 3}" fill="${fillColor}" opacity="0.9" />\n`;
        svg += `<polygon points="${peakX},${peakY - peakH + 3} ${peakX - baseWidth/4},${peakY} ${peakX + baseWidth/4},${peakY}" fill="${shadowColor}" opacity="0.5" />\n`;

        if (rng() < (snowNear ? 0.45 : 0.3)) {
          const rockSize = 2 + rng() * 3;
          const rockX = peakX + (rng() - 0.5) * baseWidth;
          const rockY = peakY + rng() * 3;
          svg += `<polygon points="${rockX},${rockY} ${rockX - rockSize/2},${rockY + rockSize} ${rockX + rockSize/2},${rockY + rockSize}" fill="#6b5b4a" opacity="0.7" />\n`;
        }
      }
    }
  }

  return svg;
}

function generateTreeDetail(biomeMap, detailCols, detailRows, dts, ts, rng) {
  let svg = '';

  for (let y = 0; y < detailRows; y++) {
    for (let x = 0; x < detailCols; x++) {
      const cell = getDetailCell(biomeMap, x, y, dts, ts);
      const biome = cell.biome;
      if (biome !== 'forest' && biome !== 'plain') continue;
      if (rng() > 0.4) continue;

      const nearMountain = hasBiomeNearby(biomeMap, cell.col, cell.row, 'mountain', 1);
      const nearSnow = hasSnowNearby(biomeMap, cell.col, cell.row, 2);
      if (nearSnow && rng() > 0.25) continue;

      const px = x * dts + dts / 2;
      const py = y * dts + dts / 2;

      const localNoise = noiseRadial(x * 3, y * 3, x, y, rng);
      let density = biome === 'forest' ? (0.4 + localNoise * 0.3) : (0.1 + localNoise * 0.15);
      if (nearMountain) density *= 0.5;

      if (rng() > density) continue;

      let numTrees = biome === 'forest' ? (Math.floor(rng() * 3) + 2) : (Math.floor(rng() * 2) + 1);
      if (nearMountain) numTrees = Math.max(1, numTrees - 1);
      const treeColors = ['#1a5c1a', '#2d7a2d', '#3a9a3a', '#4ab04a', '#5cb05c', '#2d8a2d'];
      const trunkColors = ['#5c3a1e', '#6b4a2e', '#7a5a3e'];

      for (let t = 0; t < numTrees; t++) {
        const tx = px + (rng() - 0.5) * dts * 0.5;
        const ty = py + (rng() - 0.5) * dts * 0.5;
        const treeH = 4 + rng() * 6;
        let canopyR = 3 + rng() * 2;
        if (nearMountain) canopyR *= 0.8;
        const trunkH = treeH * 0.3;
        const color = treeColors[Math.floor(rng() * treeColors.length)];
        const trunk = trunkColors[Math.floor(rng() * trunkColors.length)];

        svg += `<rect x="${(tx - 1).toFixed(1)}" y="${(ty - trunkH).toFixed(1)}" width="2" height="${trunkH.toFixed(1)}" fill="${trunk}" />\n`;
        svg += `<circle cx="${tx.toFixed(1)}" cy="${(ty - trunkH - canopyR * 0.3).toFixed(1)}" r="${canopyR.toFixed(1)}" fill="${color}" opacity="0.9" />\n`;
      }
    }
  }

  return svg;
}

function generateRockDetail(biomeMap, detailCols, detailRows, dts, ts, rng) {
  let svg = '';

  for (let y = 0; y < detailRows; y++) {
    for (let x = 0; x < detailCols; x++) {
      const cell = getDetailCell(biomeMap, x, y, dts, ts);
      if (cell.biome !== 'mountain') continue;
      const snowNear = hasSnowNearby(biomeMap, cell.col, cell.row, 2);
      if (rng() > (snowNear ? 0.7 : 0.5)) continue;

      const px = x * dts + dts / 2;
      const py = y * dts + dts / 2;

      const numRocks = Math.floor(rng() * 3) + 1;
      for (let r = 0; r < numRocks; r++) {
        const rockW = 2 + rng() * 5;
        const rockH = 1.5 + rng() * 3;
        const rx = px + (rng() - 0.5) * dts;
        const ry = py + (rng() - 0.5) * dts;
        const gray = Math.floor(100 + rng() * 60);
        svg += `<polygon points="${rx},${ry - rockH/2} ${rx - rockW/2},${ry + rockH/2} ${rx + rockW/2},${ry + rockH/2}" fill="#${gray.toString(16).padStart(2,'0')}${gray.toString(16).padStart(2,'0')}${Math.floor(gray * 0.8).toString(16).padStart(2,'0')}" opacity="${(0.5 + rng() * 0.3).toFixed(2)}" />\n`;
      }
    }
  }

  return svg;
}

function generateTundraDetail(biomeMap, detailCols, detailRows, dts, ts, rng) {
  let svg = '';
  const shrubColors = ['#1f4a1f', '#2f5d2a', '#5a4a33', '#3a5a35'];

  for (let y = 0; y < detailRows; y++) {
    for (let x = 0; x < detailCols; x++) {
      const cell = getDetailCell(biomeMap, x, y, dts, ts);
      if (cell.biome !== 'mountain' && cell.biome !== 'desert' && cell.biome !== 'plain') continue;
      if (getTreelessZone(biomeMap, cell.col, cell.row) !== 'tundra') continue;
      if (rng() > 0.5) continue;

      const px = x * dts + dts / 2;
      const py = y * dts + dts / 2;

      const numShrubs = 2 + Math.floor(rng() * 3);
      for (let s = 0; s < numShrubs; s++) {
        const sx = px + (rng() - 0.5) * dts;
        const sy = py + (rng() - 0.5) * dts;
        const sr = 0.8 + rng() * 1.2;
        const color = shrubColors[Math.floor(rng() * shrubColors.length)];
        svg += `<circle cx="${sx.toFixed(1)}" cy="${sy.toFixed(1)}" r="${sr.toFixed(1)}" fill="${color}" opacity="0.85" />\n`;
      }

      if (rng() < 0.5) {
        const rx = px + (rng() - 0.5) * dts;
        const ry = py + (rng() - 0.5) * dts;
        const rockW = 1.5 + rng() * 2.5;
        const rockH = 1 + rng() * 1.5;
        const gray = Math.floor(110 + rng() * 40);
        svg += `<polygon points="${rx},${ry - rockH / 2} ${rx - rockW / 2},${ry + rockH / 2} ${rx + rockW / 2},${ry + rockH / 2}" fill="#${gray.toString(16).padStart(2, '0')}${gray.toString(16).padStart(2, '0')}${Math.floor(gray * 0.8).toString(16).padStart(2, '0')}" opacity="0.6" />\n`;
      }

      if (rng() < 0.3) {
        const patchR = dts * (0.5 + rng() * 0.4);
        svg += `<ellipse cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" rx="${patchR.toFixed(1)}" ry="${(patchR * 0.6).toFixed(1)}" fill="rgba(120,100,70,0.18)" />\n`;
      }
    }
  }

  return svg;
}

function generateSnowDetail(biomeMap, detailCols, detailRows, dts, ts, rng) {
  let svg = '';
  // Luz fija para toda la nieve: sombra siempre abajo-derecha
  const SH_X = 1.2;
  const SH_Y = 1.5;

  // 1) Mantos agrupados por bloques 2x2: una sola base suave por bloque
  for (let by = 0; by < detailRows; by += 2) {
    for (let bx = 0; bx < detailCols; bx += 2) {
      let snowCount = 0;
      for (let oy = 0; oy < 2; oy++) {
        for (let ox = 0; ox < 2; ox++) {
          if (getDetailBiome(biomeMap, detailCols, detailRows, bx + ox, by + oy, dts, ts) === 'snow') snowCount++;
        }
      }
      if (snowCount === 0) continue;

      const cx = bx * dts + dts;
      const cy = by * dts + dts;
      const jx = (rng() - 0.5) * dts * 0.6;
      const jy = (rng() - 0.5) * dts * 0.6;
      // Borde atenuado: bloques parciales (1-2/4) salen más tenues
      const cover = snowCount / 4;
      const baseAlpha = (0.35 + cover * 0.3).toFixed(2);
      const baseR = dts * (1.5 + rng() * 0.7);
      svg += `<ellipse cx="${(cx + jx).toFixed(1)}" cy="${(cy + jy).toFixed(1)}" rx="${baseR.toFixed(1)}" ry="${(baseR * 0.75).toFixed(1)}" fill="rgba(240,244,250,${baseAlpha})" />\n`;
      svg += `<ellipse cx="${(cx + jx + SH_X).toFixed(1)}" cy="${(cy + jy + SH_Y).toFixed(1)}" rx="${(baseR * 0.7).toFixed(1)}" ry="${(baseR * 0.45).toFixed(1)}" fill="rgba(178,193,214,0.30)" />\n`;

      const highlights = 2 + Math.floor(rng() * 2);
      for (let h = 0; h < highlights; h++) {
        const hx = cx + jx + (rng() - 0.5) * baseR;
        const hy = cy + jy + (rng() - 0.5) * baseR * 0.7;
        const hr = 1.2 + rng() * 1.8;
        svg += `<circle cx="${hx.toFixed(1)}" cy="${hy.toFixed(1)}" r="${hr.toFixed(1)}" fill="rgba(255,255,255,${(0.85 + rng() * 0.15).toFixed(2)})" />\n`;
      }
      if (rng() < 0.25) {
        const sx = cx + jx + (rng() - 0.5) * baseR * 0.8;
        const sy = cy + jy + (rng() - 0.5) * baseR * 0.5;
        svg += `<circle cx="${sx.toFixed(1)}" cy="${sy.toFixed(1)}" r="${(0.6 + rng() * 0.5).toFixed(1)}" fill="rgba(255,255,255,0.95)" />\n`;
      }
    }
  }

  // 2) Casquetes solo en cimas de montaña vecina a nieve
  for (let y = 0; y < detailRows; y++) {
    for (let x = 0; x < detailCols; x++) {
      const cell = getDetailCell(biomeMap, x, y, dts, ts);
      if (cell.biome !== 'mountain') continue;
      if (!hasSnowNearby(biomeMap, cell.col, cell.row, 2)) continue;
      if (rng() > 0.4) continue;
      const px = x * dts + dts / 2;
      const py = y * dts + dts / 2;
      const capR = 1.4 + rng() * 1.2;
      svg += `<circle cx="${px.toFixed(1)}" cy="${(py - dts * 0.3).toFixed(1)}" r="${capR.toFixed(1)}" fill="rgba(255,255,255,0.92)" />\n`;
      svg += `<circle cx="${(px + 0.9).toFixed(1)}" cy="${(py - dts * 0.2).toFixed(1)}" r="${(capR * 0.55).toFixed(1)}" fill="rgba(205,218,236,0.55)" />\n`;
    }
  }

  return svg;
}

function isCoastBiome(biomeMap, col, row) {
  const biome = getBiomeAt(biomeMap, col, row);
  if (biome !== 'ocean') return false;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      const neighbor = getBiomeAt(biomeMap, col + dx, row + dy);
      if (neighbor !== 'ocean' && neighbor !== 'lake') return true;
    }
  }
  return false;
}

function shoreNormal(biomeMap, col, row) {
  let nx = 0;
  let ny = 0;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      const n = getBiomeAt(biomeMap, col + dx, row + dy);
      if (n === 'ocean' || n === 'lake') {
        nx += dx;
        ny += dy;
      } else {
        nx -= dx * 0.5;
        ny -= dy * 0.5;
      }
    }
  }
  const len = Math.sqrt(nx * nx + ny * ny) || 1;
  return { nx: nx / len, ny: ny / len };
}

function isLakeShore(biomeMap, col, row) {
  if (getBiomeAt(biomeMap, col, row) !== 'lake') return false;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      const n = getBiomeAt(biomeMap, col + dx, row + dy);
      if (n !== 'lake' && n !== 'ocean') return true;
    }
  }
  return false;
}

function isWintryLake(biomeMap, col, row) {
  if (getBiomeAt(biomeMap, col, row) !== 'lake') return false;
  return hasBiomeNearby(biomeMap, col, row, 'snow', 2) || hasBiomeNearby(biomeMap, col, row, 'mountain', 2);
}

function generateLakeDetail(biomeMap, detailCols, detailRows, dts, ts, rng) {
  let svg = '';
  const maxCol = Math.ceil(width / ts) + 2;
  const maxRow = Math.ceil(height / ts) + 2;

  for (let row = 0; row < maxRow; row++) {
    for (let col = 0; col < maxCol; col++) {
      if (getBiomeAt(biomeMap, col, row) !== 'lake') continue;
      const cx = col * ts + ts / 2;
      const cy = row * ts + ts / 2;

      if (isLakeShore(biomeMap, col, row)) {
        svg += `<ellipse cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" rx="${(ts * 0.52).toFixed(1)}" ry="${(ts * 0.42).toFixed(1)}" fill="none" stroke="rgba(255,255,255,0.7)" stroke-width="1" />\n`;
      }

      if (!isWintryLake(biomeMap, col, row)) {
        svg += `<ellipse cx="${(cx - ts * 0.15).toFixed(1)}" cy="${(cy - ts * 0.1).toFixed(1)}" rx="${(ts * 0.3).toFixed(1)}" ry="${(ts * 0.18).toFixed(1)}" fill="rgba(255,255,255,0.18)" />\n`;
        continue;
      }

      // Lago helado: lámina pálida casi total, filo mínimo de agua
      const jx = (rng() - 0.5) * ts * 0.15;
      const jy = (rng() - 0.5) * ts * 0.15;
      svg += `<ellipse cx="${(cx + jx).toFixed(1)}" cy="${(cy + jy).toFixed(1)}" rx="${(ts * 0.46).toFixed(1)}" ry="${(ts * 0.40).toFixed(1)}" fill="rgba(225,238,248,0.85)" />\n`;
      svg += `<ellipse cx="${(cx + jx + 1.4).toFixed(1)}" cy="${(cy + jy + 1.6).toFixed(1)}" rx="${(ts * 0.3).toFixed(1)}" ry="${(ts * 0.22).toFixed(1)}" fill="rgba(178,193,214,0.30)" />\n`;

      // Grietas escasas, cortas, sin rejilla
      const cracks = 1 + Math.floor(rng() * 2);
      for (let c = 0; c < cracks; c++) {
        const ang = rng() * Math.PI;
        const len = ts * (0.2 + rng() * 0.2);
        const gx = cx + jx + (rng() - 0.5) * ts * 0.4;
        const gy = cy + jy + (rng() - 0.5) * ts * 0.3;
        svg += `<line x1="${(gx - Math.cos(ang) * len).toFixed(1)}" y1="${(gy - Math.sin(ang) * len).toFixed(1)}" x2="${(gx + Math.cos(ang) * len).toFixed(1)}" y2="${(gy + Math.sin(ang) * len).toFixed(1)}" stroke="rgba(255,255,255,0.8)" stroke-width="0.8" stroke-linecap="round" />\n`;
      }

      // Ojo de agua ocasional: solo ~15% de celdas
      if (rng() < 0.15) {
        svg += `<ellipse cx="${(cx + jx - ts * 0.15).toFixed(1)}" cy="${(cy + jy + ts * 0.1).toFixed(1)}" rx="${(ts * 0.12).toFixed(1)}" ry="${(ts * 0.09).toFixed(1)}" fill="rgba(90,168,216,0.85)" />\n`;
      }

      // Polvo de nieve solo si hay nieve vecina
      if (hasSnowNearby(biomeMap, col, row, 2) && rng() < 0.5) {
        svg += `<circle cx="${(cx + jx).toFixed(1)}" cy="${(cy + jy - ts * 0.15).toFixed(1)}" r="${(0.8 + rng() * 0.7).toFixed(1)}" fill="rgba(255,255,255,0.9)" />\n`;
      }
    }
  }

  return svg;
}

function isLandBiome(b) {
  return b !== 'ocean' && b !== 'lake';
}

function chaikinSmooth(points, closed) {
  if (points.length < 3) return points;
  const out = [];
  const n = points.length;
  const limit = closed ? n : n - 1;
  if (!closed) out.push(points[0]);
  for (let i = 0; i < limit; i++) {
    const p = points[i];
    const q = points[(i + 1) % n];
    out.push({ x: p.x * 0.75 + q.x * 0.25, y: p.y * 0.75 + q.y * 0.25 });
    out.push({ x: p.x * 0.25 + q.x * 0.75, y: p.y * 0.25 + q.y * 0.75 });
  }
  if (!closed) out.push(points[n - 1]);
  return out;
}

function pathFromPoints(points) {
  return points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
}

function generateCoastDetail(biomeMap, detailCols, detailRows, dts, ts, rng) {
  let svg = '';

  // 1) Aristas tierra/agua en coordenadas pixel (bordes compartidos)
  const maxCol = Math.ceil(width / ts) + 2;
  const maxRow = Math.ceil(height / ts) + 2;
  const edges = [];
  const dirs = [
    { dx: 1, dy: 0 },
    { dx: -1, dy: 0 },
    { dx: 0, dy: 1 },
    { dx: 0, dy: -1 }
  ];
  for (let row = 0; row < maxRow; row++) {
    for (let col = 0; col < maxCol; col++) {
      if (getBiomeAt(biomeMap, col, row) !== 'ocean') continue;
      for (const d of dirs) {
        if (!isLandBiome(getBiomeAt(biomeMap, col + d.dx, row + d.dy))) continue;
        const x0 = col * ts;
        const y0 = row * ts;
        let ax, ay, bx, by;
        if (d.dx === 1) { ax = x0 + ts; ay = y0; bx = x0 + ts; by = y0 + ts; }
        else if (d.dx === -1) { ax = x0; ay = y0 + ts; bx = x0; by = y0; }
        else if (d.dy === 1) { ax = x0 + ts; ay = y0 + ts; bx = x0; by = y0 + ts; }
        else { ax = x0; ay = y0; bx = x0 + ts; by = y0; }
        edges.push({ ax, ay, bx, by, wx: -d.dx, wy: -d.dy });
      }
    }
  }
  if (edges.length === 0) return svg;

  // 2) Encadenar aristas en polilíneas por extremos coincidentes
  const key = (x, y) => `${Math.round(x * 10)},${Math.round(y * 10)}`;
  const startMap = new Map();
  const endMap = new Map();
  edges.forEach((e, i) => {
    const k = key(e.ax, e.ay);
    if (!startMap.has(k)) startMap.set(k, []);
    startMap.get(k).push(i);
    const ke = key(e.bx, e.by);
    if (!endMap.has(ke)) endMap.set(ke, []);
    endMap.get(ke).push(i);
  });
  const used = new Array(edges.length).fill(false);
  const polylines = [];
  for (let i = 0; i < edges.length; i++) {
    if (used[i]) continue;
    used[i] = true;
    const line = [{ x: edges[i].ax, y: edges[i].ay, wx: edges[i].wx, wy: edges[i].wy }];
    line.push({ x: edges[i].bx, y: edges[i].by, wx: edges[i].wx, wy: edges[i].wy });
    let extended = true;
    while (extended) {
      extended = false;
      const last = line[line.length - 1];
      const cand = startMap.get(key(last.x, last.y)) || [];
      for (const j of cand) {
        if (used[j]) continue;
        used[j] = true;
        line.push({ x: edges[j].bx, y: edges[j].by, wx: edges[j].wx, wy: edges[j].wy });
        extended = true;
        break;
      }
      if (extended) continue;
      const candR = endMap.get(key(last.x, last.y)) || [];
      for (const j of candR) {
        if (used[j]) continue;
        used[j] = true;
        line.push({ x: edges[j].ax, y: edges[j].ay, wx: edges[j].wx, wy: edges[j].wy });
        extended = true;
        break;
      }
    }
    extended = true;
    while (extended) {
      extended = false;
      const first = line[0];
      const cand = endMap.get(key(first.x, first.y)) || [];
      for (const j of cand) {
        if (used[j]) continue;
        used[j] = true;
        line.unshift({ x: edges[j].ax, y: edges[j].ay, wx: edges[j].wx, wy: edges[j].wy });
        extended = true;
        break;
      }
      if (extended) continue;
      const candR = startMap.get(key(first.x, first.y)) || [];
      for (const j of candR) {
        if (used[j]) continue;
        used[j] = true;
        line.unshift({ x: edges[j].bx, y: edges[j].by, wx: edges[j].wx, wy: edges[j].wy });
        extended = true;
        break;
      }
    }
    polylines.push(line);
  }

  // 3) Suavizar y dibujar: una banda somera + un filo por tramo
  for (const line of polylines) {
    if (line.length < 2) continue;
    const pts = line.map(p => ({ x: p.x, y: p.y }));
    const smooth = chaikinSmooth(pts, false);
    // Normal hacia el agua promediada del tramo
    let anx = 0, any = 0;
    for (const p of line) { anx += p.wx; any += p.wy; }
    const alen = Math.sqrt(anx * anx + any * any) || 1;
    anx /= alen; any /= alen;
    const offFoam = -ts * 0.05;
    const foam = smooth.map(p => ({ x: p.x + anx * offFoam, y: p.y + any * offFoam }));
    svg += waterFeather(smooth, anx, any, ts);
    svg += `<path d="${pathFromPoints(foam)}" fill="none" stroke="rgba(255,255,255,0.8)" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" />\n`;
  }

  return svg;
}

// ============================================================
// CONSTRUCCIÓN DEL SVG
// ============================================================

export function buildEnhancedSVG(htmlContent, biomeMap, ts, dts, rng, opts = {}) {
  const width = opts.width || 1920;
  const height = opts.height || 1080;
  const detailCols = Math.ceil(width / dts) + 2;
  const detailRows = Math.ceil(height / dts) + 2;

  const svgHead = htmlContent.indexOf('<svg');
  const svgEnd = htmlContent.lastIndexOf('</svg>');
  if (svgHead < 0 || svgEnd < 0) {
    console.error('No se encontró <svg> en el archivo fuente');
    return htmlContent;
  }

  const svgOpenEnd = htmlContent.indexOf('>', svgHead) + 1;
  const preContent = htmlContent.substring(0, svgOpenEnd);
  const svgBody = htmlContent.substring(svgOpenEnd, svgEnd);
  const postContent = htmlContent.substring(svgEnd);

  let detailSvg = '';
  detailSvg += '\n<!-- Detalle: Montañas -->\n';
  detailSvg += generateMountainDetail(biomeMap, detailCols, detailRows, dts, ts, rng);

  detailSvg += '\n<!-- Detalle: Rocas -->\n';
  detailSvg += generateRockDetail(biomeMap, detailCols, detailRows, dts, ts, rng);

  detailSvg += '\n<!-- Detalle: Tundra -->\n';
  detailSvg += generateTundraDetail(biomeMap, detailCols, detailRows, dts, ts, rng);

  detailSvg += '\n<!-- Detalle: Árboles -->\n';
  detailSvg += generateTreeDetail(biomeMap, detailCols, detailRows, dts, ts, rng);

  detailSvg += '\n<!-- Detalle: Costas -->\n';
  detailSvg += generateCoastDetail(biomeMap, detailCols, detailRows, dts, ts, rng);

  detailSvg += '\n<!-- Detalle: Lagos -->\n';
  detailSvg += generateLakeDetail(biomeMap, detailCols, detailRows, dts, ts, rng);

  detailSvg += '\n<!-- Detalle: Nieve -->\n';
  detailSvg += generateSnowDetail(biomeMap, detailCols, detailRows, dts, ts, rng);

  return preContent + svgBody + detailSvg + postContent;
}

// ---- Ejecución CLI standalone (solo cuando se invoca directo con node) ----

export async function runReliefCLI(args = process.argv.slice(2)) {
  const { default: fs } = await import('node:fs');
  const { default: path } = await import('node:path');
  let width = 1920, height = 1080, seed = 42, sourceFile = null, outputDir = 'target/relief';
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--width' && i + 1 < args.length) width = parseInt(args[++i], 10);
    else if (arg === '--height' && i + 1 < args.length) height = parseInt(args[++i], 10);
    else if (arg === '--seed' && i + 1 < args.length) seed = parseInt(args[++i], 10);
    else if (arg === '--source' && i + 1 < args.length) { sourceFile = args[++i]; outputDir = path.dirname(path.resolve(sourceFile)); }
    else if (arg === '--output' && i + 1 < args.length) outputDir = args[++i];
  }
  if (!sourceFile) {
    console.error('Uso: node reliefFilter.js --source <archivo.html> [--seed N] [--width N] [--height N]');
    process.exit(1);
  }
  const htmlPath = sourceFile.startsWith('file://') ? new URL(sourceFile).pathname : sourceFile;
  if (!fs.existsSync(htmlPath)) {
    console.error(`Archivo no encontrado: ${htmlPath}`);
    process.exit(1);
  }
  const htmlContent = fs.readFileSync(htmlPath, 'utf8');
  const { biomeMap, cols, rows, tileSize: detectedTileSize, detailTileSize: detectedDetailTileSize } = parseBiomeMap(htmlContent);
  const rng = createRNG(seed);
  console.log(`Mapa parseado: ${cols}×${rows} celdas de bioma (tileSize=${detectedTileSize})`);
  console.log(`Añadiendo capas de detalle a: ${htmlPath}`);
  const output = buildEnhancedSVG(htmlContent, biomeMap, detectedTileSize, detectedDetailTileSize, rng, { width, height });
  const m = path.basename(htmlPath).match(/semilla-(\d+)/);
  const outputFileName = `relief-semilla-${m?.[1] || 'unknown'}.html`;
  const outputPath = path.resolve(outputDir, outputFileName);
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(outputPath, output);
  console.log(`Mapa con relieve generado en: ${outputPath}`);
  return outputPath;
}

const __isReliefMain = (() => {
  try {
    const invoked = process.argv[1] ? new URL(`file://${process.argv[1]}`).href : '';
    return invoked === import.meta.url;
  } catch { return false; }
})();
if (__isReliefMain) { await runReliefCLI(); }
