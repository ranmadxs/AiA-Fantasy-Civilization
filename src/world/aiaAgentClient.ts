import { AIA_AGENT_MODEL, AIA_AGENT_PROVIDER, aiaAgentJson } from "./modelConfig";
import { debug } from "./debugLog";

const agentLog = debug.tag("aiaAgent");

export type AiaAgentTextPart = { type: string; text?: unknown };
export type AiaAgentMessageResponse = { info?: unknown; parts?: AiaAgentTextPart[] };

/** Extrae el texto de las partes de una respuesta de mensaje (puro y testeable). */
export function extractAiaAgentText(response: AiaAgentMessageResponse | null | undefined): string {
  const parts = response?.parts ?? [];
  return parts
    .filter((p) => p && p.type === "text" && typeof p.text === "string")
    .map((p) => p.text as string)
    .join("\n");
}

/** Quita el prefijo de provider del model id ("openrouter/x" -> "x"). Puro y testeable. */
export function stripProviderPrefix(providerID: string, model: string): string {
  const trimmed = model.trim();
  return trimmed.startsWith(`${providerID}/`) ? trimmed.slice(providerID.length + 1) : trimmed;
}

export type AiaAgentTurnRequest = {
  endpoint: string;
  model?: string;
  system: string;
  text: string;
  timeoutMs?: number;
};

export type AiaAgentTurnResult = {
  reply: string;
  latencyMs: number;
  sessionId: string;
};

/**
 * Turno vía relay server-side (`POST /__aia-agent-turn` del dev): el browser
 * solo habla mismo-origen con Vite y el servidor ejecuta la sesión con Node.
 * Lanza RELAY_UNAVAILABLE si el dev no expone el servicio (dev viejo) para
 * que quien llama caiga al flujo directo.
 */
export const RELAY_UNAVAILABLE = "__AIA_RELAY_UNAVAILABLE__";

export async function runAiaAgentTurnViaServer(request: AiaAgentTurnRequest): Promise<{ reply: string; latencyMs: number }> {
  let response: Response;
  try {
    response = await fetch("/__aia-agent-turn", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        endpoint: request.endpoint,
        model: request.model,
        system: request.system,
        text: request.text,
        timeoutMs: request.timeoutMs ?? 180000,
      }),
      signal: AbortSignal.timeout((request.timeoutMs ?? 180000) + 30000),
    });
  } catch {
    throw new Error(RELAY_UNAVAILABLE);
  }
  const text = await response.text();
  let data: unknown;
  try {
    data = text ? (JSON.parse(text) as unknown) : null;
  } catch {
    throw new Error(RELAY_UNAVAILABLE);
  }
  if (!response.ok || typeof data !== "object" || data === null) {
    throw new Error(RELAY_UNAVAILABLE);
  }
  const result = data as { ok?: unknown; reply?: unknown; error?: unknown; latencyMs?: unknown };
  if (result.ok !== true || typeof result.reply !== "string") {
    throw new Error(typeof result.error === "string" && result.error ? result.error : "Relay server-side falló.");
  }
  return {
    reply: result.reply,
    latencyMs: typeof result.latencyMs === "number" ? result.latencyMs : 0,
  };
}

/**
 * Un turno contra aia-agent. En browser usa el relay server-side
 * (`/__aia-agent-turn`, camino ya probado); en Node o dev viejo usa el flujo
 * directo (crea sesión, pregunta, borra).
 */
export async function runAiaAgentTurn(request: AiaAgentTurnRequest): Promise<AiaAgentTurnResult> {
  if (typeof window !== "undefined") {
    try {
      const relay = await runAiaAgentTurnViaServer(request);
      return { reply: relay.reply, latencyMs: relay.latencyMs, sessionId: "server-relay" };
    } catch (error) {
      if (error instanceof Error && error.message !== RELAY_UNAVAILABLE) {
        // Fallo del relay/agente (caída de segundos): 1 reintento a los 3s;
        // si sigue mal, lanza y el executor contiene el fallo (el turno sigue).
        await new Promise((r) => setTimeout(r, 3000));
        const retry = await runAiaAgentTurnViaServer(request);
        return { reply: retry.reply, latencyMs: retry.latencyMs, sessionId: "server-relay" };
      }
      if (!(error instanceof Error) || error.message !== RELAY_UNAVAILABLE) throw error;
      // Dev viejo sin el relay → flujo directo legacy.
    }
  }
  const timeoutMs = request.timeoutMs ?? 180000;
  const modelID = stripProviderPrefix(AIA_AGENT_PROVIDER, request.model?.trim() || AIA_AGENT_MODEL);
  let sessionId: string | null = null;
  try {
    const { data: session } = await aiaAgentJson(request.endpoint, "/session", {
      method: "POST",
      body: { title: "aia-civilization-turn" },
      timeoutMs: 30000,
    });
    sessionId = (session as { id?: unknown })?.id as string;
    if (!sessionId) throw new Error("AIA Agent no devolvió session id.");
    const { data: message, latencyMs } = await aiaAgentJson(request.endpoint, `/session/${sessionId}/message`, {
      method: "POST",
      body: {
        model: { providerID: AIA_AGENT_PROVIDER, modelID },
        system: request.system,
        parts: [{ type: "text", text: request.text }],
      },
      timeoutMs,
    });
    const reply = extractAiaAgentText(message as AiaAgentMessageResponse);
    if (!reply.trim()) throw new Error("Respuesta vacía de AIA Agent.");
    return { reply, latencyMs, sessionId };
  } finally {
    if (sessionId) {
      try {
        await aiaAgentJson(request.endpoint, `/session/${sessionId}`, { method: "DELETE", timeoutMs: 15000 });
      } catch (error) {
        agentLog.error(`No se pudo borrar la sesión ${sessionId}:`, error instanceof Error ? error.message : error);
      }
    }
  }
}
