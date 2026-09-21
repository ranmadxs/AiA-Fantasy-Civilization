import {
  AIA_AGENT_MODEL,
  AIA_AGENT_MODELS,
  DEFAULT_OLLAMA_MODEL,
  MODEL_PROVIDERS,
  aiaAgentProxyPath,
  listOllamaModels,
  ollamaOriginFromEndpoint,
  ollamaProxyPath,
  providerPresetFor,
  testAiaAgentViaServer,
  testNationModelConnection,
} from "../src/world/modelConfig";
import { createLLMExecutor, normalizeChatEndpoint } from "../src/world/llmExecutor";
import { extractAiaAgentText, stripProviderPrefix, RELAY_UNAVAILABLE, runAiaAgentTurnViaServer } from "../src/world/aiaAgentClient";
import { getModelIconPath, getModelIconForConfig } from "../src/resources/modelIcons";
import { clearBuffer, getBuffer } from "../src/world/debugLog";
import { existsSync } from "node:fs";
import { join } from "node:path";

describe("proveedores LLM (OpenAI Compatible + Ollama nara + AIA Agent)", () => {
  test("presets fijos: endpoints y clave", () => {
    expect(MODEL_PROVIDERS).toHaveLength(3);
    const openai = providerPresetFor("openai-compatible");
    expect(openai.endpoint).toBe("https://api.openai.com/v1/chat/completions");
    expect(openai.needsKey).toBe(true);
    const ollama = providerPresetFor("ollama");
    expect(ollama.endpoint).toBe("http://nara:11434/v1");
    expect(ollama.needsKey).toBe(false);
    expect(providerPresetFor("Ollama")).toBe(ollama);
    const agent = providerPresetFor("aia-agent");
    expect(agent.label).toBe("AIA Agent");
    expect(agent.endpoint).toBe("http://localhost:4000");
    expect(agent.needsKey).toBe(false);
    expect(AIA_AGENT_MODELS).toEqual([AIA_AGENT_MODEL]);
    expect(providerPresetFor("desconocido").id).toBe("openai-compatible");
    expect(DEFAULT_OLLAMA_MODEL).toBe("qwen2.5:0.5b");
  });

  test("aia-agent: proxy path, strip de provider y extracción de texto", () => {
    expect(aiaAgentProxyPath("http://localhost:4000/session")).toBe("/__aia-llm/session");
    expect(aiaAgentProxyPath("http://localhost:4000")).toBe("/__aia-llm");
    expect(aiaAgentProxyPath("http://localhost:4000/")).toBe("/__aia-llm");
    expect(aiaAgentProxyPath("no-url")).toBeUndefined();
    expect(stripProviderPrefix("openrouter", "openrouter/inclusionai/ling-3.0-flash-fin:free"))
      .toBe("inclusionai/ling-3.0-flash-fin:free");
    expect(stripProviderPrefix("openrouter", "inclusionai/ling-3.0-flash-fin:free"))
      .toBe("inclusionai/ling-3.0-flash-fin:free");
    expect(extractAiaAgentText({ parts: [{ type: "text", text: "OK" }, { type: "tool", text: "x" }] })).toBe("OK");
    expect(extractAiaAgentText(null)).toBe("");
    expect(getModelIconPath("inclusionai/ling-3.0-flash-fin:free")).toBe("/resources/models/ling-tiny.svg");
  });

  test("iconos: mapeo .svg con archivo real en public/", () => {
    const models = ["qwen2.5:0.5b", "qwen3:0.6b", "deepseek-r1", "nemotron-3-nano:4b", "inclusionai/ling-3.0-flash-fin:free", "modelo-raro-xyz"];
    for (const model of models) {
      const path = getModelIconPath(model);
      expect(path.endsWith(".svg")).toBe(true);
      const file = join(__dirname, "..", "public", path.replace(/^\//, ""));
      expect(existsSync(file)).toBe(true);
    }
    expect(getModelIconForConfig(undefined)).toBe("/resources/models/no-model.svg");
    expect(getModelIconForConfig({ model: "x", enabled: false })).toBe("/resources/models/no-model.svg");
  });

  test("normalizeChatEndpoint no duplica /chat/completions", () => {
    expect(normalizeChatEndpoint("https://api.openai.com/v1/chat/completions"))
      .toBe("https://api.openai.com/v1/chat/completions");
    expect(normalizeChatEndpoint("http://nara:11434/v1"))
      .toBe("http://nara:11434/v1/chat/completions");
    expect(normalizeChatEndpoint("http://nara:11434/v1/"))
      .toBe("http://nara:11434/v1/chat/completions");
  });

  test("ollamaOriginFromEndpoint deriva el origin", () => {
    expect(ollamaOriginFromEndpoint("http://nara:11434/v1/chat/completions"))
      .toBe("http://nara:11434");
    expect(ollamaOriginFromEndpoint("no-url")).toBeUndefined();
  });

  test("listOllamaModels parsea /api/tags y falla sin fallback", async () => {
    const realFetch = globalThis.fetch;
    const okFetch = (async () => ({
      ok: true,
      json: async () => ({ models: [{ name: "qwen2.5:0.5b" }, { name: "  " }, {}, { name: "llama3" }, { name: "qwen2.5:0.5b" }] }),
    })) as any;
    (globalThis as any).fetch = okFetch;
    try {
      await expect(listOllamaModels("http://nara:11434/v1")).resolves.toEqual(["qwen2.5:0.5b", "llama3"]);
    } finally {
      (globalThis as any).fetch = realFetch;
    }
    const failFetch = (async () => { throw new Error("down"); }) as any;
    (globalThis as any).fetch = failFetch;
    try {
      await expect(listOllamaModels("http://nara:11434/v1")).rejects.toThrow();
    } finally {
      (globalThis as any).fetch = realFetch;
    }
  });

  test("testNationModelConnection normaliza base y exige modelo instalado en Ollama", async () => {
    const realFetch = globalThis.fetch;
    const calls: string[] = [];
    (globalThis as any).fetch = (async (url: any, init?: any) => {
      calls.push(String(url));
      const target = String(url);
      if (target.endsWith("/api/tags")) {
        return { ok: true, json: async () => ({ models: [{ name: "qwen2.5:0.5b" }] }) };
      }
      return { ok: true, json: async () => ({}) };
    }) as any;
    try {
      // Base sin /chat/completions → igual funciona (normaliza).
      await expect(testNationModelConnection({
        nationId: "n1", enabled: true, providerName: "Ollama",
        endpoint: "http://nara:11434/v1", model: "qwen2.5:0.5b",
        apiKey: "", personalityPrompt: "",
      })).resolves.toBeUndefined();
      expect(calls.some((c) => c.endsWith("/v1/chat/completions"))).toBe(true);
      // Modelo ausente en /api/tags → error específico sin POST de chat.
      calls.length = 0;
      await expect(testNationModelConnection({
        nationId: "n1", enabled: true, providerName: "Ollama",
        endpoint: "http://nara:11434/v1", model: "otro:modelo",
        apiKey: "", personalityPrompt: "",
      })).rejects.toThrow(/no está instalado/);
      expect(calls.some((c) => c.endsWith("/chat/completions"))).toBe(false);
    } finally {
      (globalThis as any).fetch = realFetch;
    }
  });

  test("ollamaProxyPath reescribe a misma-origen para el proxy Vite", () => {
    expect(ollamaProxyPath("http://nara:11434/api/tags")).toBe("/ollama/api/tags");
    expect(ollamaProxyPath("http://nara:11434/v1/chat/completions")).toBe("/ollama/v1/chat/completions");
    expect(ollamaProxyPath("no-url")).toBeUndefined();
  });

  test("testNationModelConnection red caída → network_error", async () => {
    const realFetch = globalThis.fetch;
    (globalThis as any).fetch = (async () => { throw new TypeError("fetch failed"); }) as any;
    try {
      await expect(testNationModelConnection({
        nationId: "n1", enabled: true, providerName: "Ollama",
        endpoint: "http://nara:11434/v1", model: "qwen2.5:0.5b",
        apiKey: "", personalityPrompt: "",
      })).rejects.toThrow(/No se pudo obtener modelos/);
    } finally {
      (globalThis as any).fetch = realFetch;
    }
  });
  test("proxy 502: 1 reintento y luego la nación salta el turno sin tumbarlo", async () => {
    const realFetch = globalThis.fetch;
    let calls = 0;
    (globalThis as any).fetch = (async () => {
      calls += 1;
      return { ok: false, status: 502, statusText: "Bad Gateway" };
    }) as any;
    try {
      clearBuffer();
      const policies: any = { n2: { expansion: { policy: "none" } } };
      const context: any = {
        nationId: "n2",
        turnNumber: 9,
        world: {
          nations: [{ id: "n2", name: "N2" }],
          cities: [],
          provinces: [],
          nationById: new Map([["n2", { id: "n2", name: "N2" }]]),
        },
        simulation: {
          nationPolicies: policies,
          events: [],
          nationStockpiles: { n2: { gold: 100, resources: {} } },
          nationRelations: {},
        },
      };
      const configs: any = {
        n2: { enabled: true, providerName: "Ollama", endpoint: "http://nara:11434/v1", model: "qwen2.5:0.5b", apiKey: "", personalityPrompt: "x" },
      };
      await expect(createLLMExecutor(configs)(context)).resolves.toBeUndefined();
      expect(calls).toBe(2);
      expect(policies.n2.expansion.policy).toBe("none");
      expect(getBuffer().some((e) => e.tag === "llmExecutor" && e.message.includes("proxy 502 tras reintento"))).toBe(true);
    } finally {
      (globalThis as any).fetch = realFetch;
    }
  }, 15000);
  test("placeholder del modelo (targetNationId=nation_id) se sanea a undefined", async () => {
    const realFetch = globalThis.fetch;
    (globalThis as any).fetch = (async () => ({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: '{"expansion":"control_city","economy":"army_building","diplomacy":"declare_war","targetNationId":"nation_id","rationale":"brief reason"}' } }],
      }),
    })) as any;
    try {
      const policies: any = { n2: {} };
      const context: any = {
        nationId: "n2",
        turnNumber: 3,
        world: {
          nations: [{ id: "n1", name: "N1" }, { id: "n2", name: "N2" }],
          cities: [],
          provinces: [],
          nationById: new Map([["n1", { id: "n1", name: "N1" }], ["n2", { id: "n2", name: "N2" }]]),
        },
        simulation: {
          nationPolicies: policies,
          events: [],
          nationStockpiles: { n2: { gold: 100, resources: {} } },
          nationRelations: {},
        },
      };
      const configs: any = {
        n2: { enabled: true, providerName: "Ollama", endpoint: "http://nara:11434/v1", model: "deepseek-r1:8B", apiKey: "", personalityPrompt: "x" },
      };
      await createLLMExecutor(configs)(context);
      expect(policies.n2.diplomacy.policy).toBe("declare_war");
      expect(policies.n2.diplomacy.targetNationId).toBeUndefined();
      expect(policies.n2.expansion.targetNationId).toBeUndefined();
    } finally {
      (globalThis as any).fetch = realFetch;
    }
  });
  test("executor sin modelo: loguea, no lanza, políticas intactas", async () => {
    clearBuffer();
    const policies = { n1: { expansion: { policy: "none" } } };
    const context: any = {
      nationId: "n1",
      turnNumber: 7,
      world: { nations: [] },
      simulation: { nationPolicies: policies, events: [] },
    };
    const configs: any = {
      n1: { enabled: true, providerName: "Ollama", endpoint: "http://nara:11434/v1", model: "  ", apiKey: "", personalityPrompt: "" },
    };
    await expect(createLLMExecutor(configs)(context)).resolves.toBeUndefined();
    expect(policies.n1.expansion.policy).toBe("none");
    expect(getBuffer().some((e) => e.tag === "llmExecutor" && e.message.includes("sin modelo"))).toBe(true);
  });

  test("testAiaAgentViaServer: ok, rechazo y dev viejo (HTML)", async () => {
    const realFetch = globalThis.fetch;
    try {
      (globalThis as any).fetch = (async () => ({
        ok: true, text: async () => JSON.stringify({ ok: true, latencyMs: 123 }),
      })) as any;
      await expect(testAiaAgentViaServer("http://localhost:4000")).resolves.toBeGreaterThanOrEqual(0);
      (globalThis as any).fetch = (async () => ({
        ok: true, text: async () => JSON.stringify({ ok: false, error: "AIA Agent no devolvió session id." }),
      })) as any;
      await expect(testAiaAgentViaServer("http://localhost:4000")).rejects.toThrow("session id");
      (globalThis as any).fetch = (async () => ({
        ok: true, text: async () => "<!doctype html>dev viejo",
      })) as any;
      await expect(testAiaAgentViaServer("http://localhost:4000")).rejects.toThrow("reinicia pnpm dev");
    } finally {
      (globalThis as any).fetch = realFetch;
    }
  });

  test("runAiaAgentTurnViaServer: reply ok, error del relay y dev viejo", async () => {
    const realFetch = globalThis.fetch;
    const req: any = { endpoint: "http://localhost:4000", system: "s", text: "hola" };
    try {
      (globalThis as any).fetch = (async () => ({
        ok: true, text: async () => JSON.stringify({ ok: true, reply: "Hola", latencyMs: 42 }),
      })) as any;
      await expect(runAiaAgentTurnViaServer(req)).resolves.toEqual({ reply: "Hola", latencyMs: 42 });
      (globalThis as any).fetch = (async () => ({
        ok: true, text: async () => JSON.stringify({ ok: false, error: "Timeout esperando al modelo (180s)." }),
      })) as any;
      await expect(runAiaAgentTurnViaServer(req)).rejects.toThrow("Timeout");
      (globalThis as any).fetch = (async () => { throw new TypeError("fetch failed"); }) as any;
      await expect(runAiaAgentTurnViaServer(req)).rejects.toThrow(RELAY_UNAVAILABLE);
    } finally {
      (globalThis as any).fetch = realFetch;
    }
  });
});
