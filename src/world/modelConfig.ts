import type { Nation, World } from "./types";
import { debug } from "./debugLog";

/** 单个国家使用的第三方大模型配置。 */
export type NationModelConfig = {
  nationId: string;
  enabled: boolean;
  providerName: string;
  endpoint: string;
  model: string;
  apiKey: string;
  personalityPrompt: string;
};

/** 按国家 ID 索引的大模型配置集合。 */
export type NationModelConfigs = Record<string, NationModelConfig>;

/** 连接测试失败的稳定错误类型。 */
export type ModelConnectionErrorCode =
  | "invalid_endpoint"
  | "missing_model"
  | "model_not_found"
  | "request_rejected"
  | "request_timeout"
  | "network_error";

const STORAGE_KEY = "ai-civilization:nation-model-configs:v1";
const DEFAULT_ENDPOINT = "https://api.openai.com/v1/chat/completions";

/** Proveedores fijos del selector (sin texto libre). */
export type ModelProviderId = "openai-compatible" | "ollama" | "aia-agent";

export type ModelProviderPreset = {
  id: ModelProviderId;
  label: string;
  endpoint: string;
  needsKey: boolean;
};

export const MODEL_PROVIDERS: ModelProviderPreset[] = [
  {
    id: "openai-compatible",
    label: "OpenAI Compatible",
    endpoint: DEFAULT_ENDPOINT,
    needsKey: true,
  },
  {
    id: "ollama",
    label: "Ollama",
    endpoint: "http://nara:11434/v1",
    needsKey: false,
  },
  {
    id: "aia-agent",
    label: "AIA Agent",
    endpoint: "http://localhost:4000",
    needsKey: false,
  },
];

/** Modelo único del provider AIA Agent (OpenCode en el mismo host, vía su API de sesiones). */
export const AIA_AGENT_MODEL = "inclusionai/ling-3.0-flash-fin:free";
export const AIA_AGENT_MODELS: string[] = [AIA_AGENT_MODEL];
/** Provider OpenRouter interno que usa aia-agent para ese modelo. */
export const AIA_AGENT_PROVIDER = "openrouter";

/** Modelo Ollama por defecto (el más liviano instalado en nara). */
export const DEFAULT_OLLAMA_MODEL = "qwen2.5:0.5b";

export function providerPresetFor(providerName: string): ModelProviderPreset {
  const normalized = providerName.trim().toLowerCase();
  const found = MODEL_PROVIDERS.find(
    (preset) => preset.id === normalized || preset.label.toLowerCase() === normalized,
  );
  return found ?? MODEL_PROVIDERS[0];
}

/** Origen base para la API nativa de Ollama derivado del endpoint de chat. */
export function ollamaOriginFromEndpoint(chatEndpoint: string): string | undefined {
  try {
    return new URL(chatEndpoint).origin || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Path misma-origen vía proxy Vite ("/ollama...") para una URL absoluta de Ollama.
 * Devuelve undefined si la URL no parsea. Puro y testeable (sin window).
 */
export function ollamaProxyPath(absoluteUrl: string): string | undefined {
  try {
    const parsed = new URL(absoluteUrl);
    return `/ollama${parsed.pathname}${parsed.search}`;
  } catch {
    return undefined;
  }
}

/**
 * Fetch hacia Ollama con fallback de transporte (solo navegador):
 * 1. misma-origen vía proxy Vite (sin CORS), 2. directo al host.
 * En Node (tests/scripts) va directo.
 */
export async function fetchOllama(url: string, init?: RequestInit): Promise<Response> {
  if (typeof window !== "undefined") {
    const proxyPath = ollamaProxyPath(url);
    if (proxyPath) {
      try {
        return await fetch(`${window.location.origin}${proxyPath}`, init);
      } catch {
        // Cae al directo (por si el dev server es viejo sin proxy).
      }
    }
  }
  return fetch(url, init);
}

/**
 * Path misma-origen vía proxy Vite ("/__aia-llm...") para una URL absoluta
 * del servidor aia-agent (OpenCode en el mismo host). El navegador remoto no
 * ve el `localhost` del servidor, así que siempre va por el proxy en web.
 * Se usa /__aia-llm (no /aia-agent) porque esa familia de rutas ya demostró
 * pasar desde browsers remotos.
 */
export function aiaAgentProxyPath(absoluteUrl: string): string | undefined {
  try {
    const parsed = new URL(absoluteUrl);
    // Sin trailing slash: endpoint "http://localhost:4000" (pathname "/")
    // debe dar "/__aia-llm", no "/__aia-llm/" (evita "//global/health").
    const pathname = parsed.pathname === "/" ? "" : parsed.pathname.replace(/\/+$/, "");
    return `/__aia-llm${pathname}${parsed.search}`;
  } catch {
    return undefined;
  }
}

function aiaAgentBase(endpoint: string): string {
  const trimmed = endpoint.trim().replace(/\/+$/, "");
  if (typeof window !== "undefined") {
    const proxyPath = aiaAgentProxyPath(trimmed);
    if (proxyPath) return `${window.location.origin}${proxyPath}`;
  }
  return trimmed;
}

/**
 * Fetch hacia aia-agent (OpenCode): misma-origen vía proxy Vite en navegador,
 * directo en Node (tests/scripts corren en el host).
 */
export async function fetchAiaAgent(url: string, init?: RequestInit): Promise<Response> {
  if (typeof window !== "undefined") {
    const proxyPath = aiaAgentProxyPath(url);
    if (proxyPath) {
      try {
        return await fetch(`${window.location.origin}${proxyPath}`, init);
      } catch {
        // Cae al directo (por si el dev server es viejo sin proxy).
      }
    }
  }
  return fetch(url, init);
}

/** Llamada JSON contra aia-agent resolviendo el proxy cuando corresponde. */
export async function aiaAgentJson(
  endpoint: string,
  path: string,
  { method = "GET", body, timeoutMs = 30000 }: { method?: string; body?: unknown; timeoutMs?: number },
): Promise<{ data: unknown; latencyMs: number }> {
  const started = Date.now();
  const url = `${aiaAgentBase(endpoint)}${path}`;
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchAiaAgent(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await response.text();
    if (!response.ok) {
      throw new ModelConnectionError(
        "request_rejected",
        `AIA Agent rechazó la solicitud (HTTP ${response.status}). Revisa que el contenedor esté corriendo.`,
      );
    }
    return { data: text ? (JSON.parse(text) as unknown) : null, latencyMs: Date.now() - started };
  } catch (error) {
    if (error instanceof ModelConnectionError) throw error;
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new ModelConnectionError("request_timeout", "AIA Agent no respondió (timeout). Revisa host y red.");
    }
    throw new ModelConnectionError(
      "network_error",
      "No se puede alcanzar AIA Agent. Comprueba el endpoint y que el contenedor esté corriendo.",
    );
  } finally {
    globalThis.clearTimeout(timeout);
  }
}

/**
 * Prueba server-side contra aia-agent vía el dev server (`POST /__aia-agent-test`).
 * El browser solo habla mismo-origen con Vite (camino ya probado con /__aia-log);
 * el servidor hace health + roundtrip de sesión contra el endpoint con Node.
 * Lanza network_error si el dev no expone el servicio (dev viejo) para que
 * quien llama caiga al intento directo.
 */
export async function testAiaAgentViaServer(endpoint: string): Promise<number> {
  const started = Date.now();
  let response: Response;
  try {
    response = await fetch("/__aia-agent-test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ endpoint }),
      signal: AbortSignal.timeout(60000),
    });
  } catch {
    throw new ModelConnectionError("network_error", "El dev server no expone /__aia-agent-test (reinicia pnpm dev).");
  }
  const text = await response.text();
  let data: unknown;
  try {
    data = text ? (JSON.parse(text) as unknown) : null;
  } catch {
    throw new ModelConnectionError("network_error", "El dev server no expone /__aia-agent-test (reinicia pnpm dev).");
  }
  if (!response.ok || typeof data !== "object" || data === null) {
    throw new ModelConnectionError("network_error", "El dev server no expone /__aia-agent-test (reinicia pnpm dev).");
  }
  const result = data as { ok?: unknown; error?: unknown };
  if (result.ok !== true) {
    throw new ModelConnectionError(
      "request_rejected",
      typeof result.error === "string" && result.error ? result.error : "AIA Agent rechazó la prueba server-side.",
    );
  }
  return Date.now() - started;
}

/**
 * Lista dinámica de modelos desde el servicio Ollama (`GET {origin}/api/tags`).
 * Sin fallback: si falla, lanza y quien llama muestra el error en el log.
 */
export async function listOllamaModels(chatEndpoint: string): Promise<string[]> {
  const origin = ollamaOriginFromEndpoint(chatEndpoint);
  if (!origin) {
    throw new ModelConnectionError("invalid_endpoint", "API Endpoint inválido para Ollama.");
  }
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetchOllama(`${origin}/api/tags`, { signal: controller.signal });
    if (!response.ok) {
      throw new ModelConnectionError(
        "request_rejected",
        `Ollama rechazó la lista de modelos (HTTP ${response.status}). Revisa host y CORS (OLLAMA_ORIGINS).`,
      );
    }
    const data = (await response.json()) as { models?: Array<{ name?: string }> };
    const names = (data.models ?? [])
      .map((model) => (typeof model.name === "string" ? model.name.trim() : ""))
      .filter((name) => name.length > 0);
    return [...new Set(names)];
  } catch (error) {
    if (error instanceof ModelConnectionError) throw error;
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new ModelConnectionError("request_timeout", "Ollama no respondió a /api/tags (timeout).");
    }
    throw new ModelConnectionError(
      "network_error",
      "No se pudo obtener modelos de Ollama. Revisa host nara:11434 y CORS (OLLAMA_ORIGINS).",
    );
  } finally {
    globalThis.clearTimeout(timeout);
  }
}

export class ModelConnectionError extends Error {
  readonly code: ModelConnectionErrorCode;

  constructor(code: ModelConnectionErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ModelConnectionError";
    this.code = code;
  }
}

/** 为指定国家生成可直接编辑的默认配置。 */
export function buildDefaultNationModelConfig(nation: Nation): NationModelConfig {
  return {
    nationId: nation.id,
    enabled: false,
    providerName: "OpenAI Compatible",
    endpoint: DEFAULT_ENDPOINT,
    model: "",
    apiKey: "",
    personalityPrompt: [
      `You are the national decision maker of ${nation.nameEn}.`,
      "Act consistently with the nation's interests, history, resources, diplomatic situation, and military reality.",
      "Maintain a distinctive personality while returning decisions in the exact structured format requested by the game.",
    ].join(" "),
  };
}

/** 为当前世界建立完整的每国默认配置集合。 */
export function buildDefaultNationModelConfigs(world: World): NationModelConfigs {
  return Object.fromEntries(
    world.nations.map((nation) => [nation.id, buildDefaultNationModelConfig(nation)]),
  );
}

/** 从当前浏览器读取配置，并用默认值补齐新生成的国家和缺失字段。 */
export function loadNationModelConfigs(world: World): NationModelConfigs {
  const defaults = buildDefaultNationModelConfigs(world);
  if (typeof window === "undefined") return defaults;

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaults;
    const stored = parseStoredConfigs(JSON.parse(raw) as unknown);
    return Object.fromEntries(
      world.nations.map((nation) => {
        const fallback = defaults[nation.id];
        const saved = stored[nation.id];
        return [nation.id, saved ? { ...fallback, ...saved, nationId: nation.id } : fallback];
      }),
    );
  } catch (error) {
    debug.tag("modelConfig").error("No se pudo leer la configuración; se usan valores por defecto:", error);
    return defaults;
  }
}

/** 将每个国家的大模型配置保存到当前浏览器。 */
export function saveNationModelConfigs(configs: NationModelConfigs): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(configs));
  } catch (error) {
    debug.tag("modelConfig").error("No se pudo guardar la configuración:", error);
    throw new Error("无法将国家大模型配置保存到当前浏览器。", { cause: error });
  }
}

/**
 * 使用 OpenAI 兼容的 Chat Completions 请求测试指定配置。
 * Normaliza el endpoint (base o URL completa) y, si es Ollama, primero
 * verifica en /api/tags que el modelo esté instalado.
 * 只有调用本方法时才会向配置中的地址发送 API Key 和测试消息。
 */
export async function testNationModelConnection(config: NationModelConfig): Promise<void> {
  let endpoint: URL;
  try {
    endpoint = new URL(config.endpoint);
    if (!(["http:", "https:"].includes(endpoint.protocol))) throw new Error("protocolo no soportado");
  } catch (error) {
    throw new ModelConnectionError("invalid_endpoint", "Endpoint inválido: usa una URL HTTP o HTTPS completa.", { cause: error });
  }
  if (!config.model.trim()) {
    throw new ModelConnectionError("missing_model", "El nombre del modelo no puede estar vacío.");
  }

  const chatUrl = normalizeChatEndpointUrl(config.endpoint);
  if (providerPresetFor(config.providerName).id === "ollama") {
    const installed = await listOllamaModels(config.endpoint);
    if (!installed.includes(config.model.trim())) {
      throw new ModelConnectionError(
        "model_not_found",
        `El modelo "${config.model.trim()}" no está instalado en Ollama (ollama pull ${config.model.trim()}).`,
      );
    }
  }
  if (providerPresetFor(config.providerName).id === "aia-agent") {
    // Camino principal: prueba server-side (el browser remoto no ve el
    // localhost del host). Sin gastar crédito LLM: health + sesión vacía.
    try {
      await testAiaAgentViaServer(config.endpoint);
      return;
    } catch (error) {
      if (error instanceof ModelConnectionError && error.code !== "network_error") throw error;
      // network_error = dev viejo sin el servicio → intento directo legacy.
    }
    // Fallback directo: health + crear/borrar sesión vacía, sin gastar crédito.
    const { data: health } = await aiaAgentJson(config.endpoint, "/global/health", { timeoutMs: 15000 });
    if (typeof health !== "object" || health === null || (health as { healthy?: unknown }).healthy !== true) {
      throw new ModelConnectionError("request_rejected", "AIA Agent respondió pero sin health OK.");
    }
    const { data: session } = await aiaAgentJson(config.endpoint, "/session", {
      method: "POST",
      body: { title: "test-connection" },
      timeoutMs: 30000,
    });
    const sessionId = (session as { id?: unknown })?.id;
    if (typeof sessionId !== "string" || !sessionId) {
      throw new ModelConnectionError("request_rejected", "AIA Agent no devolvió session id.");
    }
    await aiaAgentJson(config.endpoint, `/session/${sessionId}`, { method: "DELETE", timeoutMs: 15000 });
    return;
  }

  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), 15_000);
  // Solo Ollama va por proxy misma-origen; el resto directo a su nube.
  const doFetch = providerPresetFor(config.providerName).id === "ollama" ? fetchOllama : fetch;
  try {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (config.apiKey.trim()) headers.Authorization = `Bearer ${config.apiKey.trim()}`;
    const response = await doFetch(chatUrl, {
      method: "POST",
      headers,
      signal: controller.signal,
      body: JSON.stringify({
        model: config.model.trim(),
        messages: [
          { role: "system", content: config.personalityPrompt.trim() || "You are a national strategy AI." },
          { role: "user", content: "Connection test. Reply with OK only." },
        ],
        max_tokens: 8,
        temperature: 0,
      }),
    });
    if (!response.ok) {
      throw new ModelConnectionError(
        "request_rejected",
        `El servicio de modelo rechazó la solicitud (HTTP ${response.status}).`,
      );
    }
  } catch (error) {
    if (error instanceof ModelConnectionError) throw error;
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new ModelConnectionError("request_timeout", "Conexión de prueba agotada. Revisa endpoint y red.");
    }
    throw new ModelConnectionError(
      "network_error",
      "No se puede alcanzar el servicio de modelo. Comprueba el endpoint, la red y la configuración CORS.",
    );
  } finally {
    globalThis.clearTimeout(timeout);
  }
}

/** Normaliza a URL completa de chat/completions (base o completa). */
export function normalizeChatEndpointUrl(endpoint: string): string {
  const trimmed = endpoint.trim().replace(/\/+$/, "");
  if (/\/chat\/completions$/.test(trimmed)) {
    return trimmed;
  }
  return `${trimmed}/chat/completions`;
}

const PREFS_ENDPOINT = "/__aia-prefs";

/**
 * Guarda en el servidor (fuente de verdad). Lanza si no hay servicio.
 * Se usa junto a saveNationModelConfigs (caché local).
 */
export async function saveServerConfigs(seed: string, configs: NationModelConfigs): Promise<void> {
  const response = await fetch(PREFS_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ seed, configs }),
  });
  if (!response.ok) {
    throw new Error(`Preferencias del servidor rechazadas (HTTP ${response.status})`);
  }
}

/**
 * Carga del servidor en background. El servidor manda: si hay copia,
 * se devuelve fusionada con defaults del mundo actual. Undefined si no
 * hay servicio o no hay copia (se usa lo local).
 */
export async function fetchServerConfigs(world: World): Promise<NationModelConfigs | undefined> {
  try {
    const response = await fetch(`${PREFS_ENDPOINT}?seed=${encodeURIComponent(world.seed)}`);
    if (!response.ok) {
      return undefined;
    }
    const data = (await response.json()) as { configs?: unknown };
    const stored = parseStoredConfigs(data.configs);
    if (Object.keys(stored).length === 0) {
      return undefined;
    }
    const defaults = buildDefaultNationModelConfigs(world);
    return Object.fromEntries(
      world.nations.map((nation) => {
        const fallback = defaults[nation.id];
        const saved = stored[nation.id];
        return [nation.id, saved ? { ...fallback, ...saved, nationId: nation.id } : fallback];
      }),
    );
  } catch {
    return undefined;
  }
}

function parseStoredConfigs(value: unknown): NationModelConfigs {
  if (!isRecord(value)) return {};
  const result: NationModelConfigs = {};
  for (const [nationId, candidate] of Object.entries(value)) {
    if (!isRecord(candidate)) continue;
    result[nationId] = {
      nationId,
      enabled: typeof candidate.enabled === "boolean" ? candidate.enabled : false,
      providerName: readString(candidate.providerName),
      endpoint: readString(candidate.endpoint),
      model: readString(candidate.model),
      apiKey: readString(candidate.apiKey),
      personalityPrompt: readString(candidate.personalityPrompt),
    };
  }
  return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string {
  return typeof value === "string" ? value : "";
}
