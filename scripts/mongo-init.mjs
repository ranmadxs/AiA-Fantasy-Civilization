import { MongoClient, ServerApiVersion } from "mongodb";
import "dotenv/config";

const MONGO_URI = process.env.MONGO_URI ?? "mongodb://localhost:27017";
const DB_NAME = process.env.MONGO_DB ?? "aia_civilization";

const INDEXES = {
  runs: [
    { key: { seed: 1, runNumber: -1 } },
    { key: { createdAt: 1 } },
  ],
  nations: [
    { key: { runId: 1, nationId: 1 }, unique: true },
    { key: { runId: 1, nationId: 1, simMonth: 1 } },
  ],
  events: [
    { key: { runId: 1, simMonth: 1 } },
    { key: { runId: 1, nationIds: 1 } },
    { key: { runId: 1, source: 1 } },
    { key: { runId: 1, simYear: 1, simMonthOfYear: 1 } },
  ],
  nation_monthly: [
    { key: { runId: 1, nationId: 1, simMonth: 1 }, unique: true },
  ],
  world_monthly: [
    { key: { runId: 1, simMonth: 1 }, unique: true },
  ],
  run_counters: [],
};

async function main() {
  const client = new MongoClient(MONGO_URI, {
    serverApi: ServerApiVersion.v1,
    maxPoolSize: 5,
    minPoolSize: 1,
    connectTimeoutMS: 10000,
    socketTimeoutMS: 30000,
  });

  try {
    await client.connect();
    console.log(`✅ Conectado a MongoDB: ${MONGO_URI}`);
    const db = client.db(DB_NAME);

    for (const [collectionName, defs] of Object.entries(INDEXES)) {
      const col = db.collection(collectionName);
      for (const def of defs) {
        const opts = Object.assign({}, def.unique !== undefined ? { unique: def.unique } : {});
        if (!def.key._id) opts.background = true;
        await col.createIndex(def.key, opts);
        const uniqueStr = def.unique ? " (único)" : "";
        console.log(`  📋 Índice en ${collectionName}: ${JSON.stringify(def.key)}${uniqueStr}`);
      }
    }

    const dbs = await db.admin().listDatabases();
    console.log(`\n✅ DB "${DB_NAME}" lista. Colecciones:`);
    for (const name of Object.keys(INDEXES)) {
      const count = await db.collection(name).countDocuments();
      console.log(`  📊 ${name}: ${count} documentos`);
    }
  } catch (error) {
    console.error("❌ Error de conexión:", error.message);
    process.exit(1);
  } finally {
    await client.close();
  }
}

main();
