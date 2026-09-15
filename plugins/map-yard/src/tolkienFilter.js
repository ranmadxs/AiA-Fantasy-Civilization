/**
 * Filtro estilo mapa de libro (Tolkien) — plugin @aia/map-yard (ESM puro).
 * Origen: map-yard/script/tolkien_filter.js
 *
 * Uso librería:
 *   import { parseBiomeMap, buildTolkienSVG, createRNG } from '@aia/map-yard';
 *   const parsed = parseBiomeMap(baseHtml);
 *   const out = buildTolkienSVG(baseHtml, parsed.biomeMap, parsed.tileSize, createRNG(42), '42', { width, height });
 * Uso CLI standalone:
 *   node src/tolkienFilter.js --source file.html [--seed N] [--width N] [--height N] [--output dir]
 */

import { transitionLayer, waterFeather } from './edgeBlend.js';

const INK = '#3a2e1e';

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

// Overlays que nunca contaminan el mapa de biomas.
// Ampliado para AiA: fondo #132028 y ríos AiA #1a5276 tampoco son biomas.
const skipFills = new Set(['#ffffff', '#88c8f8', '#132028', '#1a5276']);

const biomeElevation = {
  ocean: -0.8,
  lake: -0.35,
  plain: 0.0,
  forest: 0.1,
  mountain: 0.35,
  desert: 0.45,
  snow: 0.6
};

const washColors = {
  ocean: 'rgba(120,160,190,0.10)',
  lake: 'rgba(140,190,220,0.15)',
  plain: 'rgba(150,180,120,0.15)',
  forest: 'rgba(90,140,90,0.16)',
  mountain: 'rgba(150,130,110,0.16)',
  desert: 'rgba(200,170,120,0.18)',
  snow: 'rgba(240,244,250,0.25)'
};

const biomeNames = Object.keys(biomeColors);

export function createRNG(seed) {
  let s = seed;
  return function() {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

// Paleta alternativa: mapas AiA-Fantasy-Civilization (ver scripts/init_world_*.mjs)
// hill #9a8d65 se trata como mountain; coast #4a89a8 como ocean.
export const PALETTE_AIA = {
  '#315f8f': 'ocean',
  '#4a89a8': 'ocean',
  '#2e7d9e': 'lake',
  '#88a95f': 'plain',
  '#477457': 'forest',
  '#9a8d65': 'mountain',
  '#7d7f85': 'mountain',
  '#c9b06b': 'desert'
};

function standardLookup(fill) {
  for (const name of biomeNames) {
    if (biomeColors[name] === fill) return name;
  }
  return biomeColorAlt[fill] || null;
}

export function parseBiomeMap(htmlContent) {
  const rectRegex = /<rect\s+x="(\d+)"\s+y="(\d+)"\s+width="(\d+)"\s+height="(\d+)"\s+fill="([^"]+)"\s*\/>/g;
  const circleRegex = /<circle\s+cx="(\d+\.?\d*)"\s+cy="(\d+\.?\d*)"\s+r="(\d+\.?\d*)"\s+fill="([^"]+)"[^>]*\/>/g;
  const rects = [];
  let match;
  // ts por moda (no primer rect): el fondo full-canvas (#132028) no debe envenenar la detección.
  const sizeVotes = new Map();

  while ((match = rectRegex.exec(htmlContent)) !== null) {
    const x = parseInt(match[1], 10);
    const y = parseInt(match[2], 10);
    const w = parseInt(match[3], 10);
    const h = parseInt(match[4], 10);
    const fill = match[5];
    if (skipFills.has(fill)) continue;
    sizeVotes.set(w, (sizeVotes.get(w) || 0) + 1);
    rects.push({ x, y, w, h, fill });
  }
  let detectedTileSize = 16;
  let bestVotes = -1;
  for (const [size, votes] of sizeVotes) {
    if (votes > bestVotes) { bestVotes = votes; detectedTileSize = size; }
  }

  // Autodetección de paleta: estándar vs AiA
  let stdHits = 0, aiaHits = 0;
  for (const r of rects) {
    if (standardLookup(r.fill)) stdHits++;
    if (PALETTE_AIA[r.fill]) aiaHits++;
  }
  const useAia = aiaHits > stdHits;
  const toBiome = useAia
    ? (fill) => PALETTE_AIA[fill] || null
    : standardLookup;
  console.log(`Paleta detectada: ${useAia ? 'AiA-Fantasy' : 'map-yard'} (${useAia ? aiaHits : stdHits} celdas)`);

  // Origen de la grilla (algunos mapas parten con padding, ej. x=20,y=20).
  // Se reporta pero las claves usan columnas absolutas para que
  // col*ts+ts/2 coincida con el píxel del rect original.
  let originX = Infinity, originY = Infinity, maxX = 0, maxY = 0;
  for (const r of rects) {
    if (!toBiome(r.fill)) continue;
    if (r.x < originX) originX = r.x;
    if (r.y < originY) originY = r.y;
    if (r.x + r.w > maxX) maxX = r.x + r.w;
    if (r.y + r.h > maxY) maxY = r.y + r.h;
  }
  if (!isFinite(originX)) { originX = 0; originY = 0; }

  const biomeMap = {};
  for (const r of rects) {
    const biome = toBiome(r.fill);
    if (!biome) continue;
    const col = Math.floor(r.x / detectedTileSize);
    const row = Math.floor(r.y / detectedTileSize);
    biomeMap[`${row},${col}`] = biome;
  }

  while ((match = circleRegex.exec(htmlContent)) !== null) {
    const cx = parseFloat(match[1]);
    const cy = parseFloat(match[2]);
    const fill = match[4];
    if (skipFills.has(fill)) continue;
    const biome = toBiome(fill);
    if (!biome || biome === 'ocean') continue;
    const col = Math.floor(cx / detectedTileSize);
    const row = Math.floor(cy / detectedTileSize);
    const k = `${row},${col}`;
    const existing = biomeMap[k];
    if (!existing || existing === 'ocean') biomeMap[k] = biome;
    if (cx > maxX) maxX = cx;
    if (cy > maxY) maxY = cy;
  }

  return { biomeMap, cols: Math.ceil(maxX / detectedTileSize), rows: Math.ceil(maxY / detectedTileSize), tileSize: detectedTileSize };
}

function getBiomeAt(biomeMap, col, row) {
  return biomeMap[`${row},${col}`] || 'ocean';
}

function hasBiomeNearby(biomeMap, col, row, target, radius) {
  const r = radius == null ? 2 : radius;
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      if (dx === 0 && dy === 0) continue;
      if (getBiomeAt(biomeMap, col + dx, row + dy) === target) return true;
    }
  }
  return false;
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

// ---- Capas estilo libro ----

function layerParchment(w, h) {
  return `\n<!-- Tolkien: Pergamino -->\n` +
    `<rect x="0" y="0" width="${w}" height="${h}" fill="rgba(232,213,163,0.16)" />\n` +
    `<rect x="8" y="8" width="${w - 16}" height="${h - 16}" fill="none" stroke="${INK}" stroke-width="2" opacity="0.55" />\n` +
    `<rect x="14" y="14" width="${w - 28}" height="${h - 28}" fill="none" stroke="${INK}" stroke-width="0.8" opacity="0.4" />\n`;
}

function layerWashes(biomeMap, ts, maxCol, maxRow, rng) {
  let svg = '\n<!-- Tolkien: Lavados -->\n';
  for (let row = 0; row < maxRow; row++) {
    for (let col = 0; col < maxCol; col++) {
      const b = getBiomeAt(biomeMap, col, row);
      if (b === 'ocean') continue;
      if (rng() > 0.75) continue;
      const cx = col * ts + ts / 2 + (rng() - 0.5) * ts * 0.3;
      const cy = row * ts + ts / 2 + (rng() - 0.5) * ts * 0.3;
      const rx = ts * (0.45 + rng() * 0.25);
      svg += `<ellipse cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" rx="${rx.toFixed(1)}" ry="${(rx * 0.7).toFixed(1)}" fill="${washColors[b]}" />\n`;
    }
  }
  return svg;
}

function coastPolylines(biomeMap, maxCol, maxRow, ts) {
  const edges = [];
  const dirs = [
    { dx: 1, dy: 0 }, { dx: -1, dy: 0 },
    { dx: 0, dy: 1 }, { dx: 0, dy: -1 }
  ];
  for (let row = 0; row < maxRow; row++) {
    for (let col = 0; col < maxCol; col++) {
      if (getBiomeAt(biomeMap, col, row) !== 'ocean') continue;
      let touchesLand = false;
      for (const d of dirs) {
        if (isLandBiome(getBiomeAt(biomeMap, col + d.dx, row + d.dy))) { touchesLand = true; break; }
      }
      if (!touchesLand) continue;
      for (const d of dirs) {
        if (!isLandBiome(getBiomeAt(biomeMap, col + d.dx, row + d.dy))) continue;
        const x0 = col * ts, y0 = row * ts;
        let ax, ay, bx, by;
        if (d.dx === 1) { ax = x0 + ts; ay = y0; bx = x0 + ts; by = y0 + ts; }
        else if (d.dx === -1) { ax = x0; ay = y0 + ts; bx = x0; by = y0; }
        else if (d.dy === 1) { ax = x0 + ts; ay = y0 + ts; bx = x0; by = y0 + ts; }
        else { ax = x0; ay = y0; bx = x0 + ts; by = y0; }
        // Lado agua = opuesto al vecino de tierra
        edges.push({ ax, ay, bx, by, wx: -d.dx, wy: -d.dy });
      }
    }
  }
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
  const polys = [];
  for (let i = 0; i < edges.length; i++) {
    if (used[i]) continue;
    used[i] = true;
    const line = [{ x: edges[i].ax, y: edges[i].ay, wx: edges[i].wx, wy: edges[i].wy }, { x: edges[i].bx, y: edges[i].by, wx: edges[i].wx, wy: edges[i].wy }];
    let ext = true;
    while (ext) {
      ext = false;
      const last = line[line.length - 1];
      for (const j of (startMap.get(key(last.x, last.y)) || [])) {
        if (used[j]) continue;
        used[j] = true;
        line.push({ x: edges[j].bx, y: edges[j].by, wx: edges[j].wx, wy: edges[j].wy });
        ext = true; break;
      }
      if (ext) continue;
      for (const j of (endMap.get(key(last.x, last.y)) || [])) {
        if (used[j]) continue;
        used[j] = true;
        line.push({ x: edges[j].ax, y: edges[j].ay, wx: edges[j].wx, wy: edges[j].wy });
        ext = true; break;
      }
    }
    ext = true;
    while (ext) {
      ext = false;
      const f = line[0];
      for (const j of (endMap.get(key(f.x, f.y)) || [])) {
        if (used[j]) continue;
        used[j] = true;
        line.unshift({ x: edges[j].ax, y: edges[j].ay, wx: edges[j].wx, wy: edges[j].wy });
        ext = true; break;
      }
      if (ext) continue;
      for (const j of (startMap.get(key(f.x, f.y)) || [])) {
        if (used[j]) continue;
        used[j] = true;
        line.unshift({ x: edges[j].bx, y: edges[j].by, wx: edges[j].wx, wy: edges[j].wy });
        ext = true; break;
      }
    }
    if (line.length >= 2) polys.push(line);
  }
  return polys;
}

function wavyPath(points, amp, rng) {
  return points.map((p, i) => {
    if (i === 0 || i === points.length - 1) return p;
    const dx = points[Math.min(i + 1, points.length - 1)].x - points[i - 1].x;
    const dy = points[Math.min(i + 1, points.length - 1)].y - points[i - 1].y;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    const off = (rng() - 0.5) * amp * 2;
    return { x: p.x + (-dy / len) * off, y: p.y + (dx / len) * off };
  });
}

function layerCoast(biomeMap, ts, maxCol, maxRow, rng) {
  let svg = '\n<!-- Tolkien: Costa dibujada -->\n';
  for (const line of coastPolylines(biomeMap, maxCol, maxRow, ts)) {
    if (line.length < 3) continue;
    const smooth = chaikinSmooth(line, false);
    // Normal hacia el agua promediada del tramo
    let anx = 0, any = 0;
    for (const p of line) { anx += p.wx || 0; any += p.wy || 0; }
    const alen = Math.sqrt(anx * anx + any * any) || 1;
    anx /= alen; any /= alen;
    // Fundido pronunciado hacia el azul antes de la tinta
    svg += waterFeather(smooth, anx, any, ts);
    const wavy = wavyPath(smooth, ts * 0.08, rng);
    svg += `<path d="${pathFromPoints(wavy)}" fill="none" stroke="${INK}" stroke-width="1.6" opacity="0.75" stroke-linecap="round" stroke-linejoin="round" />\n`;
    const inner = wavy.map(p => ({ x: p.x, y: p.y }));
    svg += `<path d="${pathFromPoints(inner)}" fill="none" stroke="${INK}" stroke-width="0.7" opacity="0.5" stroke-linecap="round" stroke-linejoin="round" />\n`;
  }
  return svg;
}

function seaShoreVector(biomeMap, col, row) {
  // Dirección hacia el agua = opuesta a la tierra más cercana.
  // No usa promedio de vecinos: en estrechos simétricos ese promedio se anula.
  let dist = 99, dx = 0, dy = 0;
  for (let r = 1; r <= 3; r++) {
    let found = false;
    for (let dyy = -r; dyy <= r && !found; dyy++) {
      for (let dxx = -r; dxx <= r && !found; dxx++) {
        if (Math.max(Math.abs(dxx), Math.abs(dyy)) !== r) continue;
        if (isLandBiome(getBiomeAt(biomeMap, col + dxx, row + dyy))) {
          dist = r; dx = -dxx; dy = -dyy; found = true;
        }
      }
    }
    if (found) break;
  }
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  return { nx: dx / len, ny: dy / len, dist };
}

function layerSeaWaves(biomeMap, ts, maxCol, maxRow, rng) {
  let svg = '\n<!-- Tolkien: Olas -->\n';
  const WAVE = '#4a6f8a';
  for (let row = 0; row < maxRow; row++) {
    for (let col = 0; col < maxCol; col++) {
      if (getBiomeAt(biomeMap, col, row) !== 'ocean') continue;
      const v = seaShoreVector(biomeMap, col, row);
      if (v.dist < 1 || v.dist > 3) continue;
      // Tercera franja más rala para que se atenúe mar adentro
      if (v.dist === 3 && rng() > 0.5) continue;
      const cx = col * ts + ts / 2 + (rng() - 0.5) * ts * 0.3;
      const cy = row * ts + ts / 2 + (rng() - 0.5) * ts * 0.3;
      // Tangente = perpendicular a la dirección mar adentro
      const tx = -v.ny, ty = v.nx;
      const len = ts * (v.dist === 1 ? 0.32 : 0.26);
      const op = v.dist === 1 ? 0.65 : v.dist === 2 ? 0.5 : 0.35;
      const mx = cx - tx * len, my = cy - ty * len;
      const ex = cx + tx * len, ey = cy + ty * len;
      const bend = ts * 0.1;
      svg += `<path d="M${mx.toFixed(1)},${my.toFixed(1)} q${(tx * len).toFixed(1)},${(ty * len - bend).toFixed(1)} ${(ex - mx).toFixed(1)},${(ey - my).toFixed(1)}" fill="none" stroke="${WAVE}" stroke-width="0.9" opacity="${op}" stroke-linecap="round" />\n`;
      if (v.dist === 1 && rng() < 0.4) {
        svg += `<path d="M${(cx - tx * len * 0.5).toFixed(1)},${(cy + ts * 0.22).toFixed(1)} q${(tx * len * 0.5).toFixed(1)},${(-ts * 0.06).toFixed(1)} ${(tx * len).toFixed(1)},0" fill="none" stroke="${WAVE}" stroke-width="0.7" opacity="0.4" stroke-linecap="round" />\n`;
      }
    }
  }
  return svg;
}

function downhillStep(biomeMap, col, row) {
  const here = biomeElevation[getBiomeAt(biomeMap, col, row)] ?? 0;
  let best = null;
  const dirs = [
    [1, 0], [-1, 0], [0, 1], [0, -1],
    [1, 1], [-1, 1], [1, -1], [-1, -1]
  ];
  for (const [dx, dy] of dirs) {
    const b = getBiomeAt(biomeMap, col + dx, row + dy);
    const e = biomeElevation[b] ?? 0;
    if (e < here && (!best || e < best.e)) best = { dx, dy, e, biome: b };
  }
  return best;
}

const RIVER_INK = '#4a6f8a';

// Trazado Tolkien de un cauce (extraído de layerRivers sin cambios visuales).
// pts: puntos píxel ordenados naciente→desembocadura; w0<w1<w2 anchos por tercios.
function drawRiverPath(pts, w0, w1, w2, ts, rng) {
  let s = '';
  const sm = chaikinSmooth(pts, false);
  const n = sm.length;
  const third = Math.floor(n / 3);
  const segs = [
    sm.slice(0, third + 1),
    sm.slice(third, 2 * third + 1),
    sm.slice(2 * third)
  ];
  const widths = [w0, w1, w2];
  segs.forEach((sg, i) => {
    if (sg.length < 2) return;
    s += `<path d="${pathFromPoints(sg)}" fill="none" stroke="${RIVER_INK}" stroke-width="${widths[i]}" opacity="0.85" stroke-linecap="round" stroke-linejoin="round" />\n`;
  });
  // Hilos de corriente estilo lienzo: curvas paralelas al flujo, azul claro
  let side = 1;
  for (let i = 2; i < n - 2; i += 3) {
    if (rng() < 0.3) continue;
    const p0 = sm[Math.max(0, i - 1)], p1 = sm[Math.min(n - 1, i + 1)];
    let dx = p1.x - p0.x, dy = p1.y - p0.y;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    dx /= len; dy /= len;
    side = -side;
    const L = ts * (0.4 + rng() * 0.4);
    const off = side * (0.8 + rng() * 1.2);
    const nx = -dy, ny = dx;
    const sx = sm[i].x + nx * off, sy = sm[i].y + ny * off;
    const ex = sx + dx * L, ey = sy + dy * L;
    const bend = (rng() - 0.5) * ts * 0.25;
    s += `<path d="M${sx.toFixed(1)},${sy.toFixed(1)} q${(dx * L * 0.5 - nx * bend).toFixed(1)},${(dy * L * 0.5 - ny * bend).toFixed(1)} ${(ex - sx).toFixed(1)},${(ey - sy).toFixed(1)}" fill="none" stroke="rgba(207,229,242,${(0.45 + rng() * 0.25).toFixed(2)})" stroke-width="0.8" stroke-linecap="round" />\n`;
  }
  return s;
}

function drawFanPath(mouth, dirx, diry, ts) {
  // Desembocadura: abanico de 3 trazos + mancha tenue
  let s = '';
  const len = ts * 1.4;
  for (const spread of [-0.5, 0, 0.5]) {
    const ang = Math.atan2(diry, dirx) + spread;
    const ex = mouth.x + Math.cos(ang) * len;
    const ey = mouth.y + Math.sin(ang) * len;
    s += `<path d="M${mouth.x.toFixed(1)},${mouth.y.toFixed(1)} Q${((mouth.x + ex) / 2).toFixed(1)},${((mouth.y + ey) / 2).toFixed(1)} ${ex.toFixed(1)},${ey.toFixed(1)}" fill="none" stroke="${RIVER_INK}" stroke-width="2.2" opacity="0.6" stroke-linecap="round" />\n`;
  }
  s += `<ellipse cx="${(mouth.x + dirx * ts * 0.5).toFixed(1)}" cy="${(mouth.y + diry * ts * 0.5).toFixed(1)}" rx="${(ts * 0.45).toFixed(1)}" ry="${(ts * 0.35).toFixed(1)}" fill="rgba(74,111,138,0.25)" />\n`;
  return s;
}

/**
 * Ríos REALES (generateRivers de AiA) con estilo Tolkien.
 * trails: [{x,y}...] ordenados naciente→fin, en coords de tile.
 * A diferencia del procedural: sin nacimientos aleatorios, sin descarte por
 * longitud (los cortos se dibujan finos, no se borran), sin afluentes falsos.
 */
export function layerRealRivers(trails, opts = {}) {
  const { ts, padding = 0, rng, terrainAt } = opts;
  let svg = '\n<!-- Tolkien: Ríos reales -->\n';
  const isWater = (t) => t === 'ocean' || t === 'lake' || t === 'coast';
  for (const trail of trails || []) {
    if (!trail || trail.length === 0) continue;
    const pts = trail.map((p) => ({
      x: (padding + p.x) * ts + ts / 2 + (rng() - 0.5) * ts * 0.35,
      y: (padding + p.y) * ts + ts / 2 + (rng() - 0.5) * ts * 0.35,
    }));
    if (pts.length < 2) {
      // Río de 1 tile: mancha fina en vez de borrarlo.
      svg += `<circle cx="${pts[0].x.toFixed(1)}" cy="${pts[0].y.toFixed(1)}" r="${(ts * 0.18).toFixed(1)}" fill="${RIVER_INK}" opacity="0.8" />\n`;
      continue;
    }
    // Ancho proporcional a la longitud real (nunca el borrón fijo 2/4.5/8).
    const sc = Math.min(1.4, Math.max(0.5, trail.length / 30));
    svg += drawRiverPath(pts, 2 * sc, 4.5 * sc, 8 * sc, ts, rng);
    const last = trail[trail.length - 1];
    const prev = trail.length > 1 ? trail[trail.length - 2] : last;
    let mdx = last.x - prev.x, mdy = last.y - prev.y;
    if (mdx === 0 && mdy === 0) mdx = 0;
    // ¿Termina en agua? Busca vecino agua para orientar el abanico.
    let mouthDir = null;
    if (typeof terrainAt === 'function') {
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        if (isWater(terrainAt(last.x + dx, last.y + dy))) { mouthDir = { x: dx, y: dy }; break; }
      }
    } else if (mdx !== 0 || mdy !== 0) {
      mouthDir = { x: mdx, y: mdy };
    }
    const endPt = pts[pts.length - 1];
    if (mouthDir) {
      const mouth = {
        x: endPt.x + mouthDir.x * ts * 0.3,
        y: endPt.y + mouthDir.y * ts * 0.3,
      };
      svg += drawFanPath(mouth, mouthDir.x, mouthDir.y, ts);
    } else {
      // Fin tierra adentro (mínimo local): adelgaza la punta, no la corta en seco.
      const L = Math.hypot(mdx, mdy) || 1;
      const tipX = endPt.x + (mdx / L) * ts * 0.5;
      const tipY = endPt.y + (mdy / L) * ts * 0.5;
      svg += `<path d="M${endPt.x.toFixed(1)},${endPt.y.toFixed(1)} L${tipX.toFixed(1)},${tipY.toFixed(1)}" fill="none" stroke="${RIVER_INK}" stroke-width="1.2" opacity="0.5" stroke-linecap="round" />\n`;
    }
  }
  return svg;
}

function layerRivers(biomeMap, ts, maxCol, maxRow, rng) {
  let svg = '\n<!-- Tolkien: Ríos -->\n';
  const RIVER = '#4a6f8a';
  const farFromOcean = (col, row) => {
    for (let dy = -3; dy <= 3; dy++) {
      for (let dx = -3; dx <= 3; dx++) {
        if (getBiomeAt(biomeMap, col + dx, row + dy) === 'ocean') return false;
      }
    }
    return true;
  };
  const drawRiver = (pts, w0, w1, w2) => {
    let s = '';
    const sm = chaikinSmooth(pts, false);
    const n = sm.length;
    const third = Math.floor(n / 3);
    const segs = [
      sm.slice(0, third + 1),
      sm.slice(third, 2 * third + 1),
      sm.slice(2 * third)
    ];
    const widths = [w0, w1, w2];
    segs.forEach((sg, i) => {
      if (sg.length < 2) return;
      s += `<path d="${pathFromPoints(sg)}" fill="none" stroke="${RIVER}" stroke-width="${widths[i]}" opacity="0.85" stroke-linecap="round" stroke-linejoin="round" />\n`;
    });
    // Hilos de corriente estilo lienzo: curvas paralelas al flujo, azul claro
    let side = 1;
    for (let i = 2; i < n - 2; i += 3) {
      if (rng() < 0.3) continue;
      const p0 = sm[Math.max(0, i - 1)], p1 = sm[Math.min(n - 1, i + 1)];
      let dx = p1.x - p0.x, dy = p1.y - p0.y;
      const len = Math.sqrt(dx * dx + dy * dy) || 1;
      dx /= len; dy /= len;
      side = -side;
      const L = ts * (0.4 + rng() * 0.4);
      const off = side * (0.8 + rng() * 1.2);
      const nx = -dy, ny = dx;
      const sx = sm[i].x + nx * off, sy = sm[i].y + ny * off;
      const ex = sx + dx * L, ey = sy + dy * L;
      const bend = (rng() - 0.5) * ts * 0.25;
      s += `<path d="M${sx.toFixed(1)},${sy.toFixed(1)} q${(dx * L * 0.5 - nx * bend).toFixed(1)},${(dy * L * 0.5 - ny * bend).toFixed(1)} ${(ex - sx).toFixed(1)},${(ey - sy).toFixed(1)}" fill="none" stroke="rgba(207,229,242,${(0.45 + rng() * 0.25).toFixed(2)})" stroke-width="0.8" stroke-linecap="round" />\n`;
    }
    return s;
  };
  const drawFan = (mouth, dirx, diry) => {
    // Desembocadura: abanico de 3 trazos + mancha tenue
    let s = '';
    const len = ts * 1.4;
    for (const spread of [-0.5, 0, 0.5]) {
      const ang = Math.atan2(diry, dirx) + spread;
      const ex = mouth.x + Math.cos(ang) * len;
      const ey = mouth.y + Math.sin(ang) * len;
      s += `<path d="M${mouth.x.toFixed(1)},${mouth.y.toFixed(1)} Q${((mouth.x + ex) / 2).toFixed(1)},${((mouth.y + ey) / 2).toFixed(1)} ${ex.toFixed(1)},${ey.toFixed(1)}" fill="none" stroke="${RIVER}" stroke-width="2.2" opacity="0.6" stroke-linecap="round" />\n`;
    }
    s += `<ellipse cx="${(mouth.x + dirx * ts * 0.5).toFixed(1)}" cy="${(mouth.y + diry * ts * 0.5).toFixed(1)}" rx="${(ts * 0.45).toFixed(1)}" ry="${(ts * 0.35).toFixed(1)}" fill="rgba(74,111,138,0.25)" />\n`;
    return s;
  };
  for (let row = 0; row < maxRow; row++) {
    for (let col = 0; col < maxCol; col++) {
      const b = getBiomeAt(biomeMap, col, row);
      if (b !== 'mountain') continue;
      if (!farFromOcean(col, row)) continue;
      if (rng() > 0.06) continue;
      let cx = col, cy = row;
      let mdx = 0, mdy = 0, ppx = -1, ppy = -1;
      const pts = [{ x: cx * ts + ts / 2, y: cy * ts + ts / 2 }];
      let mouth = null, mouthDir = null, mouthKind = null;
      for (let s = 0; s < 90; s++) {
        let st = downhillStep(biomeMap, cx, cy);
        if (!st) {
          // Inercia en llano: seguir la última dirección
          if (mdx === 0 && mdy === 0) break;
          st = { dx: mdx, dy: mdy };
        }
        let nx = cx + st.dx, ny = cy + st.dy;
        // Anti-retroceso: si volvería a la celda anterior, seguir con inercia
        if (nx === ppx && ny === ppy) {
          if (mdx === 0 && mdy === 0) break;
          nx = cx + mdx; ny = cy + mdy;
        }
        mdx = nx - cx; mdy = ny - cy;
        const nb = getBiomeAt(biomeMap, nx, ny);
        if (nb === 'ocean' || nb === 'lake') {
          // Desembocadura: terminar justo en el borde, no dentro del agua
          const mp = {
            x: (cx + st.dx * 0.5) * ts + ts / 2,
            y: (cy + st.dy * 0.5) * ts + ts / 2
          };
          pts.push(mp);
          mouth = mp; mouthDir = { x: st.dx, y: st.dy }; mouthKind = nb;
          break;
        }
        const k = `${nx},${ny}`;
        ppx = cx; ppy = cy;
        cx = nx; cy = ny;
        pts.push({
          x: cx * ts + ts / 2 + (rng() - 0.5) * ts * 0.5,
          y: cy * ts + ts / 2 + (rng() - 0.5) * ts * 0.5
        });
      }
      if (pts.length < 10) continue;
      svg += drawRiver(pts, 2, 4.5, 8);
      if (mouth) svg += drawFan(mouth, mouthDir.x, mouthDir.y);
      // Afluentes: 2-3 arroyos cortos que se unen al cauce principal
      if (pts.length >= 10) {
        const joins = 2 + Math.floor(rng() * 2);
        for (let j = 0; j < joins; j++) {
          const ji = 3 + Math.floor(rng() * (pts.length - 6));
          const jp = pts[ji];
          const ang = rng() * Math.PI * 2;
          const tlen = ts * (1.2 + rng() * 1.2);
          const sp = { x: jp.x + Math.cos(ang) * tlen, y: jp.y + Math.sin(ang) * tlen };
          const mp = { x: (sp.x + jp.x) / 2 + (rng() - 0.5) * 3, y: (sp.y + jp.y) / 2 + (rng() - 0.5) * 3 };
          svg += `<path d="M${sp.x.toFixed(1)},${sp.y.toFixed(1)} Q${mp.x.toFixed(1)},${mp.y.toFixed(1)} ${jp.x.toFixed(1)},${jp.y.toFixed(1)}" fill="none" stroke="${RIVER}" stroke-width="1.2" opacity="0.75" stroke-linecap="round" />\n`;
        }
      }
    }
  }
  return svg;
}

function layerMountains(biomeMap, ts, maxCol, maxRow, rng) {
  let svg = '\n<!-- Tolkien: Montañas -->\n';
  for (let row = 0; row < maxRow; row++) {
    for (let col = 0; col < maxCol; col++) {
      if (getBiomeAt(biomeMap, col, row) !== 'mountain') continue;
      if (rng() > 0.55) continue;
      const cx = col * ts + ts / 2 + (rng() - 0.5) * ts * 0.3;
      const cy = row * ts + ts / 2 + (rng() - 0.5) * ts * 0.3;
      const snowNear = hasBiomeNearby(biomeMap, col, row, 'snow', 2);
      // Pico nevado al doble: más alto y ancho, con falda de nieve común
      const w = ts * (0.48 + rng() * 0.27) * (snowNear ? 1.3 : 1);
      const h = ts * (0.6 + rng() * 0.45) * (snowNear ? 2 : 1);
      const apexX = cx, apexY = cy - h * 0.6;
      if (snowNear) {
        const rot = (rng() - 0.5) * 30;
        svg += `<ellipse cx="${cx.toFixed(1)}" cy="${(cy + h * 0.35).toFixed(1)}" rx="${(w * 1.1).toFixed(1)}" ry="${(h * 0.28).toFixed(1)}" fill="rgba(244,248,252,0.55)" transform="rotate(${rot.toFixed(1)} ${cx.toFixed(1)} ${(cy + h * 0.35).toFixed(1)})" />\n`;
      }
      svg += `<path d="M${(cx - w).toFixed(1)},${(cy + h * 0.4).toFixed(1)} L${apexX.toFixed(1)},${apexY.toFixed(1)} L${(cx + w).toFixed(1)},${(cy + h * 0.4).toFixed(1)}" fill="none" stroke="${INK}" stroke-width="${snowNear ? 2.2 : 1.8}" opacity="0.85" stroke-linecap="round" stroke-linejoin="round" />\n`;
      svg += `<path d="M${apexX.toFixed(1)},${apexY.toFixed(1)} L${(cx + w * 0.55).toFixed(1)},${(cy + h * 0.1).toFixed(1)}" fill="none" stroke="${INK}" stroke-width="1" opacity="0.55" stroke-linecap="round" />\n`;
      if (snowNear) {
        svg += `<path d="M${(apexX - w * 0.3).toFixed(1)},${(apexY + h * 0.28).toFixed(1)} L${apexX.toFixed(1)},${apexY.toFixed(1)} L${(apexX + w * 0.3).toFixed(1)},${(apexY + h * 0.28).toFixed(1)}" fill="rgba(255,255,255,0.92)" stroke="${INK}" stroke-width="0.6" opacity="0.9" stroke-linejoin="round" />\n`;
      }
      if (rng() < 0.4) {
        svg += `<path d="M${(cx - w * 0.7).toFixed(1)},${(cy + h * 0.55).toFixed(1)} l${(w * 0.35).toFixed(1)},${(-h * 0.2).toFixed(1)}" fill="none" stroke="${INK}" stroke-width="0.7" opacity="0.45" stroke-linecap="round" />\n`;
      }
    }
  }
  return svg;
}

function layerHills(biomeMap, ts, maxCol, maxRow, rng) {
  let svg = '\n<!-- Tolkien: Colinas y tundra -->\n';
  for (let row = 0; row < maxRow; row++) {
    for (let col = 0; col < maxCol; col++) {
      const b = getBiomeAt(biomeMap, col, row);
      if (b !== 'desert' && b !== 'plain') continue;
      if (hasBiomeNearby(biomeMap, col, row, 'snow', 2)) continue;
      if (rng() > 0.3) continue;
      const cx = col * ts + ts / 2 + (rng() - 0.5) * ts * 0.5;
      const cy = row * ts + ts / 2 + (rng() - 0.5) * ts * 0.5;
      if (b === 'desert') {
        const w = ts * (0.3 + rng() * 0.25);
        svg += `<path d="M${(cx - w).toFixed(1)},${cy.toFixed(1)} Q${cx.toFixed(1)},${(cy - ts * 0.22).toFixed(1)} ${(cx + w).toFixed(1)},${cy.toFixed(1)}" fill="none" stroke="${INK}" stroke-width="0.8" opacity="0.5" stroke-linecap="round" />\n`;
      } else {
        svg += `<path d="M${cx.toFixed(1)},${cy.toFixed(1)} l0,${(-ts * 0.18).toFixed(1)} M${(cx - ts * 0.08).toFixed(1)},${(cy - ts * 0.06).toFixed(1)} l${(ts * 0.16).toFixed(1)},0" fill="none" stroke="#4a5d3a" stroke-width="0.9" opacity="0.6" stroke-linecap="round" />\n`;
      }
    }
  }
  return svg;
}

function coniferStamp(cx, cy, s, g, opacity) {
  const top = cy - s * 0.7, base = cy + s * 0.7;
  const r1 = s * 0.30, r2 = s * 0.42, r3 = s * 0.52;
  const y1 = cy - s * 0.38, y2 = cy - s * 0.05, y3 = cy + s * 0.28;
  return `<path d="M${cx.toFixed(1)},${base.toFixed(1)} L${cx.toFixed(1)},${top.toFixed(1)} ` +
    `M${cx.toFixed(1)},${y1.toFixed(1)} l${(-r1).toFixed(1)},${(s * 0.18).toFixed(1)} M${cx.toFixed(1)},${y1.toFixed(1)} l${r1.toFixed(1)},${(s * 0.18).toFixed(1)} ` +
    `M${cx.toFixed(1)},${y2.toFixed(1)} l${(-r2).toFixed(1)},${(s * 0.22).toFixed(1)} M${cx.toFixed(1)},${y2.toFixed(1)} l${r2.toFixed(1)},${(s * 0.22).toFixed(1)} ` +
    `M${cx.toFixed(1)},${y3.toFixed(1)} l${(-r3).toFixed(1)},${(s * 0.24).toFixed(1)} M${cx.toFixed(1)},${y3.toFixed(1)} l${r3.toFixed(1)},${(s * 0.24).toFixed(1)} ` +
    `M${(cx - s * 0.2).toFixed(1)},${base.toFixed(1)} l${(s * 0.4).toFixed(1)},0" ` +
    `fill="none" stroke="${g}" stroke-width="1.2" opacity="${opacity}" stroke-linecap="round" />\n`;
}

function layerForests(biomeMap, ts, maxCol, maxRow, rng) {
  let svg = '\n<!-- Tolkien: Bosques -->\n';
  const INK_GREEN = '#2f4a26';
  const HERO_GREEN = '#43682f';
  // Dos sellos por bloque 2x2 en bosque denso: dosel con dos planos
  for (let brow = 0; brow < maxRow; brow += 2) {
    for (let bcol = 0; bcol < maxCol; bcol += 2) {
      // Bioma dominante del bloque (centro)
      const b = getBiomeAt(biomeMap, bcol + 1, brow + 1);
      const bb = (b === 'forest' || b === 'plain') ? b : getBiomeAt(biomeMap, bcol, brow);
      if (bb !== 'forest' && bb !== 'plain') continue;
      const nearSnow = hasBiomeNearby(biomeMap, bcol + 1, brow + 1, 'snow', 2);
      if (nearSnow && rng() > 0.3) continue;
      const density = bb === 'forest' ? 0.85 : 0.3;
      if (rng() > density) continue;

      const bx = bcol * ts, by = brow * ts;
      const hero = rng() < 0.18;

      if (bb === 'plain' && rng() < 0.5) {
        // Pradera aislada: mata baja, no conífera
        const cx = bx + ts + (rng() - 0.5) * ts * 0.3;
        const cy = by + ts + (rng() - 0.5) * ts * 0.3;
        const s = ts * 0.42;
        svg += `<path d="M${cx.toFixed(1)},${cy.toFixed(1)} l0,${(-s * 0.5).toFixed(1)} M${(cx - s * 0.25).toFixed(1)},${cy.toFixed(1)} l0,${(-s * 0.35).toFixed(1)} M${(cx + s * 0.25).toFixed(1)},${cy.toFixed(1)} l0,${(-s * 0.35).toFixed(1)}" fill="none" stroke="${INK_GREEN}" stroke-width="1" opacity="0.7" stroke-linecap="round" />\n`;
        continue;
      }

      // Sello 1 (frente): grande y claro, a 1/3 del bloque
      const cx1 = bx + ts * 0.65 + (rng() - 0.5) * ts * 0.2;
      const cy1 = by + ts * 1.15 + (rng() - 0.5) * ts * 0.2;
      const s1 = ts * (hero ? 0.5 : 0.42);
      svg += coniferStamp(cx1, cy1, s1, hero ? HERO_GREEN : INK_GREEN, 0.9);
      // Sello 2 (fondo): algo más chico y oscuro, a 2/3 del bloque
      if (bb === 'forest' && rng() < 0.8) {
        const cx2 = bx + ts * 1.35 + (rng() - 0.5) * ts * 0.2;
        const cy2 = by + ts * 0.75 + (rng() - 0.5) * ts * 0.2;
        const s2 = s1 * 0.8;
        svg += coniferStamp(cx2, cy2, s2, INK_GREEN, 0.85);
      }
    }
  }
  return svg;
}

function touchesOcean(biomeMap, col, row) {
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      if (getBiomeAt(biomeMap, col + dx, row + dy) === 'ocean') return true;
    }
  }
  return false;
}

function layerLakes(biomeMap, ts, maxCol, maxRow, rng) {
  let svg = '\n<!-- Tolkien: Lagos -->\n';
  // Componentes conexos de lago para una sola lámina por lago
  const seen = new Set();
  const comps = [];
  for (let row = 0; row < maxRow; row++) {
    for (let col = 0; col < maxCol; col++) {
      if (getBiomeAt(biomeMap, col, row) !== 'lake') continue;
      const k = `${row},${col}`;
      if (seen.has(k)) continue;
      const comp = [];
      const stack = [[col, row]];
      seen.add(k);
      while (stack.length) {
        const [cx0, cy0] = stack.pop();
        comp.push([cx0, cy0]);
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = cx0 + dx, ny = cy0 + dy;
          const nk = `${ny},${nx}`;
          if (nx < 0 || ny < 0 || nx >= maxCol || ny >= maxRow || seen.has(nk)) continue;
          if (getBiomeAt(biomeMap, nx, ny) !== 'lake') continue;
          seen.add(nk);
          stack.push([nx, ny]);
        }
      }
      comps.push(comp);
    }
  }

  for (const comp of comps) {
    // Caja del componente y flags
    let c0 = Infinity, c1 = -Infinity, r0 = Infinity, r1 = -Infinity;
    let wintry = false;
    let coastal = false;
    for (const [col, row] of comp) {
      if (col < c0) c0 = col;
      if (col > c1) c1 = col;
      if (row < r0) r0 = row;
      if (row > r1) r1 = row;
      if (!wintry && (hasBiomeNearby(biomeMap, col, row, 'snow', 2) || hasBiomeNearby(biomeMap, col, row, 'mountain', 2))) wintry = true;
      if (!coastal && touchesOcean(biomeMap, col, row)) coastal = true;
    }
    const cx = (c0 + c1 + 1) * ts / 2;
    const cy = (r0 + r1 + 1) * ts / 2;
    const hw = (c1 - c0 + 1) * ts / 2;
    const hh = (r1 - r0 + 1) * ts / 2;

    // Laguna costera: es ensenada del mar; el campo de olas la texturiza.
    // Sin ribete, hielo ni blancos para no generar formas raras sobre el mar.
    if (coastal) {
      continue;
    }

    // Ribete alineado al tile: rect redondeado insetado, no elipse flotante
    for (const [col, row] of comp) {
      const x = col * ts + 2, y = row * ts + 2, w = ts - 4, h = ts - 4;
      svg += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" rx="3" fill="none" stroke="${INK}" stroke-width="0.9" opacity="0.55" />\n`;
    }
    if (wintry) {
      svg += `<ellipse cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" rx="${(hw * 0.8).toFixed(1)}" ry="${(hh * 0.75).toFixed(1)}" fill="rgba(235,242,250,0.75)" />\n`;
      const rips = 1 + Math.min(2, Math.floor((c1 - c0 + r1 - r0) / 2));
      for (let i = 0; i < rips; i++) {
        const ry = cy - hh * 0.3 + i * hh * 0.3;
        svg += `<path d="M${(cx - hw * 0.55).toFixed(1)},${ry.toFixed(1)} q${(hw * 0.55).toFixed(1)},${(-ts * 0.08).toFixed(1)} ${(hw * 1.1).toFixed(1)},0" fill="none" stroke="rgba(255,255,255,0.8)" stroke-width="0.9" stroke-linecap="round" />\n`;
      }
    } else {
      svg += `<path d="M${(cx - hw * 0.55).toFixed(1)},${cy.toFixed(1)} q${(hw * 0.55).toFixed(1)},${(-ts * 0.08).toFixed(1)} ${(hw * 1.1).toFixed(1)},0" fill="none" stroke="#4a6f8a" stroke-width="0.9" opacity="0.7" stroke-linecap="round" />\n`;
    }
  }
  return svg;
}

function layerSnow(biomeMap, ts, maxCol, maxRow, rng) {
  let svg = '\n<!-- Tolkien: Nieve -->\n';
  // Componentes conexos de nieve: solo la pegada a montaña es sabana real
  const seen = new Set();
  const comps = [];
  for (let row = 0; row < maxRow; row++) {
    for (let col = 0; col < maxCol; col++) {
      if (getBiomeAt(biomeMap, col, row) !== 'snow') continue;
      const k = `${row},${col}`;
      if (seen.has(k)) continue;
      const comp = [];
      const stack = [[col, row]];
      seen.add(k);
      while (stack.length) {
        const [cx0, cy0] = stack.pop();
        comp.push([cx0, cy0]);
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = cx0 + dx, ny = cy0 + dy;
          const nk = `${ny},${nx}`;
          if (nx < 0 || ny < 0 || nx >= maxCol || ny >= maxRow || seen.has(nk)) continue;
          if (getBiomeAt(biomeMap, nx, ny) !== 'snow') continue;
          seen.add(nk);
          stack.push([nx, ny]);
        }
      }
      comps.push(comp);
    }
  }

  const touchesMountain = (comp) => comp.some(([col, row]) =>
    hasBiomeNearby(biomeMap, col, row, 'mountain', 1));

  for (const comp of comps) {
    // Nieve huérfana (sin montaña cerca): no es campo, se descarta
    if (!touchesMountain(comp)) {
      if (comp.length <= 2 && rng() < 0.3) {
        const [col, row] = comp[0];
        const cx = col * ts + ts / 2, cy = row * ts + ts / 2;
        svg += `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${(ts * 0.12).toFixed(1)}" fill="rgba(255,255,255,0.7)" />\n`;
      }
      continue;
    }
    // Blobs irregulares por celda (nunca elipses por bbox): filo opaco
    // en el borde junto a no-nieve, blanco lleno hacia adentro.
    // Las celdas montaña no se pintan: sus picos nevados van encima.
    const blob = (cx, cy, r, alpha) => {
      const n = 5 + Math.floor(rng() * 3);
      const a0 = rng() * Math.PI * 2;
      let d = '';
      for (let i = 0; i <= n; i++) {
        const a = a0 + (i / n) * Math.PI * 2;
        const rr = r * (0.7 + rng() * 0.6);
        const x = cx + Math.cos(a) * rr;
        const y = cy + Math.sin(a) * rr * 0.85;
        d += `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)} `;
      }
      d += 'Z';
      return `<path d="${d}" fill="rgba(255,255,255,${alpha})" stroke="none" stroke-linejoin="round" />\n`;
    };
    const cellSet = new Set(comp.map(([c, r]) => `${r},${c}`));
    const isEdge = ([c, r]) => [[1, 0], [-1, 0], [0, 1], [0, -1]]
      .some(([dx, dy]) => !cellSet.has(`${r + dy},${c + dx}`));
    for (const [col, row] of comp) {
      const cx = col * ts + ts / 2 + (rng() - 0.5) * ts * 0.2;
      const cy = row * ts + ts / 2 + (rng() - 0.5) * ts * 0.2;
      if (isEdge([col, row])) {
        svg += blob(cx, cy, ts * 0.42, 0.9);
      }
      svg += blob(cx, cy, ts * 0.34, 0.75);
      if (rng() < 0.4) {
        svg += blob(cx, cy, ts * 0.22, 0.9);
      }
    }
    // Caja de la sabana para pistas y brillos
    let c0 = Infinity, c1 = -Infinity, r0 = Infinity, r1 = -Infinity;
    for (const [col, row] of comp) {
      if (col < c0) c0 = col;
      if (col > c1) c1 = col;
      if (row < r0) r0 = row;
      if (row > r1) r1 = row;
    }
    const cx = (c0 + c1 + 1) * ts / 2;
    const cy = (r0 + r1 + 1) * ts / 2;
    const hw = Math.max((c1 - c0 + 1) * ts / 2, ts * 0.6);
    const hh = Math.max((r1 - r0 + 1) * ts / 2, ts * 0.6);
    // Pistas: 2-3 líneas paralelas a lo largo del eje largo
    const wide = hw >= hh;
    const runs = comp.length >= 6 ? 3 : 2;
    for (let i = 0; i < runs; i++) {
      const off = (i - (runs - 1) / 2) * (wide ? hh * 0.5 : hw * 0.5);
      if (wide) {
        const ry = cy + off;
        svg += `<path d="M${(cx - hw * 0.7).toFixed(1)},${ry.toFixed(1)} q${(hw * 0.7).toFixed(1)},${(-hh * 0.12).toFixed(1)} ${(hw * 1.4).toFixed(1)},0" fill="none" stroke="rgba(255,255,255,0.85)" stroke-width="1" opacity="0.7" stroke-linecap="round" />\n`;
        svg += `<path d="M${(cx - hw * 0.7).toFixed(1)},${(ry + 1.6).toFixed(1)} q${(hw * 0.7).toFixed(1)},${(-hh * 0.12).toFixed(1)} ${(hw * 1.4).toFixed(1)},0" fill="none" stroke="rgba(140,170,200,0.5)" stroke-width="0.7" stroke-linecap="round" />\n`;
      } else {
        const rx = cx + off;
        svg += `<path d="M${rx.toFixed(1)},${(cy - hh * 0.7).toFixed(1)} q${(hw * 0.12).toFixed(1)},${(hh * 0.7).toFixed(1)} 0,${(hh * 1.4).toFixed(1)}" fill="none" stroke="rgba(255,255,255,0.85)" stroke-width="1" opacity="0.7" stroke-linecap="round" />\n`;
        svg += `<path d="M${(rx + 1.6).toFixed(1)},${(cy - hh * 0.7).toFixed(1)} q${(hw * 0.12).toFixed(1)},${(hh * 0.7).toFixed(1)} 0,${(hh * 1.4).toFixed(1)}" fill="none" stroke="rgba(140,170,200,0.5)" stroke-width="0.7" stroke-linecap="round" />\n`;
      }
    }
    // Brillos escasos
    const sparks = Math.min(4, 1 + Math.floor(comp.length / 4));
    for (let i = 0; i < sparks; i++) {
      const sx = cx + (rng() - 0.5) * hw * 1.2;
      const sy = cy + (rng() - 0.5) * hh * 1.1;
      svg += `<circle cx="${sx.toFixed(1)}" cy="${sy.toFixed(1)}" r="${(0.6 + rng() * 0.5).toFixed(1)}" fill="rgba(255,255,255,0.95)" />\n`;
    }
  }

  // Casquetes en cimas vecinas a sabana (nacen del pico)
  for (let row = 0; row < maxRow; row++) {
    for (let col = 0; col < maxCol; col++) {
      const b = getBiomeAt(biomeMap, col, row);
      if (b !== 'mountain' || !hasBiomeNearby(biomeMap, col, row, 'snow', 2)) continue;
      if (rng() > 0.4) continue;
      const cx = col * ts + ts / 2 + (rng() - 0.5) * ts * 0.4;
      const cy = row * ts + ts / 2 + (rng() - 0.5) * ts * 0.4;
      const r = ts * (0.1 + rng() * 0.08);
      svg += `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${r.toFixed(1)}" fill="rgba(255,255,255,0.9)" opacity="0.85" />\n`;
    }
  }
  return svg;
}

function layerFrame(w, h, seedText) {
  const cx = w - 120;
  const cy = 120;
  return `\n<!-- Tolkien: Marco -->\n` +
    `<g opacity="0.8">\n` +
    `<circle cx="${cx}" cy="${cy}" r="34" fill="none" stroke="${INK}" stroke-width="1.2" />\n` +
    `<path d="M${cx},${cy - 30} L${cx + 7},${cy} L${cx},${cy + 30} L${cx - 7},${cy} Z" fill="none" stroke="${INK}" stroke-width="1.2" />\n` +
    `<text x="${cx}" y="${cy - 42}" text-anchor="middle" font-family="Georgia,serif" font-size="16" fill="${INK}">N</text>\n` +
    `<text x="60" y="${h - 40}" font-family="Georgia,serif" font-size="15" font-style="italic" fill="${INK}" opacity="0.8">Semilla ${seedText}</text>\n` +
    `</g>\n`;
}

export function buildTolkienSVG(htmlContent, biomeMap, ts, rng, seedText, opts = {}) {
  const width = opts.width || 1920;
  const height = opts.height || 1080;
  const palette = opts.palette || biomeColors;
  const svgHead = htmlContent.indexOf('<svg');
  const svgEnd = htmlContent.lastIndexOf('</svg>');
  if (svgHead < 0 || svgEnd < 0) {
    console.error('No se encontró <svg> en el archivo fuente');
    return htmlContent;
  }
  const svgOpenEnd = htmlContent.indexOf('>', svgHead) + 1;
  const preContent = htmlContent.substring(0, svgOpenEnd);
  // Los puntos de río del base (#88c8f8) se reemplazan por trazos continuos:
  // se eliminan del cuerpo original para no duplicar.
  const svgBody = htmlContent
    .substring(svgOpenEnd, svgEnd)
    .replace(/<circle[^>]*fill="#88c8f8"[^>]*\/>\n?/g, '');
  const postContent = htmlContent.substring(svgEnd);

  const maxCol = Math.ceil(width / ts) + 2;
  const maxRow = Math.ceil(height / ts) + 2;

  let overlay = '';
  overlay += layerParchment(width, height);
  overlay += layerWashes(biomeMap, ts, maxCol, maxRow, rng);
  overlay += transitionLayer(biomeMap, { ts, maxCol, maxRow, rng, palette });
  overlay += layerCoast(biomeMap, ts, maxCol, maxRow, rng);
  overlay += layerSeaWaves(biomeMap, ts, maxCol, maxRow, rng);
  // ★ Ríos reales (generateRivers) si vienen trails; si no, procedural clásico.
  if (opts.realTrails && opts.realTrails.length > 0) {
    overlay += layerRealRivers(opts.realTrails, { ts, padding: opts.padding || 0, rng, terrainAt: opts.terrainAt });
  } else {
    overlay += layerRivers(biomeMap, ts, maxCol, maxRow, rng);
  }
  overlay += layerSnow(biomeMap, ts, maxCol, maxRow, rng);
  overlay += layerMountains(biomeMap, ts, maxCol, maxRow, rng);
  overlay += layerHills(biomeMap, ts, maxCol, maxRow, rng);
  overlay += layerForests(biomeMap, ts, maxCol, maxRow, rng);
  overlay += layerLakes(biomeMap, ts, maxCol, maxRow, rng);
  overlay += layerFrame(width, height, seedText);

  return preContent + svgBody + overlay + postContent;
}

// ---- Ejecución CLI standalone (solo cuando se invoca directo con node) ----
// Nota: hasBiomeNearby/getBiomeAt ya están definidos arriba; no se duplican.

export async function runTolkienCLI(args = process.argv.slice(2)) {
  const { default: fs } = await import('node:fs');
  const { default: path } = await import('node:path');
  let width = 1920, height = 1080, seed = 42, sourceFile = null, outputDir = 'target/tolkien';
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--width' && i + 1 < args.length) width = parseInt(args[++i], 10);
    else if (arg === '--height' && i + 1 < args.length) height = parseInt(args[++i], 10);
    else if (arg === '--seed' && i + 1 < args.length) seed = parseInt(args[++i], 10);
    else if (arg === '--source' && i + 1 < args.length) { sourceFile = args[++i]; outputDir = path.dirname(path.resolve(sourceFile)); }
    else if (arg === '--output' && i + 1 < args.length) outputDir = args[++i];
  }
  if (!sourceFile) {
    console.error('Uso: node tolkienFilter.js --source <archivo.html> [--seed N] [--width N] [--height N]');
    process.exit(1);
  }
  const htmlPath = sourceFile.startsWith('file://') ? new URL(sourceFile).pathname : sourceFile;
  if (!fs.existsSync(htmlPath)) {
    console.error(`Archivo no encontrado: ${htmlPath}`);
    process.exit(1);
  }
  const htmlContent = fs.readFileSync(htmlPath, 'utf8');
  const parsed = parseBiomeMap(htmlContent);
  const rng = createRNG(seed);
  console.log(`Mapa parseado: ${parsed.cols}×${parsed.rows} celdas de bioma (tileSize=${parsed.tileSize})`);
  console.log(`Generando estilo Tolkien desde: ${htmlPath}`);
  const output = buildTolkienSVG(htmlContent, parsed.biomeMap, parsed.tileSize, rng, String(seed), { width, height });
  const baseName = path.basename(htmlPath).match(/semilla-(\d+)/);
  const fallback = path.basename(htmlPath).replace(/\.html?$/i, '');
  const outputFileName = `tolkien-${baseName ? 'semilla-' + baseName[1] : fallback}.html`;
  const outputPath = path.resolve(outputDir, outputFileName);
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(outputPath, output);
  console.log(`Mapa estilo Tolkien generado en: ${outputPath}`);
  return outputPath;
}

const __isTolkienMain = (() => {
  try {
    const invoked = process.argv[1] ? new URL(`file://${process.argv[1]}`).href : '';
    return invoked === import.meta.url;
  } catch { return false; }
})();
if (__isTolkienMain) { await runTolkienCLI(); }
