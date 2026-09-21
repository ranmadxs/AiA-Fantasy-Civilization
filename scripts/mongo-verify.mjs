// Verificación de integración contra MongoDB real (plain node).
// Usa los stores TS vía Vite ssrLoadModule (mismo patrón que sim:00x).
// La DB de test se aísla con MONGO_DB=aia_civilization_test.
// Uso: node scripts/mongo-verify.mjs
import "dotenv/config";
import { readFileSync } from "node:fs";
import { MongoClient } from "mongodb";
import { createServer } from "vite";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
console.log(`\n🔍 mongo-verify — cliente ${pkg.name}@${pkg.version}`);

process.env.MONGO_DB = "aia_civilization_test";
const MONGO_URI = process.env.MONGO_URI ?? "mongodb://localhost:27017";
const TEST_DB = process.env.MONGO_DB;

const now = () => new Date().toISOString();
let pass = 0;
let fail = 0;
function check(name, cond) {
  if (cond) { pass += 1; console.log(`   ✅ ${name}`); }
  else { fail += 1; console.log(`   ❌ ${name}`); }
}

const projectRoot = new URL("..", import.meta.url).pathname;
const server = await createServer({
  appType: "custom",
  configFile: undefined,
  logLevel: "error",
  server: { middlewareMode: true },
  root: "src",
});
const stores = await server.ssrLoadModule("/server/mongo/stores.ts");
const { COLLECTIONS } = await server.ssrLoadModule("/server/mongo/models.ts");

const raw = new MongoClient(MONGO_URI);
await raw.connect();
const db = raw.db(TEST_DB);
await db.dropDatabase();
stores.setDbOverride(db);
console.log(`   DB de test: ${TEST_DB} (limpia)`);

// 1. nextRunNumber secuencial
const n1 = await stores.nextRunNumber("seq-v");
const n2 = await stores.nextRunNumber("seq-v");
check("nextRunNumber 1,2 secuencial", n1 === 1 && n2 === 2);

// 2. createRun + getRun
const created = await stores.createRun({
  seed: "crud-v", runNumber: 1,
  worldParams: { nationCount: 2, cityCount: 4, freeProvinceRatio: 0.2 },
  worldSummary: { nations: 2, provinces: 8, cities: 4, tiles: 512 },
  llmNations: [{ nationId: "n1", provider: "ollama", model: "qwen2.5", enabled: true }],
  createdBy: "mongo-verify",
});
const fetched = await stores.getRun("crud-v", 1);
check("createRun/getRun roundtrip", fetched !== null && fetched.seed === "crud-v" && created.status === "running");

// 3. prune con 12 → borra 2, quedan 10
for (let i = 1; i <= 12; i++) {
  await db.collection(COLLECTIONS.runs).insertOne({
    seed: "prune-v", runNumber: i, createdAt: now(), updatedAt: now(), closedAt: null,
    createdBy: "mongo-verify", status: "finished", monthsSimulated: 10,
    worldParams: { nationCount: 1, cityCount: 1, freeProvinceRatio: 0.1 },
    worldSummary: { nations: 1, provinces: 2, cities: 1, tiles: 100 },
    llmNations: [], gameOver: null,
  });
}
const deleted = await stores.pruneOldRuns("prune-v");
const remaining = await db.collection(COLLECTIONS.runs).countDocuments({ seed: "prune-v" });
check("prune 12→10 (borra 2)", deleted === 2 && remaining === 10);

// 4. prune con 5 → no borra
for (let i = 1; i <= 5; i++) {
  await db.collection(COLLECTIONS.runs).insertOne({
    seed: "noprune-v", runNumber: i, createdAt: now(), updatedAt: now(), closedAt: null,
    createdBy: "mongo-verify", status: "finished", monthsSimulated: 5,
    worldParams: { nationCount: 1, cityCount: 1, freeProvinceRatio: 0.1 },
    worldSummary: { nations: 1, provinces: 2, cities: 1, tiles: 100 },
    llmNations: [], gameOver: null,
  });
}
check("prune 5→5 (borra 0)", (await stores.pruneOldRuns("noprune-v")) === 0);

// 5. cascade: 11 runs, docs asociados al más viejo (run 1) y al nuevo (run 11)
const ids = [];
for (let i = 1; i <= 11; i++) {
  const r = await db.collection(COLLECTIONS.runs).insertOne({
    seed: "cascade-v", runNumber: i, createdAt: now(), updatedAt: now(), closedAt: null,
    createdBy: "mongo-verify", status: "finished", monthsSimulated: 1,
    worldParams: { nationCount: 1, cityCount: 1, freeProvinceRatio: 0.1 },
    worldSummary: { nations: 1, provinces: 1, cities: 1, tiles: 100 },
    llmNations: [], gameOver: null,
  });
  ids.push(r.insertedId.toString());
}
const ev = (runId, source, kind, topTab, subTab) => ({
  runId, seed: "cascade-v", source, eventId: `e-${source}`, simMonth: 1, simYear: 1,
  simMonthOfYear: 2, kind, topTab, subTab, title: "t", description: "d",
  nationIds: ["n1"], createdAt: now(),
});
await db.collection(COLLECTIONS.events).insertMany([
  ev(ids[0], "warSystem", "battle_fought", "guerra", "combate"),
  ev(ids[10], "market", "market", "mercado", "ofertas"),
]);
await db.collection(COLLECTIONS.nations).insertOne({
  runId: ids[0], seed: "cascade-v", nationId: "n1", name: "A", nameEs: "A", nameEn: "A",
  nameZh: "A", color: "#000", governmentFormId: "rep", capitalProvinceId: "p1",
  llm: { provider: "ollama", model: "q", endpoint: "x", enabled: true, personalityPrompt: "p" },
  createdAt: now(),
});
await db.collection(COLLECTIONS.nation_monthly).insertOne({
  runId: ids[0], seed: "cascade-v", nationId: "n1", simYear: 1, simMonthOfYear: 2, simMonth: 1,
  gold: 100, water: 50, resources: { g: 10 }, monthlyIncome: { gold: 10, water: 5 },
  provinces: ["p1"], provinceCount: 1, tileCount: 100, capitalProvinceId: "p1",
  cities: [{ id: "c1", name: "C", provinceId: "p1", level: 1, population: 100, isCapital: true }],
  population: 100, era: "Primitive", isActive: true, createdAt: now(),
});
await db.collection(COLLECTIONS.world_monthly).insertOne({
  runId: ids[0], seed: "cascade-v", simYear: 1, simMonthOfYear: 2, simMonth: 1,
  totals: { gold: 100, tilesClaimed: 100, provincesClaimed: 1, cities: 1, population: 100, nationsActive: 1 },
  byNation: [], capitals: [], cities: [], createdAt: now(),
});
const delCascade = await stores.pruneOldRuns("cascade-v");
const cRuns = await db.collection(COLLECTIONS.runs).countDocuments({ seed: "cascade-v" });
const cEvents = await db.collection(COLLECTIONS.events).countDocuments({ seed: "cascade-v" });
const cNations = await db.collection(COLLECTIONS.nations).countDocuments({ seed: "cascade-v" });
const cNm = await db.collection(COLLECTIONS.nation_monthly).countDocuments({ seed: "cascade-v" });
const cWm = await db.collection(COLLECTIONS.world_monthly).countDocuments({ seed: "cascade-v" });
check("cascade borra run viejo + docs (1/10/1/0/0/0)", delCascade === 1 && cRuns === 10 && cEvents === 1 && cNations === 0 && cNm === 0 && cWm === 0);

// 6. insertEvents + getEventStats vía stores
const rn = await stores.nextRunNumber("stats-v");
await stores.createRun({
  seed: "stats-v", runNumber: rn,
  worldParams: { nationCount: 1, cityCount: 1, freeProvinceRatio: 0.1 },
  worldSummary: { nations: 1, provinces: 1, cities: 1, tiles: 100 },
  llmNations: [], createdBy: "mongo-verify",
});
const runDoc = await stores.getRun("stats-v", rn);
await stores.insertEvents("stats-v", String(runDoc._id), [
  { runId: String(runDoc._id), seed: "stats-v", source: "warSystem", eventId: "e1", simMonth: 3, simYear: 1, simMonthOfYear: 4, kind: "battle_fought", topTab: "guerra", subTab: "combate", title: "b", description: "d", nationIds: ["n1"], createdAt: now() },
  { runId: String(runDoc._id), seed: "stats-v", source: "market", eventId: "e2", simMonth: 3, simYear: 1, simMonthOfYear: 4, kind: "market", topTab: "mercado", subTab: "ofertas", title: "m", description: "d", nationIds: [], createdAt: now() },
]);
const stats = await stores.getEventStats("stats-v", rn);
check("getEventStats {warSystem:1, market:1}", stats.warSystem === 1 && stats.market === 1);

// 7. nation_monthly + oro por mes
await stores.insertNationMonthly([
  { runId: String(runDoc._id), seed: "stats-v", nationId: "n1", simYear: 1, simMonthOfYear: 4, simMonth: 3, gold: 150, water: 60, resources: {}, monthlyIncome: { gold: 15, water: 6 }, provinces: ["p1"], provinceCount: 1, tileCount: 50, capitalProvinceId: "p1", cities: [], population: 500, era: "Classical", isActive: true, createdAt: now() },
]);
const gold = await stores.getGoldByNationMonth("stats-v", rn);
check("getGoldByNationMonth oro=150", gold.length === 1 && gold[0].gold === 150 && gold[0].simYear === 1);

// 8. world_monthly
await stores.insertWorldMonthly([
  { runId: String(runDoc._id), seed: "stats-v", simYear: 1, simMonthOfYear: 4, simMonth: 3, totals: { gold: 150, tilesClaimed: 50, provincesClaimed: 1, cities: 0, population: 500, nationsActive: 1 }, byNation: [{ nationId: "n1", gold: 150, tiles: 50, provinces: 1, cities: 0, population: 500 }], capitals: [], cities: [], createdAt: now() },
]);
const wm = await stores.getWorldMonthly("stats-v", rn);
check("getWorldMonthly totales oro=150", wm.length === 1 && wm[0].totals.gold === 150);

await raw.close();
await server.close();
console.log(`\n${fail === 0 ? "✅" : "❌"} mongo-verify: ${pass} pass, ${fail} fail\n`);
process.exit(fail === 0 ? 0 : 1);
