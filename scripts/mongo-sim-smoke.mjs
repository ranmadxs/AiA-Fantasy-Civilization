// Smoke end-to-end: 3 turnos reales de simulación → builders mongoSync →
// POST /__aia-mongo/* del dev server vivo → lectura directa en Mongo.
// Limpia sus propios docs al final (seed smoke-gui-001).
// Uso: node scripts/mongo-sim-smoke.mjs [--base http://localhost:5173]
import "dotenv/config";
import { MongoClient } from "mongodb";
import { createServer } from "vite";

const args = process.argv.slice(2);
const base = (args.find((a) => a.startsWith("--base="))?.split("=")[1] ?? "http://localhost:5173").replace(/\/+$/, "");
const MONGO_URI = process.env.MONGO_URI ?? "mongodb://localhost:27017";
const DB_NAME = process.env.MONGO_DB ?? "aia_civilization";
const SEED = "smoke-gui-001";

let pass = 0;
let fail = 0;
const check = (name, cond) => {
  if (cond) { pass += 1; console.log(`   ✅ ${name}`); }
  else { fail += 1; console.log(`   ❌ ${name}`); }
};

async function post(path, body) {
  const res = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${path}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

console.log(`\n🔥 mongo-sim-smoke — ${SEED} contra ${base}`);

// limpieza inicial (por si un run previo crasheó antes de limpiar)
{
  const raw0 = new MongoClient(MONGO_URI);
  await raw0.connect();
  const db0 = raw0.db(DB_NAME);
  for (const c of ["runs", "nations", "events", "nation_monthly", "world_monthly"]) {
    await db0.collection(c).deleteMany({ seed: SEED });
  }
  await raw0.close();
}

const server = await createServer({
  appType: "custom", configFile: undefined, logLevel: "error",
  server: { middlewareMode: true }, root: "src",
});
const { buildDemoWorld } = await server.ssrLoadModule("/world/buildDemoWorld.ts");
const { createInitialSimulationState, advanceSimulationTurn } = await server.ssrLoadModule("/world/turnSimulation.ts");
const sync = await server.ssrLoadModule("/world/mongoSync.ts");

const world = buildDemoWorld(SEED, { nationCount: 3, provincesPerNation: 1 });
let simulation = createInitialSimulationState(world);
const noLLM = async () => undefined;

// run + naciones (como hace App.handleStartGame)
const runRes = await post("/__aia-mongo/run", {
  seed: SEED,
  worldParams: { nationCount: world.nations.length, cityCount: 0, freeProvinceRatio: 0 },
  worldSummary: { nations: world.nations.length, provinces: world.provinces.length, cities: world.cities.length, tiles: world.tiles.length },
  llmNations: [],
  nations: sync.buildNationDocs(world, {}, SEED),
  createdBy: "smoke",
});
check("POST /run ok + runNumber", runRes.ok === true && typeof runRes.runNumber === "number");
const runNumber = runRes.runNumber;

// 3 turnos (como hace App.runNextTurn)
let totalNewEvents = 0;
for (let t = 0; t < 3; t++) {
  const prevCount = simulation.events.length;
  simulation = await advanceSimulationTurn(world, simulation, noLLM);
  const newEvents = simulation.events.slice(prevCount);
  totalNewEvents += newEvents.length;
  const simMonth = simulation.elapsedMonths;
  const nationMonthly = sync.buildNationMonthlyDocs(world, simulation, SEED, simMonth);
  const turnRes = await post("/__aia-mongo/turn", {
    seed: SEED,
    runNumber,
    eventDocs: sync.buildEventDocs(newEvents, SEED),
    nationMonthlyDocs: nationMonthly,
    worldMonthlyDocs: [sync.buildWorldMonthlyDoc(world, nationMonthly, SEED, simMonth)],
    monthsSimulated: simMonth,
  });
  check(`turno ${simMonth} POST /turn ok (${newEvents.length} eventos)`, turnRes.ok === true);
}

// verificación directa en Mongo
const raw = new MongoClient(MONGO_URI);
await raw.connect();
const db = raw.db(DB_NAME);
const q = { seed: SEED };
const runs = await db.collection("runs").countDocuments(q);
const nations = await db.collection("nations").countDocuments(q);
const events = await db.collection("events").countDocuments(q);
const nm = await db.collection("nation_monthly").countDocuments(q);
const wm = await db.collection("world_monthly").countDocuments(q);
check(`runs==1 (hay ${runs})`, runs === 1);
check(`nations==${world.nations.length} (hay ${nations})`, nations === world.nations.length);
check(`events==${totalNewEvents} (hay ${events})`, events === totalNewEvents);
check(`nation_monthly==${world.nations.length * 3} (hay ${nm})`, nm === world.nations.length * 3);
check(`world_monthly==3 (hay ${wm})`, wm === 3);

const sample = await db.collection("events").findOne(q);
check("evento con source/simYear/topTab", !!sample && !!sample.source && sample.simYear === 1 && typeof sample.topTab === "string");
const sampleNm = await db.collection("nation_monthly").findOne(q);
check("nation_monthly con oro/territorio", !!sampleNm && typeof sampleNm.gold === "number" && sampleNm.simYear === 1 && Array.isArray(sampleNm.provinces));
const sampleWm = await db.collection("world_monthly").findOne(q);
check("world_monthly con totales/capitales", !!sampleWm && typeof sampleWm.totals?.gold === "number" && Array.isArray(sampleWm.capitals));

// auditoría fecha real
const runDoc = await db.collection("runs").findOne(q);
check("runs.createdAt fecha real", !!runDoc?.createdAt && !Number.isNaN(Date.parse(runDoc.createdAt)));

// limpieza: borra todo rastro del smoke
for (const c of ["runs", "nations", "events", "nation_monthly", "world_monthly"]) {
  await db.collection(c).deleteMany(q);
}
const leftovers = await db.collection("events").countDocuments(q);
check("limpieza smoke (0 restos)", leftovers === 0);

await raw.close();
await server.close();
console.log(`\n${fail === 0 ? "✅" : "❌"} mongo-sim-smoke: ${pass} pass, ${fail} fail\n`);
process.exit(fail === 0 ? 0 : 1);
