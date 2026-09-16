import { Container, Graphics } from "pixi.js";
import type { World, Tile, RiverTrail } from "./types";
import { debug } from "./debugLog";

/** Eco en consola (visible con ?debug=1) de qué capas Tolkien corren. */
function debugLogActive(mode: string, active: Set<TolkienLayer>): void {
  debug.info(`[tolkien] ${mode}: ${[...active].join(",") || "(ninguna)"}`);
}

const TILE_SIZE = 14;
const INK = 0x3a2e1e;
const RIVER_INK = 0x4a6f8a;
const INK_GREEN = 0x2f4a26;
const HERO_GREEN = 0x43682f;
const WAVE_COLOR = 0x4a6f8a;

const palette: Record<string, string> = {
  ocean: "#315f8f", coast: "#4a89a8", plain: "#88a95f",
  forest: "#477457", hill: "#9a8d65", mountain: "#7d7f85", desert: "#c9b06b",
  lake: "#2e7d9e", snow: "#f5f5f5",
};
const washColors: Record<string, string> = {
  ocean: "rgba(120,160,190,0.10)", lake: "rgba(140,190,220,0.15)",
  plain: "rgba(150,180,120,0.15)", forest: "rgba(90,140,90,0.16)",
  hill: "rgba(170,160,120,0.16)",
  mountain: "rgba(150,130,110,0.16)", desert: "rgba(200,170,120,0.18)",
  snow: "rgba(240,244,250,0.25)",
};
const BROWN = new Set(["mountain", "desert"]);
const GREEN = new Set(["forest", "plain"]);
const BLUE = new Set(["ocean", "lake"]);

function hashString(value: string) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) { hash ^= value.charCodeAt(i); hash = Math.imul(hash, 16777619); }
  return hash >>> 0;
}

function createRNG(seed: number) {
  let s = seed;
  return function () {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace("#", "");
  const v = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  return { r: parseInt(v.slice(0, 2), 16), g: parseInt(v.slice(2, 4), 16), b: parseInt(v.slice(4, 6), 16) };
}
function rgba(hex: string, a: number): string { const c = hexToRgb(hex); return `rgba(${c.r},${c.g},${c.b},${a})`; }
function mix(h1: string, h2: string, t: number): string {
  const a = hexToRgb(h1), b = hexToRgb(h2);
  const r = Math.round(a.r + (b.r - a.r) * t), g = Math.round(a.g + (b.g - a.g) * t), bl = Math.round(a.b + (b.b - a.b) * t);
  const h = (v: number) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(bl)}`;
}
function getBiomeAt(biomeMap: Record<string, string>, col: number, row: number): string { return biomeMap[`${row},${col}`] || "ocean"; }
function pairKind(a: string, b: string): string {
  const brownGreen = (BROWN.has(a) && GREEN.has(b)) || (GREEN.has(a) && BROWN.has(b));
  if (brownGreen) return "brown-green";
  if (a === "snow" || b === "snow") return "snow-any";
  const greenBlue = (GREEN.has(a) && BLUE.has(b)) || (BLUE.has(a) && GREEN.has(b));
  if (greenBlue) return "green-blue";
  if (BLUE.has(a) && BLUE.has(b) && a !== b) return "blue-blue";
  if (a === b) return "same";
  return "other";
}
function collectBorderEdges(biomeMap: Record<string, string>, maxCol: number, maxRow: number, ts: number) {
  const edges: Array<{ vertical: boolean; mx: number; my: number; len: number; a: string; b: string; kind: string; greenSide: number }> = [];
  const dirs = [{ dx: 1, dy: 0 }, { dx: 0, dy: 1 }];
  for (let row = 0; row < maxRow; row++) {
    for (let col = 0; col < maxCol; col++) {
      const a = getBiomeAt(biomeMap, col, row);
      for (const d of dirs) {
        const b = getBiomeAt(biomeMap, col + d.dx, row + d.dy);
        if (a === b) continue;
        const kind = pairKind(a, b);
        if (kind === "same") continue;
        const vertical = d.dx !== 0;
        const mx = vertical ? (col + 1) * ts : col * ts + ts / 2;
        const my = vertical ? row * ts + ts / 2 : (row + 1) * ts;
        const greenSide = GREEN.has(b) ? 1 : GREEN.has(a) ? -1 : 0;
        edges.push({ vertical, mx, my, len: ts, a, b, kind, greenSide });
      }
    }
  }
  return edges;
}
function chaikinSmooth(pts: Array<{ x: number; y: number }>, closed: boolean): Array<{ x: number; y: number }> {
  if (pts.length < 3) return pts;
  const out: Array<{ x: number; y: number }> = [];
  const n = pts.length, limit = closed ? n : n - 1;
  if (!closed) out.push(pts[0]);
  for (let i = 0; i < limit; i++) { const p = pts[i], q = pts[(i + 1) % n]; out.push({ x: p.x * 0.75 + q.x * 0.25, y: p.y * 0.75 + q.y * 0.25 }); out.push({ x: p.x * 0.25 + q.x * 0.75, y: p.y * 0.25 + q.y * 0.75 }); }
  if (!closed) out.push(pts[n - 1]);
  return out;
}
function wavyPath(pts: Array<{ x: number; y: number }>, amp: number, rng: () => number): Array<{ x: number; y: number }> {
  return pts.map((p, i) => { if (i === 0 || i === pts.length - 1) return p; const dx = pts[Math.min(i + 1, pts.length - 1)].x - pts[i - 1].x, dy = pts[Math.min(i + 1, pts.length - 1)].y - pts[i - 1].y, len = Math.sqrt(dx * dx + dy * dy) || 1, off = (rng() - 0.5) * amp * 2; return { x: p.x + (-dy / len) * off, y: p.y + (dx / len) * off }; });
}
function hasBiomeNearby(biomeMap: Record<string, string>, col: number, row: number, target: string, radius: number = 2): boolean {
  for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) { if (dx === 0 && dy === 0) continue; if (getBiomeAt(biomeMap, col + dx, row + dy) === target) return true; } return false;
}
function isLandBiome(b: string): boolean { return b !== "ocean" && b !== "lake"; }
function biomeElevation(b: string): number { const e: Record<string, number> = { ocean: -0.8, lake: -0.35, plain: 0.0, forest: 0.1, mountain: 0.35, desert: 0.45, snow: 0.6 }; return e[b] ?? 0; }
function downhillStep(biomeMap: Record<string, string>, col: number, row: number): { dx: number; dy: number; e: number; biome: string } | null {
  const here = biomeElevation(getBiomeAt(biomeMap, col, row)); let best: { dx: number; dy: number; e: number; biome: string } | null = null;
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]]) { const b = getBiomeAt(biomeMap, col + dx, row + dy), e = biomeElevation(b) ?? 0; if (e < here && (!best || e < best.e)) best = { dx, dy, e, biome: b }; }
  return best;
}
function seaShoreVector(biomeMap: Record<string, string>, col: number, row: number): { nx: number; ny: number; dist: number } {
  let dist = 99, dx = 0, dy = 0;
  for (let r = 1; r <= 3; r++) { let found = false; for (let dyy = -r; dyy <= r && !found; dyy++) for (let dxx = -r; dxx <= r && !found; dxx++) { if (Math.max(Math.abs(dxx), Math.abs(dyy)) !== r) continue; if (isLandBiome(getBiomeAt(biomeMap, col + dxx, row + dyy))) { dist = r; dx = -dxx; dy = -dyy; found = true; } } if (found) break; }
  const len = Math.sqrt(dx * dx + dy * dy) || 1; return { nx: dx / len, ny: dy / len, dist };
}
function touchesOcean(biomeMap: Record<string, string>, col: number, row: number): boolean {
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { if (dx === 0 && dy === 0) continue; if (getBiomeAt(biomeMap, col + dx, row + dy) === "ocean") return true; } return false;
}

// ---- Pixi.js visual functions ----

function drawWavyLine(g: Graphics, x1: number, y1: number, x2: number, y2: number, ts: number, rng: () => number, color: number, width: number, alpha: number) {
  const dx = x2 - x1, dy = y2 - y1, len = Math.sqrt(dx * dx + dy * dy) || 1;
  const nx = -dy / len, ny = dx / len, j = () => (rng() - 0.5) * ts * 0.3;
  const p = (t: number) => ({ x: x1 + dx * t + nx * j(), y: y1 + dy * t + ny * j() });
  const p1 = p(0.33), p2 = p(0.66);
  g.moveTo(x1, y1).lineTo(p1.x, p1.y).lineTo(p2.x, p2.y).lineTo(x2, y2).stroke({ color, width, alpha });
}
function drawFeatherEdge(g: Graphics, edge: any, ts: number, pal: Record<string, string>, rng: () => number) {
  const cA = pal[edge.a] || "#888888", cB = pal[edge.b] || "#888888", mid = mix(cA, cB, 0.5);
  if (edge.vertical) { drawWavyLine(g, edge.mx, edge.my - ts * 0.55, edge.mx, edge.my + ts * 0.55, ts, rng, parseInt(mid.replace("#", ""), 16) || 0x888888, ts * 1.0, 0.22); drawWavyLine(g, edge.mx, edge.my - ts * 0.55, edge.mx, edge.my + ts * 0.55, ts, rng, parseInt(cB.replace("#", ""), 16) || 0x888888, ts * 0.6, 0.14); }
  else { drawWavyLine(g, edge.mx - ts * 0.55, edge.my, edge.mx + ts * 0.55, edge.my, ts, rng, parseInt(mid.replace("#", ""), 16) || 0x888888, ts * 1.0, 0.22); drawWavyLine(g, edge.mx - ts * 0.55, edge.my, edge.mx + ts * 0.55, edge.my, ts, rng, parseInt(cB.replace("#", ""), 16) || 0x888888, ts * 0.6, 0.14); }
}
function drawWaterBlend(g: Graphics, edge: any, ts: number, pal: Record<string, string>, rng: () => number) {
  const cA = pal[edge.a] || "#888888", cB = pal[edge.b] || "#888888";
  for (const bd of [{ t: 0.5, a: 0.30, w: 1.0 }, { t: 0.32, a: 0.20, w: 0.7 }, { t: 0.68, a: 0.18, w: 0.4 }]) { const c = mix(cA, cB, bd.t), w = ts * bd.w; if (edge.vertical) drawWavyLine(g, edge.mx, edge.my - ts * 0.55, edge.mx, edge.my + ts * 0.55, ts, rng, parseInt(c.replace("#", ""), 16) || 0x888888, w, bd.a); else drawWavyLine(g, edge.mx - ts * 0.55, edge.my, edge.mx + ts * 0.55, edge.my, ts, rng, parseInt(c.replace("#", ""), 16) || 0x888888, w, bd.a); }
}
function drawSnowFeather(g: Graphics, edge: any, ts: number, pal: Record<string, string>, rng: () => number) {
  const other = edge.a === "snow" ? edge.b : edge.a, cOther = pal[other] || "#888888", snowDir = edge.b === "snow" ? 1 : -1;
  if (edge.vertical) {
    drawWavyLine(g, edge.mx, edge.my - ts * 0.55, edge.mx, edge.my + ts * 0.55, ts, rng, 0xffffff, ts * 0.8, 0.35); drawWavyLine(g, edge.mx, edge.my - ts * 0.55, edge.mx, edge.my + ts * 0.55, ts, rng, parseInt(cOther.replace("#", ""), 16) || 0x888888, ts * 0.5, 0.18);
    for (const t of [0.3, 0.55, 0.8]) { if (rng() < 0.3) continue; const y = (edge.my - ts * 0.5 + t * ts + (rng() - 0.5) * ts * 0.2).toFixed(1), dx = (edge.mx - snowDir * ts * 0.3 + (rng() - 0.5) * ts * 0.2).toFixed(1), r = ts * (0.05 + rng() * 0.04); g.circle(parseFloat(dx), parseFloat(y), r).fill(0xffffff, 0.8); }
  } else {
    drawWavyLine(g, edge.mx - ts * 0.55, edge.my, edge.mx + ts * 0.55, edge.my, ts, rng, 0xffffff, ts * 0.8, 0.35); drawWavyLine(g, edge.mx - ts * 0.55, edge.my, edge.mx + ts * 0.55, edge.my, ts, rng, parseInt(cOther.replace("#", ""), 16) || 0x888888, ts * 0.5, 0.18);
    for (const t of [0.3, 0.55, 0.8]) { if (rng() < 0.3) continue; const x = (edge.mx - ts * 0.5 + t * ts + (rng() - 0.5) * ts * 0.2).toFixed(1), dy = (edge.my - snowDir * ts * 0.3 + (rng() - 0.5) * ts * 0.2).toFixed(1), r = ts * (0.05 + rng() * 0.04); g.circle(parseFloat(x), parseFloat(dy), r).fill(0xffffff, 0.8); }
  }
}
function drawGrassFringe(g: Graphics, edge: any, ts: number, rng: () => number) {
  const greens = [0x5a7a3a, 0x6a8a42, 0x4a6a32];
  for (let i = 0; i < 3; i++) {
    const t = 0.25 + i * 0.25 + (rng() - 0.5) * 0.08, h = ts * (0.14 + rng() * 0.1), col = greens[Math.floor(rng() * greens.length)];
    if (edge.vertical) { const y = (edge.my - ts * 0.5 + t * ts).toFixed(1), x = edge.mx.toFixed(1); g.moveTo(parseFloat(x), parseFloat(y)).lineTo(parseFloat(x) + h, parseFloat(y)).stroke({ color: col, width: 1, alpha: 0.75 }); }
    else { const x = (edge.mx - ts * 0.5 + t * ts).toFixed(1), y = edge.my.toFixed(1); g.moveTo(parseFloat(x), parseFloat(y)).lineTo(parseFloat(x), parseFloat(y) - h).stroke({ color: col, width: 1, alpha: 0.75 }); }
  }
}
function drawMossFringe(g: Graphics, edge: any, ts: number, rng: () => number) {
  for (let i = 0; i < 3; i++) {
    const t = 0.2 + i * 0.3 + (rng() - 0.5) * 0.08, r = ts * (0.05 + rng() * 0.045);
    if (edge.vertical) { const y = (edge.my - ts * 0.5 + t * ts).toFixed(1), x = (edge.mx + edge.greenSide * ts * 0.22).toFixed(1); g.circle(parseFloat(x), parseFloat(y), r).fill(0x2f4a26, 0.8); }
    else { const x = (edge.mx - ts * 0.5 + t * ts).toFixed(1), y = (edge.my + edge.greenSide * ts * 0.22).toFixed(1); g.circle(parseFloat(x), parseFloat(y), r).fill(0x2f4a26, 0.8); }
  }
}
function drawTransitionLayer(batches: Graphics[], biomeMap: Record<string, string>, ts: number, maxCol: number, maxRow: number, rng: () => number) {
  // Lotes acotados: decenas de miles de trazos en un solo Graphics
  // saturan el lote GPU y escupen filamentos por todo el canvas.
  let g = newBatch(batches);
  let n = 0;
  for (const e of collectBorderEdges(biomeMap, maxCol, maxRow, ts)) {
    if (n >= 600) { g = newBatch(batches); n = 0; }
    n++;
    if (e.kind === "blue-blue") { drawWaterBlend(g, e, ts, palette, rng); continue; }
    if (e.a === "snow" || e.b === "snow") { drawFeatherEdge(g, e, ts, palette, rng); drawSnowFeather(g, e, ts, palette, rng); continue; }
    drawFeatherEdge(g, e, ts, palette, rng);
    if (e.kind === "brown-green") drawGrassFringe(g, e, ts, rng); else if (e.kind === "green-blue") drawMossFringe(g, e, ts, rng);
  }
}
function drawWaterFeather(g: Graphics, pts: Array<{ x: number; y: number }>, nx: number, ny: number, ts: number) {
  // Pasadas finas pegadas a la costa (las anchas generaban bandas y artefactos).
  for (const st of [{ off: 0.35, w: 0.45, a: 0.28 }, { off: 0.8, w: 0.3, a: 0.14 }]) {
    const moved = pts.map((p) => ({ x: p.x + nx * st.off * ts, y: p.y + ny * st.off * ts }));
    g.moveTo(moved[0].x, moved[0].y); for (let i = 1; i < moved.length; i++) g.lineTo(moved[i].x, moved[i].y); g.stroke({ color: 0x9fd0e8, width: ts * st.w, alpha: st.a });
  }
}

/**
 * Lotes acotados de Graphics: reparte miles de primitivas en varios objetos
 * para no saturar el lote GPU (filamentos por todo el canvas). Mismo orden
 * visual, cero cambios de diseño.
 */
const BATCH_SIZE = 600;
function newBatch(batches: Graphics[]): Graphics {
  const g = new Graphics();
  batches.push(g);
  return g;
}
function chunkPolyline<T>(pts: T[], size: number = 40): T[][] {
  if (pts.length <= size) return [pts];
  const out: T[][] = [];
  for (let i = 0; i < pts.length - 1; i += size - 1) out.push(pts.slice(i, i + size));
  return out;
}

// ---- Tolkien layers ----

function layerParchment(g: Graphics, w: number, h: number) {
  g.rect(0, 0, w, h).fill(0xe8d5a3, 0.16);
  g.beginPath().rect(8, 8, w - 16, h - 16).lineStyle(2, 0x3a2e1e, 0.55).stroke();
  g.beginPath().rect(14, 14, w - 28, h - 28).lineStyle(0.8, 0x3a2e1e, 0.4).stroke();
}
function layerWashes(batches: Graphics[], biomeMap: Record<string, string>, ts: number, maxCol: number, maxRow: number, rng: () => number) {
  let g = newBatch(batches);
  let n = 0;
  for (let row = 0; row < maxRow; row++) for (let col = 0; col < maxCol; col++) {
    const b = getBiomeAt(biomeMap, col, row); if (b === "ocean" || rng() > 0.75) continue;
    if (n >= BATCH_SIZE) { g = newBatch(batches); n = 0; }
    n++;
    g.ellipse(col * ts + ts / 2 + (rng() - 0.5) * ts * 0.3, row * ts + ts / 2 + (rng() - 0.5) * ts * 0.3, ts * (0.45 + rng() * 0.25), ts * (0.45 + rng() * 0.25) * 0.7).fill(washColors[b], 1);
  }
}
function coastPolylines(biomeMap: Record<string, string>, maxCol: number, maxRow: number, ts: number) {
  const edges: Array<{ ax: number; ay: number; bx: number; by: number; wx: number; wy: number }> = [];
  const dirs = [{ dx: 1, dy: 0 }, { dx: -1, dy: 0 }, { dx: 0, dy: 1 }, { dx: 0, dy: -1 }];
  for (let row = 0; row < maxRow; row++) for (let col = 0; col < maxCol; col++) {
    if (getBiomeAt(biomeMap, col, row) !== "ocean") continue; let touchesLand = false;
    for (const d of dirs) { if (isLandBiome(getBiomeAt(biomeMap, col + d.dx, row + d.dy))) { touchesLand = true; break; } }
    if (!touchesLand) continue;
    for (const d of dirs) {
      if (!isLandBiome(getBiomeAt(biomeMap, col + d.dx, row + d.dy))) continue;
      const x0 = col * ts, y0 = row * ts; let ax, ay, bx, by;
      if (d.dx === 1) { ax = x0 + ts; ay = y0; bx = x0 + ts; by = y0 + ts; }
      else if (d.dx === -1) { ax = x0; ay = y0 + ts; bx = x0; by = y0; }
      else if (d.dy === 1) { ax = x0 + ts; ay = y0 + ts; bx = x0; by = y0 + ts; }
      else { ax = x0; ay = y0; bx = x0 + ts; by = y0; }
      edges.push({ ax, ay, bx, by, wx: -d.dx, wy: -d.dy });
    }
  }
  const key = (x: number, y: number) => `${Math.round(x * 10)},${Math.round(y * 10)}`;
  const startMap = new Map(), endMap = new Map(), used = new Array(edges.length).fill(false), polys: Array<Array<{ x: number; y: number; wx: number; wy: number }>> = [];
  edges.forEach((e, i) => { const k = key(e.ax, e.ay); if (!startMap.has(k)) startMap.set(k, []); startMap.get(k)!.push(i); const ke = key(e.bx, e.by); if (!endMap.has(ke)) endMap.set(ke, []); endMap.get(ke)!.push(i); });
  for (let i = 0; i < edges.length; i++) {
    if (used[i]) continue; used[i] = true;
    const line = [{ x: edges[i].ax, y: edges[i].ay, wx: edges[i].wx, wy: edges[i].wy }, { x: edges[i].bx, y: edges[i].by, wx: edges[i].wx, wy: edges[i].wy }];
    let ext = true;
    while (ext) { ext = false; const last = line[line.length - 1]; for (const j of (startMap.get(key(last.x, last.y)) || [])) { if (used[j]) continue; used[j] = true; line.push({ x: edges[j].bx, y: edges[j].by, wx: edges[j].wx, wy: edges[j].wy }); ext = true; break; } if (ext) continue; for (const j of (endMap.get(key(last.x, last.y)) || [])) { if (used[j]) continue; used[j] = true; line.push({ x: edges[j].ax, y: edges[j].ay, wx: edges[j].wx, wy: edges[j].wy }); ext = true; break; } }
    ext = true; while (ext) { ext = false; const f = line[0]; for (const j of (endMap.get(key(f.x, f.y)) || [])) { if (used[j]) continue; used[j] = true; line.unshift({ x: edges[j].ax, y: edges[j].ay, wx: edges[j].wx, wy: edges[j].wy }); ext = true; break; } if (ext) continue; for (const j of (startMap.get(key(f.x, f.y)) || [])) { if (used[j]) continue; used[j] = true; line.unshift({ x: edges[j].bx, y: edges[j].by, wx: edges[j].wx, wy: edges[j].wy }); ext = true; break; } }
    if (line.length >= 2) polys.push(line);
  }
  return polys;
}
function layerCoast(g: Graphics, biomeMap: Record<string, string>, ts: number, maxCol: number, maxRow: number, rng: () => number) {
  for (const line of coastPolylines(biomeMap, maxCol, maxRow, ts)) {
    if (line.length < 3) continue;
    const smooth = chaikinSmooth(line, false);
    let anx = 0, any = 0; for (const p of line) { anx += p.wx || 0; any += p.wy || 0; }
    const alen = Math.sqrt(anx * anx + any * any) || 1; anx /= alen; any /= alen;
    const sp = smooth.map((p) => ({ x: p.x, y: p.y }));
    for (const chunk of chunkPolyline(sp)) {
      drawWaterFeather(g, chunk, anx, any, ts);
      const wavy = wavyPath(chunk, ts * 0.08, rng);
      g.moveTo(wavy[0].x, wavy[0].y); for (let i = 1; i < wavy.length; i++) g.lineTo(wavy[i].x, wavy[i].y); g.stroke({ color: INK, width: 1.6, alpha: 0.75 });
      g.moveTo(wavy[0].x, wavy[0].y); for (let i = 1; i < wavy.length; i++) g.lineTo(wavy[i].x, wavy[i].y); g.stroke({ color: INK, width: 0.7, alpha: 0.5 });
    }
  }
}
function layerSeaWaves(batches: Graphics[], biomeMap: Record<string, string>, ts: number, maxCol: number, maxRow: number, rng: () => number) {
  let g = newBatch(batches);
  let n = 0;
  for (let row = 0; row < maxRow; row++) for (let col = 0; col < maxCol; col++) {
    if (getBiomeAt(biomeMap, col, row) !== "ocean") continue;
    const v = seaShoreVector(biomeMap, col, row); if (v.dist < 1 || v.dist > 3) continue; if (v.dist === 3 && rng() > 0.5) continue;
    if (n >= BATCH_SIZE) { g = newBatch(batches); n = 0; }
    n++;
    const cx = col * ts + ts / 2 + (rng() - 0.5) * ts * 0.3, cy = row * ts + ts / 2 + (rng() - 0.5) * ts * 0.3;
    const tx = -v.ny, ty = v.nx, len = ts * (v.dist === 1 ? 0.32 : 0.26), op = v.dist === 1 ? 0.65 : v.dist === 2 ? 0.5 : 0.35;
    const mx = cx - tx * len, my = cy - ty * len, ex = cx + tx * len, ey = cy + ty * len;
    g.moveTo(mx, my).quadraticCurveTo(mx + tx * len, my + ty * len - ts * 0.1, ex, ey).stroke({ color: WAVE_COLOR, width: 0.9, alpha: op });
    if (v.dist === 1 && rng() < 0.4) { g.moveTo(cx - tx * len * 0.5, cy + ts * 0.22).quadraticCurveTo(cx - tx * len * 0.5, cy + ts * 0.22 - ts * 0.06, cx, cy + ts * 0.22).stroke({ color: WAVE_COLOR, width: 0.7, alpha: 0.4 }); }
  }
}
function layerRivers(g: Graphics, biomeMap: Record<string, string>, ts: number, maxCol: number, maxRow: number, rng: () => number) {
  const farFromOcean = (c: number, r: number) => { for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) if (getBiomeAt(biomeMap, c + dx, r + dy) === "ocean") return false; return true; };
  const drawRiver = (pts: Array<{ x: number; y: number }>, w0: number, w1: number, w2: number) => {
    const sm = chaikinSmooth(pts, false), n = sm.length, third = Math.floor(n / 3), segs = [sm.slice(0, third + 1), sm.slice(third, 2 * third + 1), sm.slice(2 * third)];
    segs.forEach((sg, i) => { if (sg.length < 2) return; g.moveTo(sg[0].x, sg[0].y); for (let j = 1; j < sg.length; j++) g.lineTo(sg[j].x, sg[j].y); g.stroke({ color: RIVER_INK, width: [w0, w1, w2][i], alpha: 0.85 }); });
    let side = 1;
    for (let i = 2; i < n - 2; i += 3) {
      if (rng() < 0.3) continue; const p0 = sm[Math.max(0, i - 1)], p1 = sm[Math.min(n - 1, i + 1)];
      let dx = p1.x - p0.x, dy = p1.y - p0.y, len = Math.sqrt(dx * dx + dy * dy) || 1; dx /= len; dy /= len; side = -side;
      const L = ts * (0.4 + rng() * 0.4), off = side * (0.4 + rng() * 0.5), nx = -dy, ny = dx;
      const sx = sm[i].x + nx * off, sy = sm[i].y + ny * off, ex = sx + dx * L, ey = sy + dy * L;
      // quadraticCurveTo es ABSOLUTO (el plugin SVG usa q relativo): el control va desde el inicio.
      const qx = sx + dx * L * 0.5 - nx * (rng() - 0.5) * ts * 0.25, qy = sy + dy * L * 0.5 - ny * (rng() - 0.5) * ts * 0.25;
      g.moveTo(sx, sy).quadraticCurveTo(qx, qy, ex, ey).stroke({ color: 0xcfe5f2, width: 0.6, alpha: 0.25 + rng() * 0.15 });
    }
  };
  const drawFan = (mouth: { x: number; y: number }, dirx: number, diry: number) => {
    const len = ts * 1.4;
    for (const spread of [-0.5, 0, 0.5]) { const ang = Math.atan2(diry, dirx) + spread, ex = mouth.x + Math.cos(ang) * len, ey = mouth.y + Math.sin(ang) * len; g.moveTo(mouth.x, mouth.y).quadraticCurveTo((mouth.x + ex) / 2, (mouth.y + ey) / 2, ex, ey).stroke({ color: RIVER_INK, width: 2.2, alpha: 0.6 }); }
    g.ellipse(mouth.x + dirx * ts * 0.5, mouth.y + diry * ts * 0.5, ts * 0.45, ts * 0.35).fill(0x4a6f8a, 0.25);
  };
  for (let row = 0; row < maxRow; row++) for (let col = 0; col < maxCol; col++) {
    const b = getBiomeAt(biomeMap, col, row); if (b !== "mountain" || !farFromOcean(col, row) || rng() > 0.06) continue;
    let cx = col, cy = row, mdx = 0, mdy = 0, ppx = -1, ppy = -1;
    const pts = [{ x: cx * ts + ts / 2, y: cy * ts + ts / 2 }];
    let mouth: { x: number; y: number } | null = null, mouthDir: { x: number; y: number } | null = null;
    for (let s = 0; s < 90; s++) {
      let st = downhillStep(biomeMap, cx, cy);
      if (!st) { if (mdx === 0 && mdy === 0) break; st = { dx: mdx, dy: mdy, e: biomeElevation(getBiomeAt(biomeMap, cx + mdx, cy + mdy)), biome: getBiomeAt(biomeMap, cx + mdx, cy + mdy) }; }
      let nx = cx + st.dx, ny = cy + st.dy; if (nx === ppx && ny === ppy) { if (mdx === 0 && mdy === 0) break; nx = cx + mdx; ny = cy + mdy; }
      mdx = nx - cx; mdy = ny - cy; const nb = getBiomeAt(biomeMap, nx, ny);
      if (nb === "ocean" || nb === "lake") { const mp = { x: (cx + st.dx * 0.5) * ts + ts / 2, y: (cy + st.dy * 0.5) * ts + ts / 2 }; pts.push(mp); mouth = mp; mouthDir = { x: st.dx, y: st.dy }; break; }
      const k = `${ny},${nx}`; ppx = cx; ppy = cy; cx = nx; cy = ny; pts.push({ x: cx * ts + ts / 2 + (rng() - 0.5) * ts * 0.5, y: cy * ts + ts / 2 + (rng() - 0.5) * ts * 0.5 });
    }
    if (pts.length < 10) continue;
    drawRiver(pts, 2, 4.5, 8);
    if (mouth) drawFan(mouth, mouthDir!.x, mouthDir!.y);
    if (pts.length >= 10) { const joins = 2 + Math.floor(rng() * 2); for (let j = 0; j < joins; j++) { const ji = 3 + Math.floor(rng() * (pts.length - 6)), jp = pts[ji], ang = rng() * Math.PI * 2, tlen = ts * (1.2 + rng() * 1.2), sp = { x: jp.x + Math.cos(ang) * tlen, y: jp.y + Math.sin(ang) * tlen }, mp = { x: (sp.x + jp.x) / 2 + (rng() - 0.5) * 3, y: (sp.y + jp.y) / 2 + (rng() - 0.5) * 3 }; g.moveTo(sp.x, sp.y).quadraticCurveTo(mp.x, mp.y, jp.x, jp.y).stroke({ color: RIVER_INK, width: 1.2, alpha: 0.75 }); } }
  }
}
function layerRealRivers(g: Graphics, trails: RiverTrail[] | undefined, ts: number, rng: () => number, terrainAt: (x: number, y: number) => string) {
  const isWater = (t: string) => t === "ocean" || t === "lake" || t === "coast";
  for (const trail of trails || []) {
    if (!trail || trail.length === 0) continue;
    const pts = trail.map((p) => ({ x: p.x * ts + ts / 2 + (rng() - 0.5) * ts * 0.35, y: p.y * ts + ts / 2 + (rng() - 0.5) * ts * 0.35 }));
    if (pts.length < 2) { g.circle(pts[0].x, pts[0].y, ts * 0.18).fill(RIVER_INK, 0.8); continue; }
    const sc = Math.min(1.4, Math.max(0.5, trail.length / 30));
    const sm = chaikinSmooth(pts, false), n = sm.length, third = Math.floor(n / 3), segs = [sm.slice(0, third + 1), sm.slice(third, 2 * third + 1), sm.slice(2 * third)];
    segs.forEach((sg, i) => { if (sg.length < 2) return; g.moveTo(sg[0].x, sg[0].y); for (let j = 1; j < sg.length; j++) g.lineTo(sg[j].x, sg[j].y); g.stroke({ color: RIVER_INK, width: [2 * sc, 4.5 * sc, 8 * sc][i], alpha: 0.85 }); });
    let side = 1;
    for (let i = 2; i < n - 2; i += 3) {
      if (rng() < 0.3) continue; const p0 = sm[Math.max(0, i - 1)], p1 = sm[Math.min(n - 1, i + 1)];
      let dx = p1.x - p0.x, dy = p1.y - p0.y, len = Math.sqrt(dx * dx + dy * dy) || 1; dx /= len; dy /= len; side = -side;
      const L = ts * (0.4 + rng() * 0.4), off = side * (0.4 + rng() * 0.5), nx = -dy, ny = dx;
      const sx = sm[i].x + nx * off, sy = sm[i].y + ny * off, ex = sx + dx * L, ey = sy + dy * L;
      // quadraticCurveTo es ABSOLUTO (el plugin SVG usa q relativo): el control va desde el inicio.
      const qx = sx + dx * L * 0.5 - nx * (rng() - 0.5) * ts * 0.25, qy = sy + dy * L * 0.5 - ny * (rng() - 0.5) * ts * 0.25;
      g.moveTo(sx, sy).quadraticCurveTo(qx, qy, ex, ey).stroke({ color: 0xcfe5f2, width: 0.6, alpha: 0.25 + rng() * 0.15 });
    }
    const last = trail[trail.length - 1], prev = trail.length > 1 ? trail[trail.length - 2] : last;
    let mdx = last.x - prev.x, mdy = last.y - prev.y, mouthDir: { x: number; y: number } | null = null;
    if (typeof terrainAt === "function") { for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) if (isWater(terrainAt(last.x + dx, last.y + dy))) { mouthDir = { x: dx, y: dy }; break; } }
    else if (mdx !== 0 || mdy !== 0) mouthDir = { x: mdx, y: mdy };
    const endPt = pts[pts.length - 1];
    if (mouthDir) {
      const mouth = { x: endPt.x + mouthDir.x * ts * 0.3, y: endPt.y + mouthDir.y * ts * 0.3 }; const len = ts * 1.4;
      for (const spread of [-0.5, 0, 0.5]) { const ang = Math.atan2(mouthDir.y, mouthDir.x) + spread, ex = mouth.x + Math.cos(ang) * len, ey = mouth.y + Math.sin(ang) * len; g.moveTo(mouth.x, mouth.y).quadraticCurveTo((mouth.x + ex) / 2, (mouth.y + ey) / 2, ex, ey).stroke({ color: RIVER_INK, width: 2.2, alpha: 0.6 }); }
      g.ellipse(mouth.x + mouthDir.x * ts * 0.5, mouth.y + mouthDir.y * ts * 0.5, ts * 0.45, ts * 0.35).fill(0x4a6f8a, 0.25);
    } else { const L = Math.hypot(mdx, mdy) || 1, tipX = endPt.x + (mdx / L) * ts * 0.5, tipY = endPt.y + (mdy / L) * ts * 0.5; g.moveTo(endPt.x, endPt.y).lineTo(tipX, tipY).stroke({ color: RIVER_INK, width: 1.2, alpha: 0.5 }); }
  }
}
function layerSnow(g: Graphics, biomeMap: Record<string, string>, ts: number, maxCol: number, maxRow: number, rng: () => number) {
  const seen = new Set(), comps: Array<Array<[number, number]>> = [];
  for (let row = 0; row < maxRow; row++) for (let col = 0; col < maxCol; col++) { if (getBiomeAt(biomeMap, col, row) !== "snow") continue; const k = `${row},${col}`; if (seen.has(k)) continue; const comp: Array<[number, number]> = [], stack: Array<[number, number]> = [[col, row]]; seen.add(k); while (stack.length) { const [cx0, cy0] = stack.pop()!; comp.push([cx0, cy0]); for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = cx0 + dx, ny = cy0 + dy, nk = `${ny},${nx}`; if (nx < 0 || ny < 0 || nx >= maxCol || ny >= maxRow || seen.has(nk)) continue; if (getBiomeAt(biomeMap, nx, ny) !== "snow") continue; seen.add(nk); stack.push([nx, ny]); } } comps.push(comp); }
  const touchesMountain = (comp: Array<[number, number]>) => comp.some(([c, r]) => hasBiomeNearby(biomeMap, c, r, "mountain", 1));
  for (const comp of comps) {
    if (!touchesMountain(comp)) { if (comp.length <= 2 && rng() < 0.3) { const [col, row] = comp[0]; g.circle(col * ts + ts / 2, row * ts + ts / 2, ts * 0.12).fill(0xffffff, 0.7); } continue; }
    const cellSet = new Set(comp.map(([c, r]: [number, number]) => `${r},${c}`));
    const isEdge = ([c, r]: [number, number]) => [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => !cellSet.has(`${r + dy},${c + dx}`));
    for (const [col, row] of comp) {
      const cx = col * ts + ts / 2 + (rng() - 0.5) * ts * 0.2, cy = row * ts + ts / 2 + (rng() - 0.5) * ts * 0.2;
      if (isEdge([col, row])) {
        const n = 5 + Math.floor(rng() * 3), a0 = rng() * Math.PI * 2, d: string[] = [];
        for (let i = 0; i <= n; i++) { const a = a0 + (i / n) * Math.PI * 2, rr = ts * 0.42 * (0.7 + rng() * 0.6), x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr * 0.85; d.push(`${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`); }
        d.push("Z");
        const pts = d.join(" ").split(/[MLZ]/).filter(Boolean).map((s) => { const [x, y] = s.split(",").map(Number); return { x, y }; });
        if (pts.length >= 2) { g.moveTo(pts[0].x, pts[0].y); for (let i = 1; i < pts.length; i++) g.lineTo(pts[i].x, pts[i].y); g.closePath().fill(0xffffff, 0.9); }
      }
      const n2 = 5 + Math.floor(rng() * 3), a02 = rng() * Math.PI * 2, d2: string[] = [];
      for (let i = 0; i <= n2; i++) { const a = a02 + (i / n2) * Math.PI * 2, rr = ts * 0.34 * (0.7 + rng() * 0.6), x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr * 0.85; d2.push(`${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`); }
      d2.push("Z");
      const pts2 = d2.join(" ").split(/[MLZ]/).filter(Boolean).map((s) => { const [x, y] = s.split(",").map(Number); return { x, y }; });
      if (pts2.length >= 2) { g.moveTo(pts2[0].x, pts2[0].y); for (let i = 1; i < pts2.length; i++) g.lineTo(pts2[i].x, pts2[i].y); g.closePath().fill(0xffffff, 0.75); }
      if (rng() < 0.4) {
        const n3 = 5 + Math.floor(rng() * 3), a03 = rng() * Math.PI * 2, d3: string[] = [];
        for (let i = 0; i <= n3; i++) { const a = a03 + (i / n3) * Math.PI * 2, rr = ts * 0.22 * (0.7 + rng() * 0.6), x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr * 0.85; d3.push(`${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`); }
        d3.push("Z");
        const pts3 = d3.join(" ").split(/[MLZ]/).filter(Boolean).map((s) => { const [x, y] = s.split(",").map(Number); return { x, y }; });
        if (pts3.length >= 2) { g.moveTo(pts3[0].x, pts3[0].y); for (let i = 1; i < pts3.length; i++) g.lineTo(pts3[i].x, pts3[i].y); g.closePath().fill(0xffffff, 0.9); }
      }
    }
    let c0 = Infinity, c1 = -Infinity, r0 = Infinity, r1 = -Infinity;
    for (const [col, row] of comp) { if (col < c0) c0 = col; if (col > c1) c1 = col; if (row < r0) r0 = row; if (row > r1) r1 = row; }
    const cx = (c0 + c1 + 1) * ts / 2, cy = (r0 + r1 + 1) * ts / 2, hw = Math.max((c1 - c0 + 1) * ts / 2, ts * 0.6), hh = Math.max((r1 - r0 + 1) * ts / 2, ts * 0.6), wide = hw >= hh, runs = comp.length >= 6 ? 3 : 2;
    for (let i = 0; i < runs; i++) {
      const off = (i - (runs - 1) / 2) * (wide ? hh * 0.5 : hw * 0.5);
      if (wide) { const ry = cy + off; g.moveTo(cx - hw * 0.7, ry).quadraticCurveTo(cx + hw * 0.7, cy - hh * 0.12, cx + hw * 1.4, ry).stroke({ color: 0xffffff, width: 1, alpha: 0.7 }); g.moveTo(cx - hw * 0.7, ry + 1.6).quadraticCurveTo(cx + hw * 0.7, cy - hh * 0.12, cx + hw * 1.4, ry + 1.6).stroke({ color: 0x8caa8c, width: 0.7, alpha: 0.5 }); }
      else { const rx = cx + off; g.moveTo(rx, cy - hh * 0.7).quadraticCurveTo(cx - hw * 0.12, cy + hh * 0.7, rx, cy + hh * 1.4).stroke({ color: 0xffffff, width: 1, alpha: 0.7 }); g.moveTo(rx + 1.6, cy - hh * 0.7).quadraticCurveTo(cx - hw * 0.12, cy + hh * 0.7, rx + 1.6, cy + hh * 1.4).stroke({ color: 0x8caa8c, width: 0.7, alpha: 0.5 }); }
    }
    const sparks = Math.min(4, 1 + Math.floor(comp.length / 4));
    for (let i = 0; i < sparks; i++) g.circle(cx + (rng() - 0.5) * hw * 1.2, cy + (rng() - 0.5) * hh * 1.1, 0.6 + rng() * 0.5).fill(0xffffff, 0.95);
  }
  for (let row = 0; row < maxRow; row++) for (let col = 0; col < maxCol; col++) { const b = getBiomeAt(biomeMap, col, row); if (b !== "mountain" || !hasBiomeNearby(biomeMap, col, row, "snow", 2) || rng() > 0.4) continue; g.circle(col * ts + ts / 2 + (rng() - 0.5) * ts * 0.4, row * ts + ts / 2 + (rng() - 0.5) * ts * 0.4, ts * (0.1 + rng() * 0.08)).fill(0xffffff, 0.9); }
}
function layerMountains(g: Graphics, biomeMap: Record<string, string>, ts: number, maxCol: number, maxRow: number, rng: () => number) {
  for (let row = 0; row < maxRow; row++) for (let col = 0; col < maxCol; col++) {
    if (getBiomeAt(biomeMap, col, row) !== "mountain" || rng() > 0.55) continue;
    const cx = col * ts + ts / 2 + (rng() - 0.5) * ts * 0.3, cy = row * ts + ts / 2 + (rng() - 0.5) * ts * 0.3;
    const snowNear = hasBiomeNearby(biomeMap, col, row, "snow", 2);
    const w = ts * (0.48 + rng() * 0.27) * (snowNear ? 1.3 : 1), h = ts * (0.6 + rng() * 0.45) * (snowNear ? 2 : 1);
    const apexX = cx, apexY = cy - h * 0.6;
    if (snowNear) g.ellipse(cx, cy + h * 0.35, w * 1.1, h * 0.28).fill(0xf4f8fc, 0.55);
    g.moveTo(cx - w, cy + h * 0.4).lineTo(apexX, apexY).lineTo(cx + w, cy + h * 0.4).stroke({ color: INK, width: snowNear ? 2.2 : 1.8, alpha: 0.85 });
    g.moveTo(apexX, apexY).lineTo(cx + w * 0.55, cy + h * 0.1).stroke({ color: INK, width: 1, alpha: 0.55 });
    if (snowNear) { g.moveTo(apexX - w * 0.3, apexY + h * 0.28).lineTo(apexX, apexY).lineTo(apexX + w * 0.3, apexY + h * 0.28).fill(0xffffff, 0.92).stroke({ color: INK, width: 0.6, alpha: 0.9 }); }
    if (rng() < 0.4) g.moveTo(cx - w * 0.7, cy + h * 0.55).lineTo(cx - w * 0.7 + w * 0.35, cy + h * 0.55 - h * 0.2).stroke({ color: INK, width: 0.7, alpha: 0.45 });
  }
}
function layerHills(g: Graphics, biomeMap: Record<string, string>, ts: number, maxCol: number, maxRow: number, rng: () => number) {
  for (let row = 0; row < maxRow; row++) for (let col = 0; col < maxCol; col++) {
    const b = getBiomeAt(biomeMap, col, row); if (b !== "desert" && b !== "plain") continue; if (hasBiomeNearby(biomeMap, col, row, "snow", 2)) continue; if (rng() > 0.3) continue;
    const cx = col * ts + ts / 2 + (rng() - 0.5) * ts * 0.5, cy = row * ts + ts / 2 + (rng() - 0.5) * ts * 0.5;
    if (b === "desert") { const w = ts * (0.3 + rng() * 0.25); g.moveTo(cx - w, cy).quadraticCurveTo(cx, cy - ts * 0.22, cx + w, cy).stroke({ color: INK, width: 0.8, alpha: 0.5 }); }
    else { g.moveTo(cx, cy).lineTo(cx, cy - ts * 0.18).stroke({ color: 0x4a5d3a, width: 0.9, alpha: 0.6 }); g.moveTo(cx - ts * 0.08, cy - ts * 0.06).lineTo(cx + ts * 0.16, cy - ts * 0.06).stroke({ color: 0x4a5d3a, width: 0.9, alpha: 0.6 }); }
  }
}
function coniferStamp(g: Graphics, cx: number, cy: number, s: number, color: number, opacity: number) {
  const top = cy - s * 0.7, base = cy + s * 0.7, r1 = s * 0.30, r2 = s * 0.42, r3 = s * 0.52, y1 = cy - s * 0.38, y2 = cy - s * 0.05, y3 = cy + s * 0.28;
  g.moveTo(cx, base).lineTo(cx, top);
  g.moveTo(cx, y1).lineTo(cx - r1, y1 + s * 0.18); g.moveTo(cx, y1).lineTo(cx + r1, y1 + s * 0.18);
  g.moveTo(cx, y2).lineTo(cx - r2, y2 + s * 0.22); g.moveTo(cx, y2).lineTo(cx + r2, y2 + s * 0.22);
  g.moveTo(cx, y3).lineTo(cx - r3, y3 + s * 0.24); g.moveTo(cx, y3).lineTo(cx + r3, y3 + s * 0.24);
  g.moveTo(cx - s * 0.2, base).lineTo(cx + s * 0.4, base);
  g.stroke({ color, width: 1.2, alpha: opacity } as { color: number; width: number; alpha: number; lineCap: string });
}
function layerForests(batches: Graphics[], biomeMap: Record<string, string>, ts: number, maxCol: number, maxRow: number, rng: () => number) {
  let g = newBatch(batches);
  let n = 0;
  for (let brow = 0; brow < maxRow; brow += 2) for (let bcol = 0; bcol < maxCol; bcol += 2) {
    const b = getBiomeAt(biomeMap, bcol + 1, brow + 1), bb = (b === "forest" || b === "plain") ? b : getBiomeAt(biomeMap, bcol, brow);
    if (bb !== "forest" && bb !== "plain") continue; if (hasBiomeNearby(biomeMap, bcol + 1, brow + 1, "snow", 2) && rng() > 0.3) continue;
    const density = bb === "forest" ? 0.85 : 0.3; if (rng() > density) continue;
    if (n >= BATCH_SIZE) { g = newBatch(batches); n = 0; }
    n++;
    const bx = bcol * ts, by = brow * ts, hero = rng() < 0.18;
    if (bb === "plain" && rng() < 0.5) { const cx = bx + ts + (rng() - 0.5) * ts * 0.3, cy = by + ts + (rng() - 0.5) * ts * 0.3, s = ts * 0.42; g.moveTo(cx, cy).lineTo(cx, cy - s * 0.5); g.moveTo(cx - s * 0.25, cy).lineTo(cx - s * 0.25, cy - s * 0.35); g.moveTo(cx + s * 0.25, cy).lineTo(cx + s * 0.25, cy - s * 0.35); g.stroke({ color: INK_GREEN, width: 1, alpha: 0.7 }); continue; }
    const cx1 = bx + ts * 0.65 + (rng() - 0.5) * ts * 0.2, cy1 = by + ts * 1.15 + (rng() - 0.5) * ts * 0.2, s1 = ts * (hero ? 0.5 : 0.42);
    coniferStamp(g, cx1, cy1, s1, hero ? HERO_GREEN : INK_GREEN, 0.9);
    if (bb === "forest" && rng() < 0.8) { const cx2 = bx + ts * 1.35 + (rng() - 0.5) * ts * 0.2, cy2 = by + ts * 0.75 + (rng() - 0.5) * ts * 0.2, s2 = s1 * 0.8; coniferStamp(g, cx2, cy2, s2, INK_GREEN, 0.85); }
  }
}
function layerLakes(g: Graphics, biomeMap: Record<string, string>, ts: number, maxCol: number, maxRow: number, rng: () => number) {
  const seen = new Set(), comps: Array<Array<[number, number]>> = [];
  for (let row = 0; row < maxRow; row++) for (let col = 0; col < maxCol; col++) { if (getBiomeAt(biomeMap, col, row) !== "lake") continue; const k = `${row},${col}`; if (seen.has(k)) continue; const comp: Array<[number, number]> = [], stack: Array<[number, number]> = [[col, row]]; seen.add(k); while (stack.length) { const [cx0, cy0] = stack.pop()!; comp.push([cx0, cy0]); for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = cx0 + dx, ny = cy0 + dy, nk = `${ny},${nx}`; if (nx < 0 || ny < 0 || nx >= maxCol || ny >= maxRow || seen.has(nk)) continue; if (getBiomeAt(biomeMap, nx, ny) !== "lake") continue; seen.add(nk); stack.push([nx, ny]); } } comps.push(comp); }
  for (const comp of comps) {
    let c0 = Infinity, c1 = -Infinity, r0 = Infinity, r1 = -Infinity, wintry = false, coastal = false;
    for (const [col, row] of comp) { if (col < c0) c0 = col; if (col > c1) c1 = col; if (row < r0) r0 = row; if (row > r1) r1 = row; if (!wintry && (hasBiomeNearby(biomeMap, col, row, "snow", 2) || hasBiomeNearby(biomeMap, col, row, "mountain", 2))) wintry = true; if (!coastal && touchesOcean(biomeMap, col, row)) coastal = true; }
    if (coastal) continue;
    for (const [col, row] of comp) { g.beginPath().drawRect(col * ts + 2, row * ts + 2, ts - 4, ts - 4).lineStyle(0.9, INK, 0.55).stroke(); }
    const cx = (c0 + c1 + 1) * ts / 2, cy = (r0 + r1 + 1) * ts / 2, hw = (c1 - c0 + 1) * ts / 2, hh = (r1 - r0 + 1) * ts / 2;
    if (wintry) {
      g.ellipse(cx, cy, hw * 0.8, hh * 0.75).fill(0xebf2fa, 0.75);
      const rips = 1 + Math.min(2, Math.floor((c1 - c0 + r1 - r0) / 2));
      for (let i = 0; i < rips; i++) { const ry = cy - hh * 0.3 + i * hh * 0.3; g.moveTo(cx - hw * 0.55, ry).quadraticCurveTo(hw * 0.55, ry - ts * 0.08, hw * 1.1, ry).stroke({ color: 0xffffff, width: 0.9, alpha: 0.8 }); }
    } else { g.moveTo(cx - hw * 0.55, cy).quadraticCurveTo(hw * 0.55, cy - ts * 0.08, hw * 1.1, cy).stroke({ color: 0x4a6f8a, width: 0.9, alpha: 0.7 }); }
  }
}
function layerFrame(g: Graphics, w: number, h: number, seedText: string) {
  const cx = w - 120, cy = 120;
  g.beginPath().circle(cx, cy, 34).lineStyle(1.2, INK, 0.8).stroke();
  g.moveTo(cx, cy - 30).lineTo(cx + 7, cy).lineTo(cx, cy + 30).lineTo(cx - 7, cy).closePath().lineStyle(1.2, INK, 0.8).stroke();
}

// ---- Main entry point ----

/** Capas conmutables del filtro (diagnóstico vía ?tolkien= en la URL). */
export type TolkienLayer =
  | "parchment" | "washes" | "transition" | "coast" | "sea" | "rivers"
  | "snow" | "mountains" | "hills" | "forests" | "lakes" | "frame";

const ALL_TOLKIEN_LAYERS: TolkienLayer[] = [
  "parchment", "washes", "transition", "coast", "sea", "rivers",
  "snow", "mountains", "hills", "forests", "lakes", "frame",
];

/**
 * Parsea el flag ?tolkien= de la URL (solo diagnóstico, sin UI).
 * - ausente → todas las capas (comportamiento normal)
 * - "off" → ninguna (terreno plano puro)
 * - "coast,rivers" → solo esas
 * - "-coast,-sea" → todas menos esas
 */
export function parseTolkienLayersParam(): Set<TolkienLayer> | null {
  try {
    if (typeof window === "undefined") return null;
    const raw = new URLSearchParams(window.location.search).get("tolkien");
    if (raw === null) return null;
    const v = raw.trim().toLowerCase();
    if (v === "" || v === "off" || v === "none" || v === "0") { debugLogActive("off", new Set()); return new Set(); }
    const parts = v.split(",").map((s) => s.trim()).filter(Boolean);
    if (parts.length === 0) return null;
    // Tolerancia a typos comunes + normalización de guiones dobles.
    const alias: Record<string, string> = {
      trasition: "transition", transicion: "transition", tranisition: "transition",
      transition: "transition",
    };
    const norm = (p: string) => {
      const neg = p.startsWith("-");
      const core = p.replace(/^-+/, "");
      return (neg ? "-" : "") + (alias[core] ?? core);
    };
    const clean = parts.map(norm);
    if (clean.every((p) => p.startsWith("-"))) {
      const excluded = new Set(clean.map((p) => p.slice(1)));
      const active = new Set(ALL_TOLKIEN_LAYERS.filter((l) => !excluded.has(l)));
      debugLogActive(`todas menos: ${[...excluded].join(",")}`, active);
      return active;
    }
    const active = new Set(clean.filter((p): p is TolkienLayer => (ALL_TOLKIEN_LAYERS as string[]).includes(p)));
    debugLogActive("solo", active);
    return active;
  } catch {
    return null;
  }
}

export function applyTolkienFilter(viewport: Container, world: World, layers?: Set<TolkienLayer> | null): Container {
  const tolkienContainer = new Container();
  const on = (l: TolkienLayer) => !layers || layers.has(l);
  const mapW = world.width * TILE_SIZE, mapH = world.height * TILE_SIZE;

  const biomeMap: Record<string, string> = {};
  for (const tile of world.tiles) biomeMap[`${tile.y},${tile.x}`] = tile.terrain;

  const seedHash = hashString(world.seed);
  const rng = createRNG((seedHash ^ 0x70cc1e) >>> 0);
  const maxCol = Math.ceil(mapW / TILE_SIZE) + 2, maxRow = Math.ceil(mapH / TILE_SIZE) + 2;

  const gParchment = new Graphics(); if (on("parchment")) { layerParchment(gParchment, mapW, mapH); tolkienContainer.addChild(gParchment); }
  const washBatches: Graphics[] = []; if (on("washes")) { layerWashes(washBatches, biomeMap, TILE_SIZE, maxCol, maxRow, rng); tolkienContainer.addChild(...washBatches); }
  const transitionBatches: Graphics[] = []; if (on("transition")) { drawTransitionLayer(transitionBatches, biomeMap, TILE_SIZE, maxCol, maxRow, rng); tolkienContainer.addChild(...transitionBatches); }
  const gCoast = new Graphics(); if (on("coast")) { layerCoast(gCoast, biomeMap, TILE_SIZE, maxCol, maxRow, rng); tolkienContainer.addChild(gCoast); }
  const seaBatches: Graphics[] = []; if (on("sea")) { layerSeaWaves(seaBatches, biomeMap, TILE_SIZE, maxCol, maxRow, rng); tolkienContainer.addChild(...seaBatches); }
  if (on("rivers")) {
  if (world.riverTrails && world.riverTrails.length > 0) {
    // trails vienen en coords de tile: lookup directo (sin dividir por TILE_SIZE).
    const terrainByTile = new Map(world.tiles.map((t) => [`${t.x},${t.y}`, t.terrain]));
    const terrainAt = (x: number, y: number) => terrainByTile.get(`${Math.round(x)},${Math.round(y)}`) ?? "ocean";
    const gRivers = new Graphics(); layerRealRivers(gRivers, world.riverTrails, TILE_SIZE, rng, terrainAt); tolkienContainer.addChild(gRivers);
  } else {
    const gRivers = new Graphics(); layerRivers(gRivers, biomeMap, TILE_SIZE, maxCol, maxRow, rng); tolkienContainer.addChild(gRivers);
  }
  }
  const gSnow = new Graphics(); if (on("snow")) { layerSnow(gSnow, biomeMap, TILE_SIZE, maxCol, maxRow, rng); tolkienContainer.addChild(gSnow); }
  const gMountains = new Graphics(); if (on("mountains")) { layerMountains(gMountains, biomeMap, TILE_SIZE, maxCol, maxRow, rng); tolkienContainer.addChild(gMountains); }
  const gHills = new Graphics(); if (on("hills")) { layerHills(gHills, biomeMap, TILE_SIZE, maxCol, maxRow, rng); tolkienContainer.addChild(gHills); }
  const forestBatches: Graphics[] = []; if (on("forests")) { layerForests(forestBatches, biomeMap, TILE_SIZE, maxCol, maxRow, rng); tolkienContainer.addChild(...forestBatches); }
  const gLakes = new Graphics(); if (on("lakes")) { layerLakes(gLakes, biomeMap, TILE_SIZE, maxCol, maxRow, rng); tolkienContainer.addChild(gLakes); }
  const gFrame = new Graphics(); if (on("frame")) { layerFrame(gFrame, mapW, mapH, world.seed); tolkienContainer.addChild(gFrame); }

  viewport.addChild(tolkienContainer);
  return tolkienContainer;
}
