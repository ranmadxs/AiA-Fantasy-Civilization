import { createServer } from "vite";
import { mkdirSync, existsSync, readdirSync, writeFileSync } from "node:fs";
import {
  parseBiomeMap,
  buildTolkienSVG,
  createRNG as createTolkienRNG,
  generateMap,
} from "../plugins/map-yard/index.js";
// Renderer ÚNICO (scripts/worldSvg.mjs): el overlay Tolkien vive ahí, no en copias.
import { generateWorldSVG, FLAVOR_SVG_GENERATE } from "./worldSvg.mjs";

const projectRoot = new URL("..", import.meta.url).pathname;

// CLI: --base=aia|yard --seed=... --width=N --height=N --no-tolkien
// Salida única: map_year_0.html (el filtro Tolkien ya es genérico, vive en buildDemoWorld).
const argv = process.argv.slice(2);
const opt = (name, def) => {
  const hit = argv.find((a) => a === name || a.startsWith(name + "="));
  if (!hit) return def;
  const eq = hit.indexOf("=");
  return eq >= 0 ? hit.slice(eq + 1) : true;
};
const base = String(opt("--base", "aia")).toLowerCase(); // aia | yard
const seedArg = opt("--seed", "init_world_004_11_09_2026");
const yardWidth = parseInt(opt("--width", "1920"), 10);
const yardHeight = parseInt(opt("--height", "1080"), 10);
const skipTolkien = argv.includes("--no-tolkien");
const nationCount = 6;

function hashSeed(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
const numericSeed = /^\d+$/.test(String(seedArg)) ? parseInt(String(seedArg), 10) : hashSeed(String(seedArg));

function nextExecutionNumber() {
  const execDir = `${projectRoot}target/images/svg_generate`;
  let maxNum = 0;
  if (existsSync(execDir)) {
    const entries = readdirSync(execDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && /^execution_\d{4}$/.test(entry.name)) {
        const num = parseInt(entry.name.replace("execution_", ""), 10);
        if (num > maxNum) maxNum = num;
      }
    }
  }
  const next = maxNum + 1;
  return String(next).padStart(4, "0");
}

const execNum = nextExecutionNumber();
const outputDir = `${projectRoot}target/images/svg_generate/execution_${execNum}`;
mkdirSync(outputDir, { recursive: true });

// ---- main ----
let world = null;
if (base === "aia") {
  const server = await createServer({
    appType: "custom",
    configFile: undefined,
    logLevel: "error",
    server: { middlewareMode: true },
    root: "src",
  });
  const modules = await Promise.all([
    server.ssrLoadModule("/world/buildDemoWorld.ts"),
    server.ssrLoadModule("/world/modelConfig.ts"),
  ]);
  const buildDemoWorld = modules[0].buildDemoWorld;
  const { buildDefaultNationModelConfigs } = modules[1];
  world = buildDemoWorld(String(seedArg), { nationCount, provincesPerNation: 1 });
  buildDefaultNationModelConfigs(world);
  await server.close();
}

// ---- salida única: map_year_0.html ----
if (base === "yard") {
  const { html } = generateMap({ seed: numericSeed, width: yardWidth, height: yardHeight, tileSize: 8 });
  let out = html;
  if (!skipTolkien) {
    const parsed = parseBiomeMap(html);
    const rng = createTolkienRNG(numericSeed);
    out = buildTolkienSVG(html, parsed.biomeMap, parsed.tileSize, rng, String(numericSeed), { width: yardWidth, height: yardHeight });
  }
  writeFileSync(`${outputDir}/map_year_0.html`, out);
  console.log(`Mapa yard generado: ${outputDir}/map_year_0.html`);
} else {
  const { svg: svgContent, deadNations, mapPixelW: fullW, mapPixelH: fullH } = generateWorldSVG(world, { ...FLAVOR_SVG_GENERATE, withTolkien: !skipTolkien });
  const hasDead = deadNations.length > 0;
  const nationList = world.nations.map(n => { const isDead = deadNations.includes(n.id); return `<label style="color:${isDead ? "#ff4444" : n.color};margin-right:16px;cursor:pointer"><input type="checkbox" checked onchange="toggleNation('${n.id}')"> ${isDead ? "💀 " + n.name : n.name}</label>`; }).join(" ") +
     (hasDead ? ` <label style="color:#ff4444;margin-right:16px;cursor:pointer"><input type="checkbox" checked onchange="toggleDead()"> 💀 Naciones Muertas</label>` : "");
  const deadScript = hasDead ? `
function toggleDead() {
  var checked = document.querySelector('input[onchange="toggleDead()"]').checked;
  ${deadNations.map(id => `document.getElementById('dead-${id}').style.display = checked ? '' : 'none';`).join('\n')}
}` : '';

  const htmlContent = `<!DOCTYPE html><html><head><style>
  body{margin:0;background:#132028;display:flex;justify-content:center;align-items:center;width:100vw;height:100vh;overflow:hidden;font-family:Arial,sans-serif}
  #map-container{position:relative;width:980px;height:660px;overflow:hidden}
  #map-svg{width:980px;height:660px;display:block;cursor:grab}
  #map-svg:active{cursor:grabbing}
  #map-frame{position:absolute;top:0;left:0;width:980px;height:660px;border:2px solid #49b7c9;box-shadow:0 0 15px rgba(73,183,201,0.6),0 0 30px rgba(73,183,201,0.3),inset 0 0 15px rgba(73,183,201,0.2);pointer-events:none;z-index:10;border-radius:2px}
  #map-frame::before{content:'';position:absolute;top:-4px;left:-4px;right:-4px;bottom:-4px;border:1px solid rgba(73,183,201,0.3);border-radius:4px;pointer-events:none}
  #map-frame::after{content:'';position:absolute;top:8px;left:8px;right:8px;bottom:8px;border:1px solid rgba(73,183,201,0.15);border-radius:2px;pointer-events:none}
  #zoom-controls{position:fixed;bottom:20px;right:20px;z-index:200;display:flex;flex-direction:column;gap:8px}
  #zoom-controls button{width:40px;height:40px;border-radius:8px;border:2px solid #58a6ff;background:#161b22;color:#58a6ff;font-size:20px;font-weight:bold;cursor:pointer;display:flex;justify-content:center;align-items:center}
  #zoom-controls button:hover{background:#58a6ff;color:#132028}
  #zoom-info{position:fixed;bottom:20px;left:20px;z-index:200;background:rgba(0,0,0,0.85);color:#58a6ff;padding:10px 16px;border-radius:8px;font-size:13px;border:1px solid #333}
  #zoom-info span{color:#e6edf3;font-weight:bold}
  #nation-overlay{position:fixed;top:10px;left:10px;z-index:100;background:rgba(0,0,0,0.85);padding:12px;border-radius:6px;font-family:Arial,sans-serif;font-size:13px;color:#fff;border:1px solid #333}
</style></head><body>
<div id="map-container">${svgContent}<div id="map-frame"></div></div>
<div id="zoom-info">Zoom: <span id="zoom-pct">100</span>% | Tiles visibles: <span id="zoom-tiles">0</span></div>
<div id="zoom-controls"><button onclick="zoomIn()">+</button><button onclick="zoomOut()">-</button></div>
<div id="nation-overlay">${nationList}</div>
<script>
  const mapPixelW = ${fullW};
  const mapPixelH = ${fullH};
  const svg = document.getElementById('map-svg');
  const zoomPct = document.getElementById('zoom-pct');
  const zoomTiles = document.getElementById('zoom-tiles');
  const svgContainer = document.getElementById('map-container');
  const svgW = mapPixelW;
  const svgH = mapPixelH;
  const FRAME_W = mapPixelW;
  const FRAME_H = mapPixelH;
  let scale = 1.0;
  let panX = 0, panY = 0;
  let dragging = false, dragStartX, dragStartY, panStartX, panStartY;
  const tileSize = 10;
  svg.addEventListener('mousedown', function(e) { dragging = true; dragStartX = e.clientX; dragStartY = e.clientY; panStartX = panX; panStartY = panY; svg.style.cursor = 'grabbing'; });
  window.addEventListener('mousemove', function(e) { if (!dragging) return; panX = panStartX - (e.clientX - dragStartX); panY = panStartY - (e.clientY - dragStartY); updateZoom(); });
  window.addEventListener('mouseup', function() { dragging = false; svg.style.cursor = 'grab'; });
  function clampPan(vbW, vbH) {
    const ox = (vbW - svgW) / 2;
    const oy = (vbH - svgH) / 2;
    const minPanX = ox;
    const maxPanX = svgW - vbW + ox;
    const minPanY = oy;
    const maxPanY = svgH - vbH + oy;
    if (maxPanX >= minPanX) {
      return { panX: Math.max(minPanX, Math.min(maxPanX, panX)), panY: Math.max(minPanY, Math.min(maxPanY, panY)) };
    }
    return { panX: minPanX, panY: minPanY };
  }
  function updateZoom() {
    const vbW = svgW / scale;
    const vbH = svgH / scale;
    const ox = (vbW - svgW) / 2;
    const oy = (vbH - svgH) / 2;
    const clamped = clampPan(vbW, vbH);
    panX = clamped.panX; panY = clamped.panY;
    svg.setAttribute('viewBox', (panX - ox) + ' ' + (panY - oy) + ' ' + vbW + ' ' + vbH);
    zoomPct.textContent = Math.round(scale * 100);
    zoomTiles.textContent = Math.ceil(vbW / tileSize) + 'x' + Math.ceil(vbH / tileSize) + ' (' + (Math.ceil(vbW / tileSize) * Math.ceil(vbH / tileSize)) + ')';
  }
  function zoomIn() { scale = Math.min(scale + 0.05, 5); updateZoom(); }
  function zoomOut() { scale = Math.max(scale - 0.05, 0.2); updateZoom(); }
  document.addEventListener('wheel', function(e) {
    e.preventDefault();
    const dir = Math.sign(e.deltaY);
    scale = dir < 0 ? Math.min(scale + 0.05, 5) : Math.max(scale - 0.05, 0.2);
    updateZoom();
  }, { passive: false });
  function toggleNation(nid) {
    var g = document.getElementById('nation-' + nid);
    if (g) g.style.display = g.style.display === 'none' ? '' : 'none';
  }
  ${deadScript}
  updateZoom();
<\/script>
</body></html>`;

  writeFileSync(`${outputDir}/map_year_0.html`, htmlContent);
  console.log(`Mapa generado: ${outputDir}/map_year_0.html`);
  console.log(`Naciones: ${world.nations.map(n => n.name).join(', ')}`);
  if (world.mapSkin && !skipTolkien) console.log(`Overlay genérico incrustado: ${Object.keys(world.mapSkin.biomeCounts).length} biomas, ts=${world.mapSkin.tileSize}`);
}
