import type { Plugin } from "vite";
import { MongoClientSingleton } from "./mongoClient";
import { COLLECTIONS } from "./models";
import * as stores from "./stores";
import { Readable } from "stream";

const MONGO_URI = process.env.MONGO_URI ?? "mongodb://localhost:27017";

function jsonBody(req: any): Promise<any> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk: Buffer) => { body += chunk.toString(); });
    req.on("end", () => {
      try { resolve(body ? JSON.parse(body) : {}); } catch (e) { reject(e); }
    });
    req.on("error", reject);
  });
}

export function aiaMongoService(): Plugin {
  return {
    name: "aia-mongo-service",
    configureServer(server) {
      server.middlewares.use("/__aia-mongo/health", (_req, res) => {
        res.setHeader("Content-Type", "application/json");
        MongoClientSingleton.getInstance().connect().then((db) => {
          res.end(JSON.stringify({ ok: true, db: db.databaseName, collections: Object.values(COLLECTIONS) }));
        }).catch((err: any) => {
          res.statusCode = 503;
          res.end(JSON.stringify({ ok: false, error: err.message }));
        });
      });

      server.middlewares.use("/__aia-mongo/run", async (req, res) => {
        if (req.method !== "POST") { res.statusCode = 405; res.end(); return; }
        try {
          await MongoClientSingleton.getInstance().connect();
          const body = await jsonBody(req);
          const runNumber = await stores.nextRunNumber(body.seed);
          const run = await stores.createRun({
            seed: body.seed,
            runNumber,
            worldParams: body.worldParams ?? { nationCount: 6, cityCount: 12, freeProvinceRatio: 0.2 },
            worldSummary: body.worldSummary ?? { nations: 6, provinces: 0, cities: 0, tiles: 0 },
            llmNations: body.llmNations ?? [],
            createdBy: body.createdBy ?? "gui",
          });
          const runId = String((run as any)._id);
          if (Array.isArray(body.nations) && body.nations.length > 0) {
            await stores.insertNations(
              body.seed,
              runId,
              body.nations.map((d: any) => ({ ...d, runId, createdAt: d.createdAt ?? new Date().toISOString() })),
            );
          }
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ ok: true, runNumber: run.runNumber, runId }));
        } catch (e: any) {
          res.statusCode = 500;
          res.end(JSON.stringify({ ok: false, error: e.message }));
        }
      });

      server.middlewares.use("/__aia-mongo/turn", async (req, res) => {
        if (req.method !== "POST") { res.statusCode = 405; res.end(); return; }
        try {
          await MongoClientSingleton.getInstance().connect();
          const body = await jsonBody(req);
          const { seed: seedVal, runNumber: runNum, nationDocs, eventDocs, nationMonthlyDocs, worldMonthlyDocs } = body as any;
          const seed: string = seedVal ?? "";
          const runNumber: number = runNum ?? 0;

          const run = await stores.getRun(seed, runNumber);
          if (!run) {
            res.statusCode = 404;
            res.end(JSON.stringify({ ok: false, error: "Run no encontrado" }));
            return;
          }

          const runId = String(run._id);
          const stamp = (arr: any) => (Array.isArray(arr) ? arr : []).map((d: any) => ({ ...d, runId }));
          await stores.insertNations(String(seedVal), runId, stamp(nationDocs));
          await stores.insertEvents(String(seedVal), runId, stamp(eventDocs));
          await stores.insertNationMonthly(stamp(nationMonthlyDocs));
          await stores.insertWorldMonthly(stamp(worldMonthlyDocs));

          const updates: Record<string, unknown> = {};
          if (typeof body.monthsSimulated === "number") updates.monthsSimulated = body.monthsSimulated;
          if (body.status) {
            await stores.updateRunStatus(String(seedVal), runNumber, body.status, updates);
          } else if (Object.keys(updates).length > 0) {
            await stores.updateRunStatus(String(seedVal), runNumber, "running", updates);
          }

          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ ok: true }));
        } catch (e: any) {
          res.statusCode = 500;
          res.end(JSON.stringify({ ok: false, error: e.message }));
        }
      });

      server.middlewares.use("/__aia-mongo/runs", async (req, res) => {
        if (req.method !== "GET") { res.statusCode = 405; res.end(); return; }
        try {
          const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
          const seed = url.searchParams.get("seed") ?? undefined;
          const runs = await stores.getRuns(seed);
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ ok: true, runs }));
        } catch (e: any) {
          res.statusCode = 500;
          res.end(JSON.stringify({ ok: false, error: e.message }));
        }
      });

      server.middlewares.use("/__aia-mongo/stats", async (req, res) => {
        if (req.method !== "GET") { res.statusCode = 405; res.end(); return; }
        try {
          const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
          const seed = url.searchParams.get("seed") ?? undefined;
          const runNumber = parseInt(url.searchParams.get("runNumber") ?? "0");
          if (!seed || !runNumber) {
            res.statusCode = 400;
            res.end(JSON.stringify({ ok: false, error: "Se requieren seed y runNumber" }));
            return;
          }
          const stats = await stores.getEventStats(seed, runNumber);
          const goldData = await stores.getGoldByNationMonth(seed, runNumber);
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ ok: true, stats, goldData }));
        } catch (e: any) {
          res.statusCode = 500;
          res.end(JSON.stringify({ ok: false, error: e.message }));
        }
      });

      // ===== CONFIG ENDPOINTS =====
      
      // GET /__aia-mongo/config?key=construction_costs
      server.middlewares.use("/__aia-mongo/config", async (req, res) => {
        if (req.method === "GET") {
          try {
            const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
            const key = url.searchParams.get("key");
            if (!key) {
              res.statusCode = 400;
              res.end(JSON.stringify({ ok: false, error: "Falta parámetro key" }));
              return;
            }
            await MongoClientSingleton.getInstance().connect();
            const config = await stores.getConfig(key);
            if (!config) {
              res.statusCode = 404;
              res.end(JSON.stringify({ ok: false, error: "Config no encontrado", exists: false }));
              return;
            }
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ ok: true, config, exists: true }));
          } catch (e: any) {
            res.statusCode = 500;
            res.end(JSON.stringify({ ok: false, error: e.message }));
          }
          return;
        }
        
        if (req.method === "POST") {
          try {
            await MongoClientSingleton.getInstance().connect();
            const body = await jsonBody(req);
            const { key, data, updatedBy } = body;
            if (!key || !data) {
              res.statusCode = 400;
              res.end(JSON.stringify({ ok: false, error: "Faltan key o data" }));
              return;
            }
            const config = await stores.setConfig(key, data, updatedBy ?? "gui");
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ ok: true, config }));
          } catch (e: any) {
            res.statusCode = 500;
            res.end(JSON.stringify({ ok: false, error: e.message }));
          }
          return;
        }
        
        res.statusCode = 405;
        res.end();
      });

      // GET /__aia-mongo/configs - listar todos
      server.middlewares.use("/__aia-mongo/configs", async (req, res) => {
        if (req.method !== "GET") { res.statusCode = 405; res.end(); return; }
        try {
          await MongoClientSingleton.getInstance().connect();
          const configs = await stores.getAllConfigs();
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ ok: true, configs }));
        } catch (e: any) {
          res.statusCode = 500;
          res.end(JSON.stringify({ ok: false, error: e.message }));
        }
      });
    },
  };
}

export const mongoClient = MongoClientSingleton.getInstance();
