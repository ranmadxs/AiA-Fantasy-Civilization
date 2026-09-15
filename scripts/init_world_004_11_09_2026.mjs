// LLM configuration (dotenv + .bashrc fallback)
import { LLM_PROVIDER, LLM_MODEL, LLM_API_KEY, LLM_ENABLED, PROVIDER_ENDPOINTS } from "./llmConfig.mjs";
// Shared logger and helpers
import { initLog, logLine } from "./loggerBase.mjs";

import { createServer } from "vite";
import { mkdirSync, existsSync, readdirSync, writeFileSync, readFileSync } from "node:fs";
// Renderer ÚNICO (scripts/worldSvg.mjs): el overlay Tolkien genérico vive ahí.
import { generateWorldSVG, FLAVOR_004 } from "./worldSvg.mjs";

const skipTolkien = process.argv.includes("--no-tolkien");

const projectRoot = new URL("..", import.meta.url).pathname;
const seed = "init_world_004_11_09_2026";
const yearsToRun = 3;
const monthsToRun = yearsToRun * 12;
const steps = 4; // 4 years: 0, 1, 2, 3
const snapshotMonths = Array.from({ length: steps }, (_, i) => i * 12); // months 0, 12, 24, 36
const nationCount = 6;

function nextExecutionNumber() {
  const execDir = `${projectRoot}target/images/${seed}`;
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
const outputDir = `${projectRoot}target/images/${seed}/execution_${execNum}`;
const reportPath = `${outputDir}/report.html`;

mkdirSync(outputDir, { recursive: true });

const server = await createServer({
  appType: "custom",
  configFile: undefined,
  logLevel: "error",
  server: { middlewareMode: true },
  root: "src",
});

const modules = await Promise.all([
  server.ssrLoadModule("/world/buildDemoWorld.ts"),
  server.ssrLoadModule("/world/turnSimulation.ts"),
  server.ssrLoadModule("/world/war.ts"),
  server.ssrLoadModule("/world/cityEconomy.ts"),
  server.ssrLoadModule("/world/modelConfig.ts"),
]);
const buildDemoWorld = modules[0].buildDemoWorld;
const advanceSimulationTurn = modules[1].advanceSimulationTurn;
const createInitialSimulationState = modules[1].createInitialSimulationState;
const getNationWarSummary = modules[2].getNationWarSummary;
const calculateNationCityEconomy = modules[3].calculateNationCityEconomy;
const { buildDefaultNationModelConfigs, loadNationModelConfigs } = modules[4];
const { createLLMExecutor, getDecisionLog } = await server.ssrLoadModule("/world/llmExecutor.ts");

const world = buildDemoWorld(seed, { nationCount, provincesPerNation: 1 });

function findMissingNationResources(world) {
  const resourceTypes = ["grain", "timber", "iron", "coal", "oil"];
  return world.nations.flatMap((nation) => {
    const provinceIds = new Set(world.provinces.filter((p) => p.nationId === nation.id).map((p) => p.id));
    const resources = new Set(world.tiles.filter((t) => t.provinceId && provinceIds.has(t.provinceId)).map((t) => t.resource).filter(Boolean));
    return resourceTypes.filter((r) => !resources.has(r)).map((r) => `${nation.name} missing ${r}`);
  });
}

const missingResources = findMissingNationResources(world);
if (missingResources.length > 0) {
  throw new Error(`Missing resources: ${missingResources.join("; ")}`);
}

const defaultConfigs = buildDefaultNationModelConfigs(world);
const LLM_NATION_ID = world.nations[0].id;
const llmConfigs = {};
for (const [nationId, config] of Object.entries(defaultConfigs)) {
    llmConfigs[nationId] = {
    ...config,
    enabled: nationId === LLM_NATION_ID,
    model: LLM_MODEL,
    providerName: LLM_PROVIDER,
    apiKey: LLM_API_KEY,
    endpoint: PROVIDER_ENDPOINTS[LLM_PROVIDER] || config.endpoint,
  };
}
const llmExecutor = LLM_ENABLED ? createLLMExecutor(llmConfigs) : async () => undefined;
console.log(`LLM-controlled nation: ${LLM_NATION_ID}`);

let simulation = createInitialSimulationState(world);
const nationHistory = {};
for (const n of world.nations) nationHistory[n.id] = [];

function recordSnapshot(month) {
  for (const n of world.nations) {
    const cities = world.cities.filter((c) => c.nationId === n.id);
    const provinces = world.provinces.filter((p) => p.nationId === n.id);
    const economy = calculateNationCityEconomy(n.id, world);
    const provIds = new Set(provinces.map((p) => p.id));
    const tileCount = world.tiles.filter((t) => t.provinceId && provIds.has(t.provinceId)).length;
    nationHistory[n.id].push({ month, population: economy.population, provinces: provinces.length, tiles: tileCount, cities: cities.length });
  }
}

function getTechnologyEra(avgCityLevel) {
  if (avgCityLevel < 1.5) return "Primitive";
  if (avgCityLevel < 2.5) return "Classical";
  if (avgCityLevel < 3.5) return "Medieval";
  if (avgCityLevel < 4.5) return "Early Modern";
  return "Late Modern";
}

function getNationData() {
  return world.nations.map((nation) => {
    const cities = world.cities.filter((c) => c.nationId === nation.id);
    const provinces = world.provinces.filter((p) => p.nationId === nation.id);
    const economy = calculateNationCityEconomy(nation.id, world);
    const stockpile = simulation.nationStockpiles[nation.id];
    const summary = getNationWarSummary(simulation.diplomacy, simulation.military, world, nation.id);
    const provIds = new Set(provinces.map((p) => p.id));
    const tiles = world.tiles.filter((t) => t.provinceId && provIds.has(t.provinceId)).length;
    const avgCityLevel = cities.length > 0 ? cities.reduce((s, c) => s + c.level, 0) / cities.length : 0;
    const history = nationHistory[nation.id] || [];
    const last = history[history.length - 1] || { population: economy.population, tiles };
    const first = history[0] || { population: economy.population, tiles };
    return {
      name: nation.name, llmLabel: nation.id === LLM_NATION_ID ? `[${LLM_MODEL}]` : "[🤖 IA-tarada]", id: nation.id, color: nation.color,
      provinces: provinces.length, tiles, cities: cities.length,
      population: economy.population, avgCityLevel,
      technologyEra: getTechnologyEra(avgCityLevel),
      soldiers: summary.totalSoldiers, gold: Math.round(stockpile?.gold ?? 0),
      activeWars: summary.activeWars.length,
      popGrowth: last.population - first.population,
      territoryGrowth: last.tiles - first.tiles,
    };
  });
}

function monthToYear(month) { return Math.round(month / 12); }

async function captureWorld(world, simulation, month) {
  const year = monthToYear(month);
  const htmlPath = `${outputDir}/map_year_${year}.html`;
  // Renderer compartido: inyecta el overlay Tolkien genérico (world.mapSkin).
  const { svg: svgContent } = generateWorldSVG(world, { ...FLAVOR_004, withTolkien: !skipTolkien });
  const TILE_SIZE = 10;
  const W = (world.width + 2) * TILE_SIZE;
  const H = (world.height + 2) * TILE_SIZE;

  const htmlContent = `<!DOCTYPE html><html><head><style>
    body{margin:0;background:#0d1117;display:flex;justify-content:center;align-items:center;width:100vw;height:100vh;overflow:hidden;font-family:Arial,sans-serif}
    .mapViewport{position:relative;width:1040px;height:715px;max-width:95vw;max-height:90vh;background:#132028;border:3px solid #58a6ff;border-radius:8px;overflow:hidden;box-shadow:0 8px 32px rgba(0,0,0,0.6);cursor:grab}
    .mapViewport:active{cursor:grabbing}
    .mapLayer{position:absolute;top:0;left:0;transform-origin:0 0;will-change:transform}
    svg{display:block}
    .mapZoomControls{position:absolute;left:16px;bottom:16px;z-index:10;display:flex;align-items:center;gap:6px;background:rgb(15 24 30 / 92%);border:1px solid rgb(255 255 255 / 20%);border-radius:6px;padding:6px 10px;box-shadow:0 4px 12px rgba(0,0,0,0.4);pointer-events:auto}
    .mapZoomControls button{background:#161b22;border:1px solid #30363d;color:#c9d1d9;width:28px;height:28px;border-radius:4px;font-size:16px;font-weight:bold;cursor:pointer;display:flex;align-items:center;justify-content:center}
    .mapZoomControls button:hover{background:#21262d;border-color:#58a6ff;color:#58a6ff}
    .zoomPercentage{font-size:12px;color:rgb(240 246 237 / 78%);min-width:40px;text-align:center}
  </style></head><body>
    <div class="mapViewport" id="mapViewport">
      <div class="mapLayer" id="mapLayer">
        ${svgContent}
      </div>
      <div class="mapZoomControls">
        <button type="button" onclick="zoomIn()">+</button>
        <button type="button" onclick="zoomOut()">-</button>
        <span class="zoomPercentage" id="zoomPercent">50%</span>
      </div>
    </div>
    <script>
      const svgW = ${W};
      const svgH = ${H};
      const viewport = document.getElementById('mapViewport');
      const viewportW = viewport.clientWidth;
      const viewportH = viewport.clientHeight;

      const fitScale = Math.min(viewportW / svgW, viewportH / svgH);
      let scale = fitScale;
      const minScale = fitScale;
      const maxScale = fitScale * 5.0;

      let panX = (viewportW - svgW * scale) / 2;
      let panY = (viewportH - svgH * scale) / 2;
      let isDragging = false;
      let startX = 0, startY = 0;
      
      const layer = document.getElementById('mapLayer');
      const zoomLabel = document.getElementById('zoomPercent');

      function updateTransform() {
        layer.style.transform = \`translate(\${panX}px, \${panY}px) scale(\${scale})\`;
        const percent = Math.round((scale / fitScale) * 40);
        zoomLabel.textContent = percent + '%';
      }

      updateTransform();

      function zoomIn() {
        const oldScale = scale;
        scale = Math.min(maxScale, scale * 1.2);
        const cx = viewportW / 2;
        const cy = viewportH / 2;
        panX = cx - (cx - panX) * (scale / oldScale);
        panY = cy - (cy - panY) * (scale / oldScale);
        updateTransform();
      }

      function zoomOut() {
        const oldScale = scale;
        scale = Math.max(minScale, scale / 1.2);
        const cx = viewportW / 2;
        const cy = viewportH / 2;
        panX = cx - (cx - panX) * (scale / oldScale);
        panY = cy - (cy - panY) * (scale / oldScale);
        updateTransform();
      }

      viewport.addEventListener('wheel', (e) => {
        e.preventDefault();
        const rect = viewport.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;

        let delta = e.deltaY;
        if (e.deltaMode === 1) delta *= 40;
        else if (e.deltaMode === 2) delta *= 800;

        const factor = Math.abs(delta) > 30 ? (delta > 0 ? 0.9 : 1.1) : (delta > 0 ? 0.97 : 1.03);
        const oldScale = scale;
        scale = Math.min(maxScale, Math.max(minScale, scale * factor));

        panX = mouseX - (mouseX - panX) * (scale / oldScale);
        panY = mouseY - (mouseY - panY) * (scale / oldScale);

        updateTransform();
      }, { passive: false });

      viewport.addEventListener('mousedown', (e) => {
        isDragging = true;
        startX = e.clientX - panX;
        startY = e.clientY - panY;
      });

      window.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        panX = e.clientX - startX;
        panY = e.clientY - startY;
        updateTransform();
      });

      window.addEventListener('mouseup', () => {
        isDragging = false;
      });
    </script>
  </body></html>`;
  writeFileSync(htmlPath, htmlContent);
  return htmlPath;
}

function buildPartialReport(world, simulation, month) {
  const year = monthToYear(month);
  const nations = getNationData();
  const tableRows = nations.map((n) =>
    `<tr style="border-bottom:1px solid #333"><td style="padding:8px"><span style="color:${n.color};font-weight:bold">${n.name} ${n.llmLabel}</span></td>
    <td style="padding:8px;text-align:center">${n.provinces}</td><td style="padding:8px;text-align:center">${n.tiles}</td>
    <td style="padding:8px;text-align:center">${n.cities}</td><td style="padding:8px;text-align:center">${n.population.toLocaleString()}</td>
    <td style="padding:8px;text-align:center">${n.technologyEra}</td><td style="padding:8px;text-align:center">${n.gold.toLocaleString()}</td>
    <td style="padding:8px;text-align:center">${n.soldiers.toLocaleString()}</td><td style="padding:8px;text-align:center">${n.activeWars}</td></tr>`).join("");
return `<!DOCTYPE html><html><head><style>
    body{font-family:Arial,sans-serif;background:#0d1117;color:#e6edf3;margin:20px}
    h1{color:#58a6ff;text-align:center}
    table{width:100%;border-collapse:collapse;margin:20px auto;max-width:1000px}
    th{background:#161b22;padding:12px;text-align:center;border-bottom:2px solid #58a6ff;color:#58a6ff}
    td{padding:8px;text-align:center;border-bottom:1px solid #21262d}
    .footer{margin-top:40px;color:#8b949e;font-size:12px;text-align:center}
  </style></head><body>
    <h1>World Simulation: Year ${year} (${month} months)</h1>
    <div style="color:#8b949e;text-align:center">Seed: ${seed} | Nations: ${world.nations.length} | Executor: LLM (${LLM_PROVIDER}/${LLM_MODEL})</div>
    <table><tr><th>Nation</th><th>Provinces</th><th>Tiles</th><th>Cities</th><th>Population</th><th>Tech Era</th><th>Gold</th><th>Soldiers</th><th>Wars</th></tr>
    ${tableRows}</table>
    
    <div class="footer">AI Civilization Sandbox v0.4.0 - LLM Powered</div>
  </body></html>`;
}

function buildAnnualReport(world, simulation, year) {
  const nations = getNationData();
  // Build year-based population data from nationHistory
  const nationHistoryYears = {};
  // Initialize for all world nations
  for (const n of world.nations) {
    nationHistoryYears[n.id] = nationHistory[n.id] || [];
  }
  // Collect entries for this specific year
  const yearEntries = [];
  for (const n of world.nations) {
    const entries = nationHistoryYears[n.id].filter((h) => {
      if (!h || !h.month) return false;
      return Math.round(h.month / 12) === year;
    });
    yearEntries.push(...entries);
  }
  const yearLabels = [0, 1, 2, 3].map((y) => String(y));
  // Get population data for years 0-3 (or available years)
  const allPopData = yearEntries.map((h) => h.population);
  const tableRows = nations.map((n) =>
    `<tr style="border-bottom:1px solid #333"><td style="padding:12px"><span style="color:${n.color};font-weight:bold;font-size:14px">${n.name} ${n.llmLabel}</span></td>
    <td style="padding:12px;text-align:center">${n.provinces}</td>
    <td style="padding:12px;text-align:center;background:#161b22;font-weight:bold">${n.tiles.toLocaleString()}</td>
    <td style="padding:12px;text-align:center">${n.cities}</td>
    <td style="padding:12px;text-align:center;font-weight:bold">${n.population.toLocaleString()}</td>
    <td style="padding:12px;text-align:center">${n.technologyEra}</td><td style="padding:12px;text-align:center">${n.gold.toLocaleString()}</td>
    <td style="padding:12px;text-align:center">${n.soldiers.toLocaleString()}</td><td style="padding:12px;text-align:center">${n.activeWars}</td>
    <td style="padding:12px;text-align:center">${n.avgCityLevel.toFixed(1)}</td><td style="padding:12px;text-align:center">${n.popGrowth > 0 ? '+' + n.popGrowth.toLocaleString() : n.popGrowth.toLocaleString()}</td>
    <td style="padding:12px;text-align:center">${n.territoryGrowth > 0 ? '+' + n.territoryGrowth : n.territoryGrowth}</td></tr>`).join("");
const chartDiv = `<div class="chart-container"><canvas id="popChart" style="width:800;height:400"></canvas></div>
    <script>
      const ctx = document.getElementById('popChart').getContext('2d');
      // Population data for years 0-3
      const yearLabels = [0, 1, 2, 3];
      const popData = [${yearEntries.map((h) => {
        const y = Math.round(h.month / 12);
        return h.population;
      }).join(',')}];
      new Chart(ctx, {type:'line', data:{labels:yearLabels, datasets:[{ label:'Population', data:popData, borderColor:'#58a6ff', backgroundColor:'#58a6ff20', tension:0.3, pointRadius:3 }]}, options:{responsive:true, plugins:{title:{display:true, text:'Population Growth by Year', color:'#58a6ff'}}, scales:{x:{title:{display:true, text:'Year'}, ticks:{color:'#8b949e'}, grid:{color:'#21262d'}}, y:{title:{display:true, text:'Population'}, ticks:{color:'#8b949e'}, callback:v=>v.toLocaleString()}, grid:{color:'#21262d'}}}});
    </script>`;
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
    body{font-family:Arial,sans-serif;background:#0d1117;color:#e6edf3;margin:0;padding:20px}
    h1{color:#58a6ff;text-align:center;font-size:28px}
    h2{color:#58a6ff;margin-top:40px}
    table{width:100%;border-collapse:collapse;margin:20px auto;max-width:1100px}
    th{background:#161b22;padding:14px;text-align:center;border-bottom:2px solid #58a6ff;color:#58a6ff;font-size:12px}
    td{padding:12px;text-align:center;border-bottom:1px solid #21262d}
    .chart-container{max-width:900px;margin:30px auto;padding:20px;background:#161b22;border-radius:8px}
    .info{color:#8b949e;font-size:14px;text-align:center;margin:20px}
    .footer{margin-top:40px;color:#8b949e;font-size:12px;text-align:center;padding:20px}
  </style><script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script></head><body>
    <h1>🌍 World Simulation: ${seed}</h1>
    <div class="info">Seed: ${seed} | Duration: ${monthsToRun} months (${monthsToRun / 12} years) | Nations: ${world.nations.length} | Executor: LLM (${LLM_PROVIDER}/${LLM_MODEL})</div>
    <h2>Year ${year}</h2>

    <table><tr><th>Nation</th><th>Provinces</th><th>Tiles</th><th>Cities</th><th>Population</th><th>Tech Era</th><th>Gold</th><th>Soldiers</th><th>Wars</th><th>Avg Level</th><th>Pop Growth</th><th>Territory Growth</th></tr>${tableRows}</table>
    ${chartDiv}
    <div class="footer">Generated by AI Civilization Sandbox v0.4.0 | ${new Date().toISOString()}</div>
  </body></html>`;
}
function buildFinalReport() {
  const nations = getNationData();
  // Use existing nationHistory data, grouped by year
  const allYears = [...new Set(
    Object.values(nationHistory).flat().map((h) => Math.round(h.month / 12))
  )].sort((a, b) => a - b);
  const labels = allYears.map((y) => String(y));
  const datasets = world.nations.map((n) => {
    const yearData = Object.values(nationHistory[n.id] || [])
      .filter((h) => Math.round(h.month / 12) in allYears)
      .sort((a, b) => Math.round(a.month / 12) - Math.round(b.month / 12));
    const data = yearData.map((h) => h.population);
    return { label: n.name + " " + n.llmLabel, data, borderColor: n.color, backgroundColor: n.color + "20", tension: 0.3, pointRadius: 3 };
  });
  const territoryDatasets = world.nations.map((n) => {
    const yearData = Object.values(nationHistory[n.id] || [])
      .filter((h) => Math.round(h.month / 12) in allYears)
      .sort((a, b) => Math.round(a.month / 12) - Math.round(b.month / 12));
    const data = yearData.map((h) => h.tiles);
    return { label: n.name + " " + n.llmLabel + " (tiles)", data, borderColor: n.color, backgroundColor: n.color + "20", tension: 0.3, pointRadius: 3 };
  });
  const chartData = JSON.stringify({ labels, datasets });
  const territoryChart = JSON.stringify({ labels, datasets: territoryDatasets });
  const tableRows = nations.map((n) =>
    `<tr style="border-bottom:1px solid #333"><td style="padding:12px"><span style="color:${n.color};font-weight:bold;font-size:14px">${n.name} ${n.llmLabel}</span></td>
    <td style="padding:12px;text-align:center">${n.provinces}</td>
    <td style="padding:12px;text-align:center;background:#161b22;font-weight:bold">${n.tiles.toLocaleString()}</td>
    <td style="padding:12px;text-align:center">${n.cities}</td>
    <td style="padding:12px;text-align:center;font-weight:bold">${n.population.toLocaleString()}</td>
    <td style="padding:12px;text-align:center">${n.technologyEra}</td><td style="padding:12px;text-align:center">${n.gold.toLocaleString()}</td>
    <td style="padding:12px;text-align:center">${n.soldiers.toLocaleString()}</td><td style="padding:12px;text-align:center">${n.activeWars}</td>
    <td style="padding:12px;text-align:center">${n.avgCityLevel.toFixed(1)}</td><td style="padding:12px;text-align:center">${n.popGrowth > 0 ? '+' + n.popGrowth.toLocaleString() : n.popGrowth.toLocaleString()}</td>
    <td style="padding:12px;text-align:center">${n.territoryGrowth > 0 ? '+' + n.territoryGrowth : n.territoryGrowth}</td></tr>`).join("");
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
    body{font-family:Arial,sans-serif;background:#0d1117;color:#e6edf3;margin:0;padding:20px}
    h1{color:#58a6ff;text-align:center;font-size:28px}
    h2{color:#58a6ff;margin-top:40px}
    table{width:100%;border-collapse:collapse;margin:20px auto;max-width:1100px}
    th{background:#161b22;padding:14px;text-align:center;border-bottom:2px solid #58a6ff;color:#58a6ff;font-size:12px}
    td{padding:12px;text-align:center;border-bottom:1px solid #21262d}
    .chart-container{max-width:900px;margin:30px auto;padding:20px;background:#161b22;border-radius:8px}
    .info{color:#8b949e;font-size:14px;text-align:center;margin:20px}
    .footer{margin-top:40px;color:#8b949e;font-size:12px;text-align:center;padding:20px}
  </style><script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script></head><body>
    <h1>🌍 World Simulation: ${seed}</h1>
    <div class="info">Seed: ${seed} | Duration: ${monthsToRun} months (${monthsToRun / 12} years) | Nations: ${world.nations.length} | Executor: LLM (${LLM_PROVIDER}/${LLM_MODEL})</div>
    <table><tr><th>Nation</th><th>Provinces</th><th>Tiles</th><th>Cities</th><th>Population</th><th>Tech Era</th><th>Gold</th><th>Soldiers</th><th>Wars</th><th>Avg Level</th><th>Pop Growth</th><th>Territory Growth</th></tr>${tableRows}</table>
    <div class="chart-container"><canvas id="popChart"></canvas></div>
    <div class="chart-container"><canvas id="territoryChart"></canvas></div>
    <div class="footer">Generated by AI Civilization Sandbox v0.4.0 | ${new Date().toISOString()}</div>
    <script>
      new Chart(document.getElementById('popChart').getContext('2d'),{type:'line',data:${chartData},options:{responsive:true,plugins:{title:{display:true,text:'Population Growth',color:'#58a6ff'}},scales:{x:{title:{display:true,text:'Year'},ticks:{color:'#8b949e'},grid:{color:'#21262d'}},y:{title:{display:true,text:'Population'},ticks:{color:'#8b949e',callback:v=>v.toLocaleString()},grid:{color:'#21262d'}}}}});
      new Chart(document.getElementById('territoryChart').getContext('2d'),{type:'line',data:${territoryChart},options:{responsive:true,plugins:{title:{display:true,text:'Territory (Tiles) Growth Over Time',color:'#58a6ff'}},scales:{x:{title:{display:true,text:'Year'},ticks:{color:'#8b949e'},grid:{color:'#21262d'}},y:{title:{display:true,text:'Tiles'},ticks:{color:'#8b949e',callback:v=>v.toLocaleString()},grid:{color:'#21262d'}}}}});
    </script>
  </body></html>`;
}

try {
  recordSnapshot(0);
  const pngPath0 = await captureWorld(world, simulation, 0);
  writeFileSync(`${outputDir}/report_year_0.html`, buildAnnualReport(world, simulation, 0));
  const snapshots = [{ month: 0, year: 0, pngPath: pngPath0 }];

  const policyHistory = [];
  for (let month = 1; month <= monthsToRun; month += 1) {
    const next = await advanceSimulationTurn(world, simulation, llmExecutor);
    simulation = next;
    policyHistory.push({ month, policies: JSON.parse(JSON.stringify(simulation.nationPolicies)) });
    if (month % 12 === 0) recordSnapshot(month);
    if (snapshotMonths.includes(month)) {
      const pngPath = await captureWorld(world, simulation, month);
      const year = monthToYear(month);
      writeFileSync(`${outputDir}/report_year_${year}.html`, buildAnnualReport(world, simulation, year));
      snapshots.push({ month, year, pngPath });
    }
  }

  writeFileSync(reportPath, buildFinalReport());

  console.log(`\n=== Simulation: ${seed} ===`);
  console.log(`Duration: ${monthsToRun} months (${monthsToRun / 12} years)`);
  console.log(`Executor: LLM (${LLM_PROVIDER}/${LLM_MODEL})`);
  for (const n of world.nations) {
    const h = nationHistory[n.id];
    const last = h[h.length - 1];
    const first = h[0];
    const avgCityLevel = world.cities.filter((c) => c.nationId === n.id).reduce((s, c) => s + c.level, 0) / Math.max(world.cities.filter((c) => c.nationId === n.id).length, 1);
    console.log(`- ${n.name}: pop=${last.population.toLocaleString()} (+${(last.population - first.population).toLocaleString()}), tiles=${last.tiles}, provinces=${last.provinces}, cities=${last.cities}, era=${getTechnologyEra(avgCityLevel)}`);
  }
  const logPath = initLog(`${seed}_execution_${execNum}`, outputDir);
  const execLogPath = `${outputDir}/execution_${execNum}.log`;
  writeFileSync(execLogPath, readFileSync(logPath));

  logLine(logPath, `=== Ejecución ${execNum} - ${seed} ===`);
  logLine(logPath, `Seed: ${seed}`);
  logLine(logPath, `Duración: ${monthsToRun} meses (${monthsToRun / 12} años)`);
  logLine(logPath, `Executor: ${LLM_ENABLED ? `LLM (${LLM_PROVIDER}/${LLM_MODEL})` : "Sin LLM (API key faltante)"}`);
  logLine(logPath, `Nación LLM: ${LLM_NATION_ID}`);
  logLine(logPath, "");
  logLine(logPath, "--- Decisiones LLM ---");
  const decisionLog = getDecisionLog();
  if (LLM_ENABLED) {
    for (const [key, decision] of decisionLog) {
      logLine(logPath, `${key}: expansion=${decision.expansion}, economy=${decision.economy}, diplomacy=${decision.diplomacy}, target=${decision.targetNationId ?? "null"}, rationale="${decision.rationale ?? ""}"`);
    }
  } else {
    logLine(logPath, "LLM deshabilitado (OPENROUTER_API_KEY no configurado).");
  }
  logLine(logPath, "");
  logLine(logPath, "--- Eventos ---");
  for (const event of simulation.events) {
    logLine(logPath, `[M${event.month}] ${event.kind} (${event.nationIds.join(",")}): ${event.title?.replace(/\n/g, " ") ?? event.description?.replace(/\n/g, " ") ?? ""}`);
  }
  logLine(logPath, "");
  logLine(logPath, "--- Políticas IA Local (historial por turno) ---");
  for (const entry of policyHistory) {
    for (const [nationId, policy] of Object.entries(entry.policies)) {
      logLine(logPath, `[M${entry.month}] ${nationId}: expansion=${policy.expansion.policy}, economy=${policy.economy.policy}, diplomacy=${policy.diplomacy.policy}`);
    }
  }
  logLine(logPath, "");
  logLine(logPath, "--- Resumen Final ---");
  for (const n of world.nations) {
    const h = nationHistory[n.id];
    const last = h[h.length - 1];
    const first = h[0];
    const avgCityLevel = world.cities.filter((c) => c.nationId === n.id).reduce((s, c) => s + c.level, 0) / Math.max(world.cities.filter((c) => c.nationId === n.id).length, 1);
    logLine(logPath, `${n.name}: pop=${last.population.toLocaleString()} (+${(last.population - first.population).toLocaleString()}), tiles=${last.tiles}, provinces=${last.provinces}, cities=${last.cities}, era=${getTechnologyEra(avgCityLevel)}`);
  }
  console.log(`Log guardado: ${logPath}`);
} finally {
  await server.close();
}
