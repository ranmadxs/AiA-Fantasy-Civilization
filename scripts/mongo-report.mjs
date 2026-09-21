import { MongoClient } from "mongodb";
import "dotenv/config";

const MONGO_URI = process.env.MONGO_URI ?? "mongodb://localhost:27017";
const DB_NAME = process.env.MONGO_DB ?? "aia_civilization";

const args = process.argv.slice(2);
const seedArg = args.find((a) => a.startsWith("--seed="))?.split("=")[1];
const runArg = args.find((a) => a.startsWith("--run="))?.split("=")[1];

const pad = (n, w = 2) => String(n).padStart(w, "0");
const fmtDate = (iso) => (iso ?? "").replace("T", " ").slice(0, 19);

async function main() {
  const client = new MongoClient(MONGO_URI);
  await client.connect();
  const db = client.db(DB_NAME);

  const filter = seedArg ? { seed: seedArg } : {};
  const runs = await db.collection("runs").find(filter).sort({ seed: 1, runNumber: -1 }).toArray();

  if (runs.length === 0) {
    console.log("No runs encontrados.");
    await client.close();
    return;
  }

  const targetRun = runArg ? runs.find((r) => r.runNumber === parseInt(runArg)) ?? runs[0] : runs[0];
  const run = targetRun;
  const runId = String(run._id);

  // ── HEADER ──
  console.log(`\n╔══════════════════════════════════════════════════════════════════╗`);
  console.log(`║  RUN #${String(run.runNumber).padStart(4, " ")} — seed: ${(run.seed ?? "—").padEnd(30)} status: ${(run.status ?? "?").padEnd(8)}       ║`);
  console.log(`║  Creado: ${fmtDate(run.createdAt ?? "")} por ${run.createdBy ?? "—"}                                         ║`);
  console.log(`║  Meses simulados: ${String(run.monthsSimulated ?? 0).padStart(4)} · Naciones: ${run.worldSummary?.nations ?? "?"} · Provincias: ${run.worldSummary?.provinces ?? "—"}  ║`);
  console.log(`╚══════════════════════════════════════════════════════════════════╝`);

  // ── RESUMEN DE EJECUCIONES ──
  console.log(`\n📊 EJECUCIONES PARA "${run.seed}"`);
  console.log(`   ${"run#".padStart(5)}  ${"createdAt (real)".padStart(20)}  ${"status".padStart(10)}  meses  naciones`);
  const allRuns = await db.collection("runs").find({ seed: run.seed }).sort({ runNumber: -1 }).toArray();
  for (const r of allRuns) {
    const mark = r.runNumber === run.runNumber ? " ◄─ ACTIVO" : "";
    console.log(`   ${String(r.runNumber).padStart(5)}  ${fmtDate(r.createdAt ?? "").padStart(20)}  ${(r.status ?? "?").padStart(10)}  ${String(r.monthsSimulated ?? 0).padStart(4)}   ${r.worldSummary?.nations ?? "?"}${mark}`);
  }

  // ── EVENTOS POR FUENTE ──
  if (run.runNumber) {
    const stats = await db.collection("events").aggregate([
      { $match: { runId } },
      { $group: { _id: "$source", count: { $sum: 1 } } },
    ]).toArray();
    console.log(`\n📋 EVENTOS POR FUENTE (run #${run.runNumber})`);
    const totalEvents = stats.reduce((s, r) => s + r.count, 0);
    for (const r of stats) {
      console.log(`   ${r._id.padEnd(25)} ${String(r.count).padStart(4)} eventos`);
    }
    console.log(`   ${"TOTAL".padEnd(25)} ${String(totalEvents).padStart(4)} eventos`);

    // ── EVENTOS POR MES ──
    console.log(`\n📋 EVENTOS POR MES (últimos 6 meses)`);
    const monthlyEvents = await db.collection("events").aggregate([
      { $match: { runId } },
      { $group: { _id: "$simMonth", count: { $sum: 1 } } },
      { $sort: { _id: -1 } },
      { $limit: 6 },
    ]).toArray();
    for (const r of monthlyEvents) {
      const year = Math.floor(r._id / 12) + 1;
      const monthOfYear = (r._id % 12) + 1;
      console.log(`   Año ${year} Mes ${pad(monthOfYear)} (${r._id}): ${r.count} eventos`);
    }

    // ── ORO POR NACIÓN × MES ──
    const goldData = await db.collection("nation_monthly").find({ runId })
      .sort({ simMonth: 1 }).toArray();
    if (goldData.length > 0) {
      console.log(`\n💰 ORO POR NACIÓN (últimos 6 meses)`);
      const months = [...new Set(goldData.map((d) => d.simMonth))].sort((a, b) => a - b).slice(-6);
      const nationIds = [...new Set(goldData.map((d) => d.nationId))].sort();
      const byKey = new Map(goldData.map((d) => [`${d.simMonth}|${d.nationId}`, d]));
      const num = (v) => String(Math.round(v ?? 0)).padStart(10);
      console.log(`   ${"mes".padStart(8)}${nationIds.map((n) => n.padStart(10)).join("")}`);
      for (const m of months) {
        const ref = byKey.get(`${m}|${nationIds[0]}`);
        const label = `A${ref?.simYear ?? "?"}M${pad(ref?.simMonthOfYear ?? 0)}`;
        console.log(`   ${label.padStart(8)}${nationIds.map((n) => num(byKey.get(`${m}|${n}`)?.gold)).join("")}`);
      }
    }

    // ── ÚLTIMO MUNDO MENSUAL ──
    const lastWorldMonthly = await db.collection("world_monthly").find({ runId })
      .sort({ simMonth: -1 }).limit(1).toArray();
    if (lastWorldMonthly.length > 0) {
      const wm = lastWorldMonthly[0];
      const r0 = (v) => Math.round(v ?? 0).toLocaleString("en-US");
      console.log(`\n🌍 ÚLTIMO MUNDO (año ${wm.simYear}, mes ${wm.simMonthOfYear})`);
      console.log(`   Oro total: ${r0(wm.totals?.gold)} · Tiles reclamados: ${r0(wm.totals?.tilesClaimed)} · Provincias: ${r0(wm.totals?.provincesClaimed)} · Ciudades: ${r0(wm.totals?.cities)} · Pob.: ${r0(wm.totals?.population)}`);
      if (wm.capitals?.length) {
        console.log(`   Capitales: ${wm.capitals.map((c) => `${c.cityName}(${c.nationId})`).join(", ")}`);
      }
    }
  }

  // ── NACIONES DEL RUN ACTIVO ──
  const nations = await db.collection("nations").find({ runId }).sort({ nationId: 1 }).toArray();
  if (nations.length > 0) {
    console.log(`\n🏳️  NACIONES (${nations.length})`);
    for (const n of nations) {
      const llm = n.llm ? `${n.llm.provider}:${n.llm.model}` : "—";
      console.log(`   ${n.name.padEnd(15)} ${n.llm?.enabled ? "🤖" : "👤"} ${llm}`);
    }
  }

  await client.close();
  console.log("\n✅ Reporte completado.\n");
}

main().catch((e) => { console.error("Error:", e.message); process.exit(1); });
