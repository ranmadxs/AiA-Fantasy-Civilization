import { MongoClientSingleton } from "./mongoClient";
import { COLLECTIONS } from "./models";
import { ObjectId, Db } from "mongodb";
import type {
  RunDocument, NationDocument, EventDocument,
  NationMonthlyDocument, WorldMonthlyDocument,
  ConfigDocument,
} from "./models";

let _dbOverride: Db | null = null;

export function setDbOverride(db: Db): void {
  _dbOverride = db;
}

function getDb(): Db {
  return _dbOverride ?? MongoClientSingleton.getInstance().getDb();
}

const MAX_RUNS_PER_SEED = 10;

function now(): string {
  return new Date().toISOString();
}

async function getCounter(seed: string) {
  const c = getDb().collection<{ _id: string; seq: number }>(COLLECTIONS.run_counters);
  let counter = await c.findOne({ _id: seed });
  if (!counter) {
    await c.insertOne({ _id: seed, seq: 0 });
    counter = { _id: seed, seq: 0 };
  }
  return counter;
}

export async function nextRunNumber(seed: string): Promise<number> {
  const c = getDb().collection<{ _id: string; seq: number }>(COLLECTIONS.run_counters);
  const result = await c.findOneAndUpdate(
    { _id: seed },
    { $inc: { seq: 1 } },
    { upsert: true, returnDocument: "after" },
  );
  return result!.seq;
}

export async function pruneOldRuns(seed: string): Promise<number> {
  const db = getDb();
  const runs = await db.collection<RunDocument>(COLLECTIONS.runs).find({ seed }).sort({ runNumber: -1 }).toArray();
  if (runs.length <= MAX_RUNS_PER_SEED) return 0;
  const toDelete = runs.slice(MAX_RUNS_PER_SEED);
  const ids = toDelete.map((r) => r._id);
  // runs._id es ObjectId; runId en hijos es string (canónico del schema)
  const idStrings = ids.map((id) => String(id));

  await db.collection<RunDocument>(COLLECTIONS.runs).deleteMany({ _id: { $in: ids } });
  await db.collection<EventDocument>(COLLECTIONS.events).deleteMany({ runId: { $in: idStrings } });
  await db.collection<NationDocument>(COLLECTIONS.nations).deleteMany({ runId: { $in: idStrings } });
  await db.collection<NationMonthlyDocument>(COLLECTIONS.nation_monthly).deleteMany({ runId: { $in: idStrings } });
  await db.collection<WorldMonthlyDocument>(COLLECTIONS.world_monthly).deleteMany({ runId: { $in: idStrings } });

  return toDelete.length;
}

export async function createRun(params: {
  seed: string;
  runNumber: number;
  worldParams: RunDocument["worldParams"];
  worldSummary: RunDocument["worldSummary"];
  llmNations: RunDocument["llmNations"];
  createdBy: string;
}): Promise<RunDocument> {
  const c = getDb().collection<RunDocument>(COLLECTIONS.runs);
  const doc: RunDocument = {
    seed: params.seed,
    runNumber: params.runNumber,
    createdAt: now(),
    updatedAt: now(),
    closedAt: null,
    createdBy: params.createdBy,
    status: "running",
    monthsSimulated: 0,
    worldParams: params.worldParams,
    worldSummary: params.worldSummary,
    llmNations: params.llmNations,
    gameOver: null,
  };
  await c.insertOne(doc);
  return doc;
}

export async function updateRunStatus(
  seed: string, runNumber: number,
  status: RunDocument["status"], updates: Partial<RunDocument>,
): Promise<void> {
  const c = getDb().collection<RunDocument>(COLLECTIONS.runs);
  const set: Record<string, unknown> = { status, updatedAt: now(), ...updates };
  if (status === "finished" || status === "gameover") {
    set.closedAt = now();
  }
  await c.updateOne({ seed, runNumber }, { $set: set });
}

export async function insertRunDocument(doc: RunDocument): Promise<void> {
  const c = getDb().collection<RunDocument>(COLLECTIONS.runs);
  await c.insertOne(doc);
}

export async function getRuns(seed?: string): Promise<RunDocument[]> {
  const c = getDb().collection<RunDocument>(COLLECTIONS.runs);
  const filter = seed ? { seed } : {};
  return c.find(filter).sort({ seed: 1, runNumber: -1 }).toArray();
}

export async function getRun(seed: string, runNumber: number): Promise<RunDocument | null> {
  const c = getDb().collection<RunDocument>(COLLECTIONS.runs);
  const doc = await c.findOne({ seed, runNumber });
  return doc ? { ...doc, _id: doc._id as string } as RunDocument : null;
}

export async function insertNations(seed: string, runId: string, docs: NationDocument[]): Promise<void> {
  if (docs.length === 0) return;
  const c = getDb().collection<NationDocument>(COLLECTIONS.nations);
  await c.insertMany(docs);
}

export async function insertEvents(seed: string, runId: string, docs: EventDocument[]): Promise<void> {
  if (docs.length === 0) return;
  const c = getDb().collection<EventDocument>(COLLECTIONS.events);
  await c.insertMany(docs);
}

export async function insertNationMonthly(docs: NationMonthlyDocument[]): Promise<void> {
  if (docs.length === 0) return;
  const c = getDb().collection<NationMonthlyDocument>(COLLECTIONS.nation_monthly);
  await c.insertMany(docs);
}

export async function insertWorldMonthly(docs: WorldMonthlyDocument[]): Promise<void> {
  if (docs.length === 0) return;
  const c = getDb().collection<WorldMonthlyDocument>(COLLECTIONS.world_monthly);
  await c.insertMany(docs);
}

export async function getNationMonthly(
  seed: string, runNumber: number, nationId: string,
): Promise<NationMonthlyDocument[]> {
  const runs = await getRun(seed, runNumber);
  if (!runs) return [];
  const c = getDb().collection<NationMonthlyDocument>(COLLECTIONS.nation_monthly);
  return c.find({ runId: String(runs._id), nationId }).sort({ simMonth: 1 }).toArray();
}

export async function getWorldMonthly(
  seed: string, runNumber: number,
): Promise<WorldMonthlyDocument[]> {
  const runs = await getRun(seed, runNumber);
  if (!runs) return [];
  const c = getDb().collection<WorldMonthlyDocument>(COLLECTIONS.world_monthly);
  return c.find({ runId: String(runs._id) }).sort({ simMonth: 1 }).toArray();
}

export async function getEventsByMonth(
  seed: string, runNumber: number, simMonth: number,
): Promise<EventDocument[]> {
  const runs = await getRun(seed, runNumber);
  if (!runs) return [];
  const c = getDb().collection<EventDocument>(COLLECTIONS.events);
  return c.find({ runId: String(runs._id), simMonth }).sort({ kind: 1 }).toArray();
}

export async function getEventStats(
  seed: string, runNumber: number,
): Promise<Record<string, number>> {
  const runs = await getRun(seed, runNumber);
  if (!runs) return {};
  const c = getDb().collection<EventDocument>(COLLECTIONS.events);
  const pipeline = [{ $match: { runId: String(runs._id) } }, { $group: { _id: "$source", count: { $sum: 1 } } }];
  const result = await c.aggregate(pipeline).toArray();
  return Object.fromEntries((result as Array<{ _id: string; count: number }>).map((r) => [r._id as string, r.count as number]));
}

export async function getGoldByNationMonth(
  seed: string, runNumber: number,
): Promise<Array<{ nationId: string; simMonth: number; gold: number; simYear: number; simMonthOfYear: number }>> {
  const runs = await getRun(seed, runNumber);
  if (!runs) return [];
  const c = getDb().collection<NationMonthlyDocument>(COLLECTIONS.nation_monthly);
  return c.find(
    { runId: String(runs._id) },
    { projection: { nationId: 1, simMonth: 1, simYear: 1, simMonthOfYear: 1, gold: 1, _id: 0 } },
  ).sort({ simMonth: 1 }).toArray();
}

export { MAX_RUNS_PER_SEED };

// ===== CONFIG STORES =====

export async function getConfig(key: string): Promise<ConfigDocument | null> {
  const db = getDb();
  const doc = await db.collection<ConfigDocument>(COLLECTIONS.configs).findOne({ key });
  return doc ? { ...doc, _id: doc._id?.toString() } as ConfigDocument : null;
}

export async function setConfig(key: string, data: Record<string, unknown>, updatedBy = "gui"): Promise<ConfigDocument> {
  const db = getDb();
  const existing = await db.collection<ConfigDocument>(COLLECTIONS.configs).findOne({ key });
  const nowStr = now();
  
  if (existing) {
    const result = await db.collection<ConfigDocument>(COLLECTIONS.configs).findOneAndUpdate(
      { key },
      { $set: { data, updatedAt: nowStr, updatedBy } },
      { returnDocument: "after" }
    );
    return result!;
  } else {
    const doc: ConfigDocument = {
      key,
      data,
      createdAt: nowStr,
      updatedAt: nowStr,
      updatedBy,
    };
    const result = await db.collection<ConfigDocument>(COLLECTIONS.configs).insertOne(doc);
    return { ...doc, _id: result.insertedId.toString() };
  }
}

export async function getAllConfigs(): Promise<ConfigDocument[]> {
  const db = getDb();
  return db.collection<ConfigDocument>(COLLECTIONS.configs).find({}).toArray();
}
