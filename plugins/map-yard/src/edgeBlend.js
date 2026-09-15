/**
 * edge-blend: servicio genérico de degradado HD entre tiles.
 *
 * Suaviza las transiciones cuadradas entre biomas dibujando bandas
 * fundidas + franjas (hierba / musgo) sobre los bordes, sin repintar
 * las celdas. Diseñado para reusarse desde cualquier filtro
 * (tolkien_filter, relief_filter, futuros).
 *
 * Uso:
 *   const { transitionLayer } = require('./lib/edge-blend');
 *   svg += transitionLayer(biomeMap, { ts, maxCol, maxRow, rng, palette });
 *
 * - biomeMap: mapa `{"row,col": "biome"}` como el de parseBiomeMap.
 * - ts: tamaño de tile base en px.
 * - palette: { biome: '#rrggbb' } para mezclar colores de borde.
 * - rng: función aleatoria determinista del filtro que llama.
 */

function hexToRgb(hex) {
  const h = hex.replace('#', '');
  const v = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  return {
    r: parseInt(v.slice(0, 2), 16),
    g: parseInt(v.slice(2, 4), 16),
    b: parseInt(v.slice(4, 6), 16)
  };
}

function rgba(hex, a) {
  const c = hexToRgb(hex);
  return `rgba(${c.r},${c.g},${c.b},${a})`;
}

function mix(h1, h2, t) {
  const a = hexToRgb(h1);
  const b = hexToRgb(h2);
  const r = Math.round(a.r + (b.r - a.r) * t);
  const g = Math.round(a.g + (b.g - a.g) * t);
  const bl = Math.round(a.b + (b.b - a.b) * t);
  const h = (v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(bl)}`;
}

function getBiomeAt(biomeMap, col, row) {
  return biomeMap[`${row},${col}`] || 'ocean';
}

const BROWN = new Set(['mountain', 'desert']);
const GREEN = new Set(['forest', 'plain']);
const BLUE = new Set(['ocean', 'lake']);

function pairKind(a, b) {
  const brownGreen =
    (BROWN.has(a) && GREEN.has(b)) || (GREEN.has(a) && BROWN.has(b));
  if (brownGreen) return 'brown-green';
  if (a === 'snow' || b === 'snow') return 'snow-any';
  const greenBlue =
    (GREEN.has(a) && BLUE.has(b)) || (BLUE.has(a) && GREEN.has(b));
  if (greenBlue) return 'green-blue';
  if (BLUE.has(a) && BLUE.has(b) && a !== b) return 'blue-blue';
  if (a === b) return 'same';
  return 'other';
}

// Recolecta bordes entre biomas distintos.
// Cada arista: segmento eje-alineado, punto medio, biomas de ambos lados
// y lado verde/tierra para el fringe (+1 este/sur, -1 oeste/norte).
function collectBorderEdges(biomeMap, maxCol, maxRow, ts) {
  const edges = [];
  const dirs = [
    { dx: 1, dy: 0 },
    { dx: 0, dy: 1 }
  ];
  for (let row = 0; row < maxRow; row++) {
    for (let col = 0; col < maxCol; col++) {
      const a = getBiomeAt(biomeMap, col, row);
      for (const d of dirs) {
        const b = getBiomeAt(biomeMap, col + d.dx, row + d.dy);
        if (a === b) continue;
        const kind = pairKind(a, b);
        if (kind === 'same') continue;
        // d=(1,0): borde vertical en x=(col+1)*ts; d=(0,1): borde horizontal en y=(row+1)*ts
        const vertical = d.dx !== 0;
        const mx = vertical ? (col + 1) * ts : col * ts + ts / 2;
        const my = vertical ? row * ts + ts / 2 : (row + 1) * ts;
        // greenSide: +1 si lo verde está al este/sur (lado vecino), -1 si al oeste/norte
        const greenSide = GREEN.has(b) ? 1 : GREEN.has(a) ? -1 : 0;
        edges.push({ vertical, mx, my, len: ts, a, b, kind, greenSide });
      }
    }
  }
  return edges;
}

// Banda ondulada: subdivide el borde en 3 tramos con jitter perpendicular
// determinista. Nunca una recta larga ni ángulos rectos.
function wavyBand(x1, y1, x2, y2, ts, rng, color, width, alpha) {
  const dx = x2 - x1, dy = y2 - y1;
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  const nx = -dy / len, ny = dx / len;
  const j = () => (rng() - 0.5) * ts * 0.3;
  const p = (t) => ({ x: x1 + dx * t + nx * j(), y: y1 + dy * t + ny * j() });
  const p1 = p(0.33), p2 = p(0.66);
  const d = `M${x1.toFixed(1)},${y1.toFixed(1)} L${p1.x.toFixed(1)},${p1.y.toFixed(1)} L${p2.x.toFixed(1)},${p2.y.toFixed(1)} L${x2.toFixed(1)},${y2.toFixed(1)}`;
  return `<path d="${d}" fill="none" stroke="${color}" stroke-width="${width.toFixed(1)}" opacity="${alpha}" stroke-linecap="round" stroke-linejoin="round" />\n`;
}

// Banda fundida centrada en el borde: cubre ±50% del tile a cada lado.
function featherEdge(edge, ts, palette, rng) {
  const cA = palette[edge.a] || '#888888';
  const cB = palette[edge.b] || '#888888';
  const mid = mix(cA, cB, 0.5);
  let s = '';
  if (edge.vertical) {
    const y1 = edge.my - ts * 0.55;
    const y2 = edge.my + ts * 0.55;
    const x = edge.mx;
    s += wavyBand(x, y1, x, y2, ts, rng, rgba(mid, 0.22), ts * 1.0);
    s += wavyBand(x, y1, x, y2, ts, rng, rgba(cB, 0.14), ts * 0.6);
  } else {
    const x1 = edge.mx - ts * 0.55;
    const x2 = edge.mx + ts * 0.55;
    const y = edge.my;
    s += wavyBand(x1, y, x2, y, ts, rng, rgba(mid, 0.22), ts * 1.0);
    s += wavyBand(x1, y, x2, y, ts, rng, rgba(cB, 0.14), ts * 0.6);
  }
  return s;
}

// Degradado agua-agua (celeste↔azul): 3 trazos anidados ondulados que funden
// el cuadrado claro en el azul profundo, ±50% del tile.
function waterBlend(edge, ts, palette, rng) {
  const cA = palette[edge.a] || '#888888';
  const cB = palette[edge.b] || '#888888';
  const bands = [
    { t: 0.5, a: 0.30, w: 1.0 },
    { t: 0.32, a: 0.20, w: 0.7 },
    { t: 0.68, a: 0.18, w: 0.4 }
  ];
  let s = '';
  for (const bd of bands) {
    const c = rgba(mix(cA, cB, bd.t), bd.a);
    const w = ts * bd.w;
    if (edge.vertical) {
      const y1 = edge.my - ts * 0.55;
      const y2 = edge.my + ts * 0.55;
      s += wavyBand(edge.mx, y1, edge.mx, y2, ts, rng, c, w);
    } else {
      const x1 = edge.mx - ts * 0.55;
      const x2 = edge.mx + ts * 0.55;
      s += wavyBand(x1, edge.my, x2, edge.my, ts, rng, c, w);
    }
  }
  return s;
}

// Fundido de nieve: halo blanco al 50% sobre el vecino + tinte del
// vecino sangrado sobre la nieve + puntitos de deriva (sin rejilla).
function snowFeather(edge, ts, palette, rng) {
  const other = edge.a === 'snow' ? edge.b : edge.a;
  const cOther = palette[other] || '#888888';
  // snowDir: +1 si la nieve está al este/sur (lado vecino), -1 si al oeste/norte
  const snowDir = edge.b === 'snow' ? 1 : -1;
  let s = '';
  if (edge.vertical) {
    const y1 = edge.my - ts * 0.55;
    const y2 = edge.my + ts * 0.55;
    s += wavyBand(edge.mx, y1, edge.mx, y2, ts, rng, 'rgba(255,255,255,0.35)', ts * 0.8);
    s += wavyBand(edge.mx, y1, edge.mx, y2, ts, rng, rgba(cOther, 0.18), ts * 0.5);
    for (const t of [0.3, 0.55, 0.8]) {
      if (rng() < 0.3) continue;
      const y = (edge.my - ts * 0.5 + t * ts + (rng() - 0.5) * ts * 0.2).toFixed(1);
      const dx = (edge.mx - snowDir * ts * 0.3 + (rng() - 0.5) * ts * 0.2).toFixed(1);
      const r = (ts * (0.05 + rng() * 0.04)).toFixed(1);
      s += `<circle cx="${dx}" cy="${y}" r="${r}" fill="rgba(255,255,255,0.8)" />\n`;
    }
  } else {
    const x1 = edge.mx - ts * 0.55;
    const x2 = edge.mx + ts * 0.55;
    s += wavyBand(x1, edge.my, x2, edge.my, ts, rng, 'rgba(255,255,255,0.35)', ts * 0.8);
    s += wavyBand(x1, edge.my, x2, edge.my, ts, rng, rgba(cOther, 0.18), ts * 0.5);
    for (const t of [0.3, 0.55, 0.8]) {
      if (rng() < 0.3) continue;
      const x = (edge.mx - ts * 0.5 + t * ts + (rng() - 0.5) * ts * 0.2).toFixed(1);
      const dy = (edge.my - snowDir * ts * 0.3 + (rng() - 0.5) * ts * 0.2).toFixed(1);
      const r = (ts * (0.05 + rng() * 0.04)).toFixed(1);
      s += `<circle cx="${x}" cy="${dy}" r="${r}" fill="rgba(255,255,255,0.8)" />\n`;
    }
  }
  return s;
}

// Hierba en borde café↔verde: ticks perpendiculares al borde, a caballo de él.
function grassFringe(edge, ts, rng) {
  let s = '';
  const greens = ['#5a7a3a', '#6a8a42', '#4a6a32'];
  for (let i = 0; i < 3; i++) {
    const t = 0.25 + i * 0.25 + (rng() - 0.5) * 0.08;
    const h = ts * (0.14 + rng() * 0.1);
    const g = greens[Math.floor(rng() * greens.length)];
    if (edge.vertical) {
      const y = (edge.my - ts * 0.5 + t * ts).toFixed(1);
      const x = edge.mx.toFixed(1);
      s += `<path d="M${x},${y} l${h.toFixed(1)},0" fill="none" stroke="${g}" stroke-width="1" opacity="0.75" stroke-linecap="round" />\n`;
    } else {
      const x = (edge.mx - ts * 0.5 + t * ts).toFixed(1);
      const y = edge.my.toFixed(1);
      s += `<path d="M${x},${y} l0,${(-h).toFixed(1)}" fill="none" stroke="${g}" stroke-width="1" opacity="0.75" stroke-linecap="round" />\n`;
    }
  }
  return s;
}

// Musgo pequeño en borde verde↔azul, solo lado tierra.
// greenSide: +1 este/sur, -1 oeste/norte.
function mossFringe(edge, ts, rng) {
  let s = '';
  for (let i = 0; i < 3; i++) {
    const t = 0.2 + i * 0.3 + (rng() - 0.5) * 0.08;
    const r = ts * (0.05 + rng() * 0.045);
    if (edge.vertical) {
      const y = (edge.my - ts * 0.5 + t * ts).toFixed(1);
      const x = (edge.mx + edge.greenSide * ts * 0.22).toFixed(1);
      s += `<circle cx="${x}" cy="${y}" r="${r.toFixed(1)}" fill="#2f4a26" opacity="0.8" />\n`;
    } else {
      const x = (edge.mx - ts * 0.5 + t * ts).toFixed(1);
      const y = (edge.my + edge.greenSide * ts * 0.22).toFixed(1);
      s += `<circle cx="${x}" cy="${y}" r="${r.toFixed(1)}" fill="#2f4a26" opacity="0.8" />\n`;
    }
  }
  return s;
}

// Capa completa: funde todos los bordes + fringe según par.
// opts: { grass: true, moss: true, feather: true, snow: true, water: true }
function transitionLayer(biomeMap, opts) {
  const { ts, maxCol, maxRow, rng, palette } = opts;
  const showGrass = opts.grass !== false;
  const showMoss = opts.moss !== false;
  const showFeather = opts.feather !== false;
  const showSnow = opts.snow !== false;
  const showWater = opts.water !== false;
  let svg = '\n<!-- Transiciones: degradado HD -->\n';
  for (const e of collectBorderEdges(biomeMap, maxCol, maxRow, ts)) {
    if (e.kind === 'blue-blue' && showWater) {
      svg += waterBlend(e, ts, palette, rng);
      continue;
    }
    if ((e.a === 'snow' || e.b === 'snow') && showSnow) {
      if (showFeather) svg += featherEdge(e, ts, palette, rng);
      svg += snowFeather(e, ts, palette, rng);
      continue;
    }
    if (showFeather) svg += featherEdge(e, ts, palette, rng);
    if (e.kind === 'brown-green' && showGrass) svg += grassFringe(e, ts, rng);
    else if (e.kind === 'green-blue' && showMoss) svg += mossFringe(e, ts, rng);
  }
  return svg;
}

function pointsToPath(points) {
  return points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
}

// Degradado escalonado hacia el agua sobre una polilínea ya suavizada.
// points: [{x,y}], nx,ny: normal unitaria hacia el agua.
// stops: [{off, w, a}] en múltiplos de ts. Pronunciado por defecto (~2 tiles).
// Devuelve 3 trazos anidados que derriten el escalón del tile mar adentro.
function waterFeather(points, nx, ny, ts, stops) {
  const STOPS = stops || [
    { off: 0.5, w: 1.2, a: 0.30 },
    { off: 1.1, w: 1.0, a: 0.18 },
    { off: 1.7, w: 0.8, a: 0.08 }
  ];
  let s = '';
  for (const st of STOPS) {
    const moved = points.map((p) => ({ x: p.x + nx * st.off * ts, y: p.y + ny * st.off * ts }));
    s += `<path d="${pointsToPath(moved)}" fill="none" stroke="rgba(159,208,232,${st.a})" stroke-width="${(ts * st.w).toFixed(1)}" stroke-linecap="round" stroke-linejoin="round" />\n`;
  }
  return s;
}

export {
  hexToRgb,
  rgba,
  mix,
  collectBorderEdges,
  featherEdge,
  grassFringe,
  mossFringe,
  waterBlend,
  snowFeather,
  transitionLayer,
  pairKind,
  waterFeather
};
