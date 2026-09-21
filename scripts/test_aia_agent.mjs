// Test de conexión contra aia-agent (OpenCode server, por defecto http://localhost:4000).
// Flujo API (https://opencode.ai/docs/server):
//   GET /global/health -> POST /session -> POST /session/:id/message -> DELETE /session/:id
// Log: target/logs/test_aia_agent_YYYY-MM-DD.log (vía loggerBase).
//
// Uso:
//   node scripts/test_aia_agent.mjs [--message "hola"] [--model openrouter/inclusionai/ling-3.0-flash-fin:free]
//                                    [--base http://localhost:4000] [--no-cleanup] [--timeout-ms 120000]

import { initLog, logLine } from "./loggerBase.mjs";

const DEFAULT_MODEL = "inclusionai/ling-3.0-flash-fin:free";
const DEFAULT_BASE = process.env.AIA_AGENT_BASE || "http://localhost:4000";

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    if (key === "no-cleanup") {
      out["no-cleanup"] = true;
      continue;
    }
    out[key] = argv[i + 1];
    i += 1;
  }
  return out;
}

async function api(base, path, { method = "GET", body, timeoutMs } = {}) {
  const started = Date.now();
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const latencyMs = Date.now() - started;
  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { _raw: text.slice(0, 500) };
  }
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${method} ${path}: ${text.slice(0, 300)}`);
  }
  return { data, latencyMs };
}

function extractText(messageResponse) {
  const parts = messageResponse?.parts ?? [];
  return parts
    .filter((p) => p && p.type === "text" && typeof p.text === "string")
    .map((p) => p.text)
    .join("\n");
}

const args = parseArgs(process.argv.slice(2));
const BASE = (args.base || DEFAULT_BASE).replace(/\/+$/, "");
const PROVIDER = args.provider || "openrouter";
const MODEL = args.model || DEFAULT_MODEL;
const MESSAGE = args.message || "Connection test. Reply with OK only.";
const TIMEOUT_MS = Number(args["timeout-ms"] || 180000);
const CLEANUP = !args["no-cleanup"];
// modelID sin prefijo de provider ("openrouter/x" -> "x"), el provider va aparte.
const MODEL_ID = MODEL.startsWith(`${PROVIDER}/`) ? MODEL.slice(PROVIDER.length + 1) : MODEL;

const logPath = initLog("test_aia_agent");
const log = (line) => {
  console.log(line);
  logLine(logPath, line);
};

log(`=== test_aia_agent ===`);
log(`Base: ${BASE}`);
log(`Modelo: ${PROVIDER}/${MODEL}`);
log(`Mensaje: ${MESSAGE}`);
log(`Cleanup: ${CLEANUP ? "sí (DELETE session)" : "no"}`);
log("");

let sessionId = null;
try {
  const health = await api(BASE, "/global/health", { timeoutMs: 15000 });
  log(`Health: ${JSON.stringify(health.data)} (${health.latencyMs}ms)`);

  const created = await api(BASE, "/session", {
    method: "POST",
    body: { title: "bench-aia-agent" },
    timeoutMs: 30000,
  });
  sessionId = created.data?.id;
  if (!sessionId) throw new Error("El servidor no devolvió session id.");
  log(`Session creada: ${sessionId} (${created.latencyMs}ms)`);

  const reply = await api(BASE, `/session/${sessionId}/message`, {
    method: "POST",
    body: {
      model: { providerID: PROVIDER, modelID: MODEL_ID },
      system: "You are a national strategy AI. Reply with OK only. Do not use tools.",
      parts: [{ type: "text", text: MESSAGE }],
    },
    timeoutMs: TIMEOUT_MS,
  });
  const text = extractText(reply.data);
  log(`Respuesta (${reply.latencyMs}ms):`);
  log(text || "(sin partes de texto en la respuesta)");
  log("");
  log("RESULTADO: OK — conexión y primer mensaje funcionando.");
} catch (error) {
  log(`RESULTADO: FALLO — ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  if (sessionId && CLEANUP) {
    try {
      await api(BASE, `/session/${sessionId}`, { method: "DELETE", timeoutMs: 15000 });
      log(`Session eliminada: ${sessionId}`);
    } catch (error) {
      log(`Aviso: no se pudo eliminar la session ${sessionId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  } else if (sessionId) {
    log(`Session conservada: ${sessionId}`);
  }
  log(`Log guardado: ${logPath}`);
}
