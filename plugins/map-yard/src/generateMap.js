/**
 * Generador de mapas continentales — plugin @aia/map-yard (ESM puro).
 * Origen: map-yard/script/generate_map.js
 *
 * Uso librería:
 *   import { createRNG, generateContinentalMap, generateSVGContinental, generateBaseHTML } from '@aia/map-yard';
 * Uso CLI standalone:
 *   node src/generateMap.js --seed 42 --width 1920 --height 1080 --output target/generate_map
 */

export const DEFAULT_TILE_SIZE = 8;

// Generador LCG simple
export function createRNG(seed) {
  let s = seed;
  return function() {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

// Ruido simplificado con función radial para forma de continente
function noiseRadial(x, y, cx, cy, rng) {
  const dx = x - cx;
  const dy = y - cy;
  const dist = Math.sqrt(dx * dx + dy * dy) / Math.sqrt(cx * cx + cy * cy);
  const angle = Math.atan2(dy, dx) / (2 * Math.PI);
  const n1 = rng();
  const n2 = rng();
  const n3 = rng();
  const hashVal = (angle * 1000 + dist * 1000 + n1 * 500 + n2 * 300 + n3 * 100) | 0;
  return (hashVal % 1000) / 500 - 1;
}

// Generar mapa con forma de continente.
// La silueta depende de la semilla: centro desplazado, rotación,
// estiramiento anisotrópico y oleaje costero con fase/frecuencia propias.
export function generateContinentalMap(gridWidth, gridHeight, rng) {
  // Centro desplazado por semilla: el continente no siempre está al medio
  const cx = gridWidth / 2 + (rng() - 0.5) * gridWidth * 0.26;
  const cy = gridHeight / 2 + (rng() - 0.5) * gridHeight * 0.26;
  const maxRadius = Math.min(gridWidth, gridHeight) / 2 * 0.9;

  // Deformación global por semilla: rotación + estiramiento anisotrópico
  const rot = rng() * Math.PI * 2;
  const cosR = Math.cos(rot);
  const sinR = Math.sin(rot);
  const stretchX = 0.72 + rng() * 0.56;
  const stretchY = 0.72 + rng() * 0.56;

  // Oleaje costero por semilla: bahías y penínsulas en ángulos distintos
  const wobAmp = maxRadius * (0.15 + rng() * 0.18);
  const wobFreq = 2 + Math.floor(rng() * 3);
  const wobPhase = rng() * Math.PI * 2;
  const wobAmp2 = maxRadius * (0.05 + rng() * 0.08);
  const wobFreq2 = 5 + Math.floor(rng() * 4);
  const wobPhase2 = rng() * Math.PI * 2;

  const grid = [];
  for (let y = 0; y <= gridHeight; y++) {
    grid[y] = [];
    for (let x = 0; x <= gridWidth; x++) {
      const dx = x - cx;
      const dy = y - cy;
      // Rotar y estirar el dominio antes de medir la distancia
      const rx = (dx * cosR - dy * sinR) / stretchX;
      const ry = (dx * sinR + dy * cosR) / stretchY;
      const r = Math.sqrt(rx * rx + ry * ry);
      const ang = Math.atan2(ry, rx);
      const wobble = Math.sin(ang * wobFreq + wobPhase) * wobAmp
                   + Math.sin(ang * wobFreq2 + wobPhase2) * wobAmp2;
      const dist = (r + wobble) / Math.max(1, maxRadius);

      if (dist > 1.0) {
        grid[y][x] = -0.8 + (rng() - 0.5) * 0.1;
        continue;
      }

      const baseNoise = noiseRadial(x, y, cx, cy, rng);
      let sum = baseNoise;
      let count = 1;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx >= 0 && nx <= gridWidth && ny >= 0 && ny <= gridHeight) {
            sum += noiseRadial(nx, ny, cx, cy, rng);
            count++;
          }
        }
      }
      const smoothed = sum / count;
      const octave1 = noiseRadial(x * 0.5, y * 0.5, cx * 0.5, cy * 0.5, rng) * 0.25;
      const octave2 = noiseRadial(x * 0.25, y * 0.25, cx * 0.25, cy * 0.25, rng) * 0.125;
      let finalNoise = smoothed + octave1 + octave2;
      const edgeMargin = 0.1;
      if (dist > 1.0 - edgeMargin) {
        finalNoise = -0.5;
      }
      grid[y][x] = finalNoise;
    }
  }
  return grid;
}

// Interpolar valor entre tiles (bilineal)
function bilinearInterpolate(grid, x, y) {
  const cols = grid[0].length;
  const rows = grid.length;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = x0 + 1;
  const y1 = y0 + 1;

  if (x0 < 0 || y0 < 0 || x1 >= cols || y1 >= rows) {
    return 0;
  }

  const dx = x - x0;
  const dy = y - y0;

  const v00 = grid[y0][x0];
  const v10 = grid[y0][x1];
  const v01 = grid[y1][x0];
  const v11 = grid[y1][x1];

  const ix = (1 - dx) * v00 + dx * v10;
  const iy = (1 - dy) * v01 + dy * v11;

  return (1 - dy) * ix + dy * iy;
}

// Clasificar bioma basado en valor de ruido
export function classifyBiome(noiseValue) {
  if (noiseValue < -0.45) return 'ocean';
  if (noiseValue < -0.30) return 'lake';
  if (noiseValue < -0.10) return 'plain';
  if (noiseValue < 0.15) return 'forest';
  if (noiseValue < 0.40) return 'mountain';
  if (noiseValue < 0.55) return 'desert';
  return 'snow';
}

// Colores base para cada bioma (colores sólidos, sin gradientes)
export const biomeColors = {
  ocean: '#0a2a4a',
  lake: '#5aa8d8',
  plain: '#8fbc8f',
  forest: '#2c5f2d',
  mountain: '#a0a0a0',
  desert: '#d2b48c',
  snow: '#f5f5f5'
};

// Generar el SVG con colores sólidos (sin gradientes)
export function generateSVGContinental(grid, width, height, tileSize, rng) {
  const gridWidth = grid[0].length - 1;
  const gridHeightActual = grid.length - 1;

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">\n`;

  // Renderizar cada tile con colores sólidos
  for (let y = 0; y < gridHeightActual; y++) {
    for (let x = 0; x < gridWidth; x++) {
      const mx = x * tileSize;
      const my = y * tileSize;

      const center = bilinearInterpolate(grid, x + 0.5, y + 0.5);
      const biome = classifyBiome(center);
      const color = biomeColors[biome];

      svg += `<rect x="${mx}" y="${my}" width="${tileSize}" height="${tileSize}" fill="${color}" />\n`;
    }
  }

  // Costas detalladas - detección más refinada
  svg += '\n<!-- Costas detalladas -->\n';
  for (let y = 1; y < gridHeightActual - 1; y++) {
    for (let x = 1; x < gridWidth - 1; x++) {
      const left = bilinearInterpolate(grid, x, y);
      const right = bilinearInterpolate(grid, x + 1, y);
      const top = bilinearInterpolate(grid, x, y - 1);
      const bottom = bilinearInterpolate(grid, x, y + 1);

      const isLeftOcean = left < -0.35;
      const isRightOcean = right < -0.35;
      const isTopOcean = top < -0.35;
      const isBottomOcean = bottom < -0.35;

      const isCoast = (isLeftOcean !== isRightOcean || isTopOcean !== isBottomOcean) &&
                     !(isLeftOcean && isRightOcean && isTopOcean && isBottomOcean);

      if (isCoast) {
        const mx = x * tileSize + tileSize / 2;
        const my = y * tileSize + tileSize / 2;
        svg += `<circle cx="${mx}" cy="${my}" r="1" fill="#ffffff" opacity="0.4" />\n`;
      }
    }
  }

  // Ríos - desde montañas hasta el mar.
  // 2 grandes interiores (largos, crecen aguas abajo) + 8 arroyitos.
  svg += '\n<!-- Ríos aluvialos -->\n';
  const riverDensity = 0.015;
  let bigRivers = 0, smallRivers = 0;
  const BIG_TARGET = 2, SMALL_TARGET = 8, BIG_MIN_STEPS = 12;
  const isInterior = (gx, gy) => {
    for (let oy = -3; oy <= 3; oy++) {
      for (let ox = -3; ox <= 3; ox++) {
        if (bilinearInterpolate(grid, gx + ox, gy + oy) < -0.2) return false;
      }
    }
    return true;
  };
  for (let y = 1; y < gridHeightActual - 1; y++) {
    for (let x = 1; x < gridWidth - 1; x++) {
      if (bigRivers >= BIG_TARGET && smallRivers >= SMALL_TARGET) break;
      const current = bilinearInterpolate(grid, x + 0.5, y + 0.5);
      if (current < -0.1 || current > 0.5 || rng() >= riverDensity) continue;
      const wantBig = bigRivers < BIG_TARGET && current > 0.15 && isInterior(x + 0.5, y + 0.5);
      if (!wantBig && smallRivers >= SMALL_TARGET) continue;
      const maxSteps = wantBig ? 48 : 20;
      let tx = x + 0.5, ty = y + 0.5;
      let steps = 0;
      const trail = [];

      while (steps < maxSteps) {
        const below = bilinearInterpolate(grid, tx + 0.5, ty + 1.5);
        const leftVal = bilinearInterpolate(grid, tx - 1.5, ty + 0.5);
        const rightVal = bilinearInterpolate(grid, tx + 1.5, ty + 0.5);

        const towardSea = (below < current - 0.15) || (leftVal < current - 0.15);
        const towardSeaRight = (rightVal < current - 0.15);

        if (towardSeaRight) {
          tx += 1;
        } else if (towardSea) {
          ty += 1;
        } else {
          const leftDrop = current - leftVal;
          const rightDrop = current - rightVal;
          if (leftDrop > rightDrop && leftVal < current - 0.05) {
            tx -= 1;
          } else if (rightDrop > leftDrop && rightVal < current - 0.05) {
            tx += 1;
          } else {
            break;
          }
        }

        trail.push({ tx, ty, step: steps });
        steps++;
      }

      const isBig = wantBig && trail.length >= BIG_MIN_STEPS;
      if (!isBig && (smallRivers >= SMALL_TARGET || trail.length < 3)) {
        continue;
      }
      if (isBig) {
        bigRivers++;
        for (const p of trail) {
          const sx = Math.floor(p.tx) * tileSize + tileSize / 2;
          const sy = Math.floor(p.ty) * tileSize + tileSize / 2;
          const riverRadius = 1.5 + p.step * 0.15;
          svg += `<circle cx="${sx}" cy="${sy}" r="${riverRadius.toFixed(2)}" fill="#88c8f8" opacity="${(0.45 + p.step * 0.008).toFixed(2)}" />\n`;
        }
      } else {
        smallRivers++;
        for (const p of trail) {
          const sx = Math.floor(p.tx) * tileSize + tileSize / 2;
          const sy = Math.floor(p.ty) * tileSize + tileSize / 2;
          const riverRadius = 1.5 * (1 - p.step / maxSteps);
          svg += `<circle cx="${sx}" cy="${sy}" r="${riverRadius.toFixed(2)}" fill="#88c8f8" opacity="${(0.4 + p.step * 0.01).toFixed(2)}" />\n`;
        }
      }
    }
  }

  // Bosques densos - en áreas específicas del continente
  svg += '\n<!-- Bosques templados -->\n';
  const forestMinSize = 3;
  for (let y = 0; y < gridHeightActual; y++) {
    for (let x = 0; x < gridWidth; x++) {
      const value = bilinearInterpolate(grid, x + 0.5, y + 0.5);
      if (value > 0.05 && classifyBiome(value) === 'forest') {
        const treeCount = Math.floor(rng() * 5) + 1;
        for (let t = 0; t < treeCount; t++) {
          const tx = x * tileSize + rng() * tileSize;
          const ty = y * tileSize + rng() * tileSize;
          const size = rng() * 3 + 1;
          svg += `<circle cx="${tx}" cy="${ty}" r="${size}" fill="#2d5a2d" opacity="0.6" />\n`;
        }
      }
    }
  }

  // Montañas con picos más naturales
  svg += '\n<!-- Montañas -->\n';
  for (let y = 0; y < gridHeightActual; y++) {
    for (let x = 0; x < gridWidth; x++) {
      const value = bilinearInterpolate(grid, x + 0.5, y + 0.5);
      if (value > 0.3 && classifyBiome(value) === 'mountain') {
        const px = x * tileSize + tileSize / 2;
        const py = y * tileSize + tileSize / 2;
        const peakVariation = (rng() - 0.5) * 4;
        const peakHeight = 6 + peakVariation;
        const points = [
          `${px} ${py - peakHeight}`,
          `${px - 5} ${py + 2}`,
          `${px + 5} ${py + 2}`
        ];
        svg += `<polygon points="${points.join(',')}" fill="#8c8c8c" opacity="0.8" />\n`;
      }
    }
  }

  // Desiertos - en zonas de lluvia de sombra
  svg += '\n<!-- Desiertos -->\n';
  for (let y = 0; y < gridHeightActual; y++) {
    for (let x = 0; x < gridWidth; x++) {
      const value = bilinearInterpolate(grid, x + 0.5, y + 0.5);
      if (value > 0.48 && classifyBiome(value) === 'desert') {
        const dx = x * tileSize + tileSize / 2;
        const dy = y * tileSize + tileSize / 2;
        const duneSize = rng() * 10 + 5;
        const orientation = rng() * 90 - 45;
        const transform = `rotate(${orientation} ${dx} ${dy})`;
        svg += `<g transform="${transform}"><ellipse cx="0" cy="0" rx="${duneSize}" ry="3" fill="#c1a968" opacity="0.7" /></g>\n`;
      }
    }
  }

  // Cimas nevadas en las altitudes más altas
  svg += '\n<!-- Cimas nevadas -->\n';
  for (let y = 0; y < gridHeightActual; y++) {
    for (let x = 0; x < gridWidth; x++) {
      const value = bilinearInterpolate(grid, x + 0.5, y + 0.5);
      if (value > 0.5 && classifyBiome(value) === 'snow') {
        const px = x * tileSize + tileSize / 2;
        const py = y * tileSize + tileSize / 2;
        svg += `<circle cx="${px}" cy="${py - 1}" r="2" fill="#f8f8f8" opacity="0.9" />\n`;
      }
    }
  }

  // Borde exterior del continente - línea de costa más definida
  svg += '\n<!-- Línea de costa principal -->\n';
  let coastPoints = [];
  for (let y = 1; y < gridHeightActual - 1; y++) {
    for (let x = 1; x < gridWidth - 1; x++) {
      const left = bilinearInterpolate(grid, x, y);
      const right = bilinearInterpolate(grid, x + 1, y);
      const top = bilinearInterpolate(grid, x, y - 1);
      const bottom = bilinearInterpolate(grid, x, y + 1);

      const isOcean = left < -0.35 || right < -0.35 || top < -0.35 || bottom < -0.35;
      const isLand = !isOcean;

      if (isLand) {
        const checks = [
          { x: x - 1, y: y, dir: -1 },
          { x: x + 1, y: y, dir: 1 },
          { x: x, y: y - 1, dir: -1 },
          { x: x, y: y + 1, dir: 1 }
        ];
        for (const check of checks) {
          const nleft = bilinearInterpolate(grid, check.x, check.y);
          if (isLand && nleft < -0.35) {
            const worldX = x * tileSize + tileSize / 2;
            const worldY = y * tileSize + tileSize / 2;
            svg += `<circle cx="${worldX}" cy="${worldY}" r="0.5" fill="#ffffff" opacity="0.2" />\n`;
          }
        }
      }
    }
  }

  svg += '</svg>\n';
  return svg;
}

// Generación pura (sin FS ni CLI): devuelve { svg, html, grid }.
export function generateMap({ seed = Date.now(), width = 1920, height = 1080, tileSize = DEFAULT_TILE_SIZE } = {}) {
  const rng = createRNG(seed);
  const gridWidth = Math.ceil(width / tileSize) + 2;
  const gridHeight = Math.ceil(height / tileSize) + 2;
  const noiseGrid = generateContinentalMap(gridWidth, gridHeight, rng);
  const svgContent = generateSVGContinental(noiseGrid, width, height, tileSize, rng);
  const htmlContent = generateBaseHTML(svgContent, { seed, width, height });
  return { svg: svgContent, html: htmlContent, grid: noiseGrid, tileSize, seed, width, height };
}

// Contenido HTML completo
export function generateBaseHTML(svgContent, { seed = 0, width = 1920, height = 1080 } = {}) {
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Mapa Continental - Semilla ${seed}</title>
  <style>
    body {
      min-height: 100vh;
      margin: 0;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      background: #1a1a2e;
      color: #e0e0e0;
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
    }
    h1 {
      margin: 1rem 0 0.5rem;
      font-size: 1.5rem;
      color: #d4af37;
    }
    p {
      margin: 0.5rem 0 1rem;
      font-size: 0.9rem;
      color: #aaa;
    }
    .container {
      display: flex;
      flex-direction: column;
      align-items: center;
    }
    svg {
      border: 1px solid #444;
      background: #16213e;
      max-width: 100%;
      height: auto;
    }
    .controls {
      margin-top: 1rem;
      display: flex;
      gap: 1rem;
      flex-wrap: wrap;
      justify-content: center;
    }
    .control-label {
      font-size: 0.8rem;
      color: #888;
      margin-right: 0.5rem;
    }
    .control-input {
      padding: 0.3rem 0.5rem;
      font-size: 0.8rem;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>Mapa Continental Ficticio</h1>
    <p>Semilla: ${seed} | Dimensiones: ${width}×${height} px</p>
    ${svgContent}
    <div class="controls">
      <span class="control-label">Semilla:</span>
      <input type="number" class="control-input" value="${seed}" id="seedInput" readonly>
      <button class="control-input" onclick="location.reload()">Nuevo mapa</button>
      <button class="control-input" onclick="downloadMap()">Descargar SVG</button>
    </div>
  </div>

  <script>
    function downloadMap() {
      const svg = document.querySelector('svg').outerHTML;
      const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'mapa-continente-${seed}.svg';
      a.click();
      URL.revokeObjectURL(url);
    }
  </script>
</body>
</html>`;
}

// ---- Ejecución CLI standalone (solo cuando se invoca directo con node) ----
export async function runGenerateMapCLI(args = process.argv.slice(2)) {
  const { default: fs } = await import('node:fs');
  const { default: path } = await import('node:path');
  let width = 1920, height = 1080, seed = Date.now(), outputDir = 'target/generate_map', tileSize = DEFAULT_TILE_SIZE;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--width' && i + 1 < args.length) width = parseInt(args[++i], 10);
    else if (arg === '--height' && i + 1 < args.length) height = parseInt(args[++i], 10);
    else if (arg === '--seed' && i + 1 < args.length) seed = parseInt(args[++i], 10);
    else if (arg === '--tileSize' && i + 1 < args.length) tileSize = parseInt(args[++i], 10);
    else if (arg === '--output' && i + 1 < args.length) {
      const customPath = args[++i];
      const customDir = path.dirname(customPath);
      if (customDir !== '.') outputDir = customDir;
    }
  }
  console.log(`Generando mapa continental ${width}×${height} con semilla ${seed}...`);
  const { html } = generateMap({ seed, width, height, tileSize });
  const outputFileName = `mapa-semilla-${seed}.html`;
  const outputPath = path.resolve(outputDir, outputFileName);
  const outputDirPath = path.dirname(outputPath);
  if (!fs.existsSync(outputDirPath)) fs.mkdirSync(outputDirPath, { recursive: true });
  fs.writeFileSync(outputPath, html);
  console.log(`Mapa continental generado y guardado en: ${outputPath}`);
  return outputPath;
}

const __isGenerateMain = (() => {
  try {
    const invoked = process.argv[1] ? new URL(`file://${process.argv[1]}`).href : '';
    return invoked === import.meta.url;
  } catch { return false; }
})();
if (__isGenerateMain) { await runGenerateMapCLI(); }