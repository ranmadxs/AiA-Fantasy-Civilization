import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { IncomingMessage } from "node:http";
import { aiaMongoService } from "./src/server/mongo/vitePlugin";

const MAX_LOG_BYTES = 10 * 1024 * 1024;

/**
 * Servicio de logs del juego: POST /__aia-log { lines: string[] } con líneas
 * ya formateadas estilo Java. Añade a target/app.log (todo) y
 * target/error.log (solo ERROR). Rota a .1 al superar 10MB.
 * Automático y sin botones: el cliente flushea solo cada turno/cada 10s.
 */
function aiaLogService(): Plugin {
  const root = process.cwd();
  const appLog = join(root, "target", "app.log");
  const errorLog = join(root, "target", "error.log");

  const rotateIfNeeded = (file: string) => {
    try {
      if (existsSync(file) && statSync(file).size > MAX_LOG_BYTES) {
        renameSync(file, `${file}.1`);
      }
    } catch {
      // No se pudo rotar: se sigue escribiendo igual.
    }
  };

  const appendLines = (file: string, lines: string[]) => {
    if (lines.length === 0) return;
    mkdirSync(join(root, "target"), { recursive: true });
    rotateIfNeeded(file);
    appendFileSync(file, `${lines.join("\n")}\n`, "utf8");
  };

  return {
    name: "aia-log-service",
    configureServer(server) {
      // Cada inicio de servidor parte con logs limpios.
      try {
        mkdirSync(join(root, "target"), { recursive: true });
        for (const file of [appLog, errorLog]) {
          writeFileSync(file, "", "utf8");
        }
      } catch {
        // Si no se pueden limpiar, se sigue igual.
      }      server.middlewares.use("/__aia-log", (req, res, next) => {
        if (req.method !== "POST") {
          res.statusCode = 405;
          res.end();
          return;
        }
        let body = "";
        req.on("data", (chunk) => {
          body += chunk;
          if (body.length > 1024 * 1024) req.destroy();
        });
        req.on("end", () => {
          try {
            const parsed = JSON.parse(body) as { lines?: unknown };
            const lines = Array.isArray(parsed.lines)
              ? parsed.lines.filter((line): line is string => typeof line === "string").slice(0, 2000)
              : [];
            appendLines(appLog, lines);
            appendLines(errorLog, lines.filter((line) => line.includes(" ERROR ")));
            res.statusCode = 204;
            res.end();
          } catch {
            res.statusCode = 400;
            res.end();
          }
        });
      });
    },
  };
}
function readJsonBody(req: IncomingMessage, maxBytes = 1024 * 1024): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > maxBytes) {
        req.destroy();
        reject(new Error("body demasiado grande"));
      }
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

/**
 * Servicio de preferencias IA: fuente de verdad en el servidor.
 * - GET /__aia-prefs?seed=X → { seed, configs } o 404 si no hay copia.
 * - POST /__aia-prefs { seed, configs } → escritura atómica a
 *   target/ai-preferences.json como Record<seed, configs> (los IDs de
 *   nación cambian por mundo, por eso la clave es el seed).
 * Sin botones extra: Guardar escribe local + servidor; la carga es en
 * background al montar/crear mundo/entrar a Configuración.
 */
function aiaPrefsService(): Plugin {
  const root = process.cwd();
  const prefsFile = join(root, "target", "ai-preferences.json");

  const readAll = (): Record<string, unknown> => {
    try {
      if (!existsSync(prefsFile)) return {};
      const parsed = JSON.parse(readFileSync(prefsFile, "utf8")) as unknown;
      return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  };

  return {
    name: "aia-prefs-service",
    configureServer(server) {
      server.middlewares.use("/__aia-prefs", async (req, res, next) => {
        try {
          if (req.method === "GET") {
            const url = new URL(req.url ?? "/", "http://localhost");
            const seed = url.searchParams.get("seed") ?? "";
            const all = readAll();
            if (!seed || !(seed in all)) {
              res.statusCode = 404;
              res.end();
              return;
            }
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ seed, configs: all[seed] }));
            return;
          }
          if (req.method === "POST") {
            const parsed = (await readJsonBody(req)) as { seed?: unknown; configs?: unknown };
            if (typeof parsed.seed !== "string" || !parsed.seed || typeof parsed.configs !== "object" || parsed.configs === null) {
              res.statusCode = 400;
              res.end();
              return;
            }
            mkdirSync(join(root, "target"), { recursive: true });
            const all = readAll();
            all[parsed.seed] = parsed.configs;
            const tmp = `${prefsFile}.tmp`;
            writeFileSync(tmp, JSON.stringify(all), "utf8");
            renameSync(tmp, prefsFile);
            res.statusCode = 204;
            res.end();
            return;
          }
          res.statusCode = 405;
          res.end();
        } catch {
          if (!res.writableEnded) {
            res.statusCode = 400;
            res.end();
          }
          next();
        }
      });
    },
  };
}
/**
 * Prueba server-side de AIA Agent: POST /__aia-agent-test { endpoint }.
 * El browser remoto no ve el localhost del host, así que el dev server hace
 * con Node: GET {base}/global/health + POST {base}/session + DELETE sesión.
 * No gasta crédito LLM (sesión vacía). Responde {ok:true,latencyMs} o
 * {ok:false,error}. Requiere reiniciar `pnpm dev` al cambiar este archivo.
 */
function aiaAgentTestService(): Plugin {
  const callAgent = async (base: string, path: string, init?: RequestInit): Promise<unknown> => {
    const response = await fetch(`${base}${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
      signal: AbortSignal.timeout(30000),
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`HTTP ${response.status} ${path}`);
    return text ? (JSON.parse(text) as unknown) : null;
  };

  return {
    name: "aia-agent-test-service",
    configureServer(server) {
      server.middlewares.use("/__aia-agent-test", async (req, res, next) => {
        if (req.method !== "POST") {
          res.statusCode = 405;
          res.end();
          return;
        }
        const started = Date.now();
        try {
          const parsed = (await readJsonBody(req)) as { endpoint?: unknown };
          if (typeof parsed.endpoint !== "string" || !parsed.endpoint.trim()) {
            res.statusCode = 400;
            res.end(JSON.stringify({ ok: false, error: "Falta endpoint." }));
            return;
          }
          let base: string;
          try {
            const url = new URL(parsed.endpoint.trim());
            if (!["http:", "https:"].includes(url.protocol)) throw new Error("protocolo");
            base = url.origin;
          } catch {
            res.statusCode = 400;
            res.end(JSON.stringify({ ok: false, error: "Endpoint inválido: usa una URL HTTP o HTTPS completa." }));
            return;
          }
          const health = (await callAgent(base, "/global/health")) as { healthy?: unknown };
          if (typeof health !== "object" || health === null || health.healthy !== true) {
            throw new Error("AIA Agent respondió pero sin health OK.");
          }
          const session = (await callAgent(base, "/session", {
            method: "POST",
            body: JSON.stringify({ title: "test-connection" }),
          })) as { id?: unknown };
          if (typeof session?.id !== "string" || !session.id) {
            throw new Error("AIA Agent no devolvió session id.");
          }
          await callAgent(base, `/session/${session.id}`, { method: "DELETE" });
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ ok: true, latencyMs: Date.now() - started }));
        } catch (error) {
          if (!res.writableEnded) {
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({
              ok: false,
              error: error instanceof Error ? error.message : "Fallo la prueba server-side.",
            }));
          }
          next();
        }
      });
    },
  };
}
/**
 * Relay server-side de turnos: POST /__aia-agent-turn
 * { endpoint, model?, providerID?, system, text, timeoutMs? }.
 * El dev server ejecuta con Node: POST {base}/session → POST mensaje →
 * DELETE sesión, y devuelve {ok:true,reply,latencyMs} o {ok:false,error}.
 * El browser remoto nunca toca las rutas del agente (solo mismo-origen Vite).
 * Requiere reiniciar `pnpm dev` al cambiar este archivo.
 */
function aiaAgentTurnService(): Plugin {
  const AGENT_TIMEOUT_MS = 180000;
  return {
    name: "aia-agent-turn-service",
    configureServer(server) {
      server.middlewares.use("/__aia-agent-turn", async (req, res, next) => {
        if (req.method !== "POST") {
          res.statusCode = 405;
          res.end();
          return;
        }
        const started = Date.now();
        const fail = (error: string) => {
          if (!res.writableEnded) {
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ ok: false, error }));
          }
        };
        let sessionId: string | null = null;
        let base = "";
        try {
          const parsed = (await readJsonBody(req, 256 * 1024)) as {
            endpoint?: unknown; model?: unknown; providerID?: unknown;
            system?: unknown; text?: unknown; timeoutMs?: unknown;
          };
          if (typeof parsed.endpoint !== "string" || !parsed.endpoint.trim()) {
            return fail("Falta endpoint.");
          }
          try {
            const url = new URL(parsed.endpoint.trim());
            if (!["http:", "https:"].includes(url.protocol)) throw new Error("protocolo");
            base = url.origin;
          } catch {
            return fail("Endpoint inválido: usa una URL HTTP o HTTPS completa.");
          }
          if (typeof parsed.text !== "string" || !parsed.text.trim()) return fail("Falta text.");
          const providerID = typeof parsed.providerID === "string" && parsed.providerID.trim()
            ? parsed.providerID.trim()
            : "openrouter";
          let modelID = typeof parsed.model === "string" && parsed.model.trim()
            ? parsed.model.trim()
            : "inclusionai/ling-3.0-flash-fin:free";
          if (modelID.startsWith(`${providerID}/`)) modelID = modelID.slice(providerID.length + 1);
          const timeoutMs = typeof parsed.timeoutMs === "number" && parsed.timeoutMs > 0
            ? Math.min(parsed.timeoutMs, AGENT_TIMEOUT_MS)
            : AGENT_TIMEOUT_MS;
          const system = typeof parsed.system === "string" ? parsed.system : "";
          const callAgent = async (path: string, init?: RequestInit): Promise<unknown> => {
            const response = await fetch(`${base}${path}`, {
              ...init,
              headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
              signal: AbortSignal.timeout(30000),
            });
            const text = await response.text();
            if (!response.ok) throw new Error(`AIA Agent HTTP ${response.status} ${path}`);
            return text ? (JSON.parse(text) as unknown) : null;
          };
          const session = (await callAgent("/session", {
            method: "POST",
            body: JSON.stringify({ title: "aia-civilization-turn" }),
          })) as { id?: unknown };
          if (typeof session?.id !== "string" || !session.id) throw new Error("AIA Agent no devolvió session id.");
          sessionId = session.id;
          const message = (await Promise.race([
            callAgent(`/session/${sessionId}/message`, {
              method: "POST",
              body: JSON.stringify({
                model: { providerID, modelID },
                system,
                parts: [{ type: "text", text: parsed.text }],
              }),
            }),
            new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout esperando al modelo (180s).")), timeoutMs)),
          ])) as { parts?: Array<{ type?: unknown; text?: unknown }> };
          const reply = (message?.parts ?? [])
            .filter((p) => p && p.type === "text" && typeof p.text === "string")
            .map((p) => p.text as string)
            .join("\n");
          if (!reply.trim()) throw new Error("Respuesta vacía de AIA Agent.");
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ ok: true, reply, latencyMs: Date.now() - started }));
        } catch (error) {
          fail(error instanceof Error ? error.message : "Fallo el relay server-side.");
        } finally {
          if (sessionId && base) {
            try {
              await fetch(`${base}/session/${sessionId}`, { method: "DELETE", signal: AbortSignal.timeout(15000) });
            } catch {
              // Limpieza best-effort, no bloquea la respuesta.
            }
          }
        }
      });
    },
  };
}
/**
 * Captura errores del proxy (upstream caído, socket colgado): una línea
 * en vez del stack de Vite + 502 JSON al browser para que el turno lo
 * reintente y siga igual. No toca ningún servicio.
 */
function captureProxyError(
  name: string,
  err: unknown,
  res: {
    headersSent?: boolean;
    writeHead?: (code: number, headers: Record<string, string>) => unknown;
    end?: (body: string) => unknown;
  },
): void {
  const cause = err instanceof Error ? err.message : String(err);
  console.error(`[proxy ${name}] upstream caído: ${cause} (el turno sigue)`);
  try {
    if (!res.headersSent) {
      res.writeHead?.(502, { "Content-Type": "application/json" });
      res.end?.(JSON.stringify({ ok: false, error: `upstream ${name} no disponible` }));
    }
  } catch {
    // Respuesta ya cerrada: nada que hacer.
  }
}
export default defineConfig({
  plugins: [react(), aiaLogService(), aiaPrefsService(), aiaAgentTestService(), aiaAgentTurnService(), aiaMongoService()],
  preview: { allowedHosts: true },
  build: { rollupOptions: { input: "./index.html" } },
  server: {
    // Dev en LAN: permite localhost, "nara" y cualquier IP local (el otro PC entra por IP).
    allowedHosts: true,
    fs: { allow: ["."] },
    watch: { ignored: ["**/target/**"] },
    // Proxy a Ollama: el navegador llama misma-origen (/ollama/...) y Vite
    // reenvía a localhost:11434. Evita CORS sin tocar OLLAMA_ORIGINS.
    // Se eliminan origin/referer porque Ollama devuelve 403 ante orígenes
    // no permitidos aunque el navegador ya haya aceptado la respuesta.
    // Requiere reiniciar `pnpm dev` al cambiar este archivo.
    proxy: {
      "/ollama": {
        target: "http://localhost:11434",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/ollama/, "") || "/",
        configure: (proxy) => {
          proxy.on("proxyReq", (proxyReq) => {
            proxyReq.removeHeader("origin");
            proxyReq.removeHeader("referer");
          });
          proxy.on("error", (err, _req, res) => {
            captureProxyError("ollama", err, res);
          });
        },
      },
      // Proxy a AIA Agent (OpenCode en el mismo host): el navegador remoto
      // llama misma-origen y Vite reenvía a localhost:4000.
      // Ruta principal /__aia-llm (misma familia /__* que /__aia-log, que los
      // browsers remotos ya alcanzan); /aia-agent queda como alias legacy.
      // Requiere reiniciar `pnpm dev` al cambiar este archivo.
      "/__aia-llm": {
        target: "http://localhost:4000",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/__aia-llm/, "") || "/",
        configure: (proxy) => {
          proxy.on("proxyReq", (proxyReq) => {
            proxyReq.removeHeader("origin");
            proxyReq.removeHeader("referer");
          });
          proxy.on("error", (err, _req, res) => {
            captureProxyError("__aia-llm", err, res);
          });
        },
      },
      "/aia-agent": {
        target: "http://localhost:4000",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/aia-agent/, "") || "/",
        configure: (proxy) => {
          proxy.on("proxyReq", (proxyReq) => {
            proxyReq.removeHeader("origin");
            proxyReq.removeHeader("referer");
          });
          proxy.on("error", (err, _req, res) => {
            captureProxyError("aia-agent", err, res);
          });
        },
      },
    },
  },
});
