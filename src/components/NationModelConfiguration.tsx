import { useEffect, useMemo, useState } from "react";
import {
  AIA_AGENT_MODEL,
  buildDefaultNationModelConfig,
  DEFAULT_OLLAMA_MODEL,
  fetchServerConfigs,
  listOllamaModels,
  loadNationModelConfigs,
  MODEL_PROVIDERS,
  ModelConnectionError,
  providerPresetFor,
  saveNationModelConfigs,
  saveServerConfigs,
  testNationModelConnection,
  type ModelConnectionErrorCode,
  type NationModelConfig,
  type NationModelConfigs,
} from "../world/modelConfig";
import { debug } from "../world/debugLog";
import { getLocalizedName, type Language } from "../world/localization";
import { getModelIconPath, getModelIconForConfig } from "../resources/modelIcons";
import type { World } from "../world/types";

type ConnectionState =
  | { kind: "idle" }
  | { kind: "testing" }
  | { kind: "success" }
  | { kind: "error"; code: ModelConnectionErrorCode | "unknown"; detail?: string; attemptedUrl?: string };

type NationModelConfigurationProps = {
  backLabel?: string;
  language: Language;
  onBack: () => void;
  world: World;
};

/** 渲染每个国家独立的第三方大模型与国家性格配置页面。 */
export function NationModelConfiguration({
  backLabel = "Back to World",
  language,
  onBack,
  world,
}: NationModelConfigurationProps) {
  const [configs, setConfigs] = useState<NationModelConfigs>(() => loadNationModelConfigs(world));
  const [selectedNationId, setSelectedNationId] = useState(world.nations[0]?.id ?? "");
  const [isKeyVisible, setIsKeyVisible] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [saveState, setSaveState] = useState<"idle" | "saved" | "error">("idle");
  const [connectionState, setConnectionState] = useState<ConnectionState>({ kind: "idle" });
  const [ollamaModels, setOllamaModels] = useState<string[]>([]);
  const [ollamaModelsState, setOllamaModelsState] = useState<"idle" | "loading" | "error">("idle");
  const [ollamaModelsError, setOllamaModelsError] = useState("");
  const [serverSyncState, setServerSyncState] = useState<"idle" | "synced" | "error">("idle");
  const selectedNation = useMemo(
    () => world.nationById.get(selectedNationId),
    [selectedNationId, world.nationById],
  );
  const selectedConfig = configs[selectedNationId];
  const selectedPreset = providerPresetFor(selectedConfig?.providerName ?? "");
  const isOllama = selectedPreset.id === "ollama";
  const isAiaAgent = selectedPreset.id === "aia-agent";

  const refreshOllamaModels = async (endpoint: string) => {
    setOllamaModelsState("loading");
    setOllamaModelsError("");
    try {
      const models = await listOllamaModels(endpoint);
      const withDefault = models.includes(DEFAULT_OLLAMA_MODEL)
        ? models
        : [DEFAULT_OLLAMA_MODEL, ...models];
      setOllamaModels(withDefault);
      setOllamaModelsState("idle");
    } catch (error) {
      const message = error instanceof ModelConnectionError ? error.message : "Error desconocido.";
      debug.tag("modelConfigUI").error("Ollama /api/tags falló", { endpoint, message });
      setOllamaModels([]);
      setOllamaModelsState("error");
      setOllamaModelsError(message);
    }
  };

  useEffect(() => {
    // Servidor manda: al entrar, trae la copia en background y refresca la UI.
    let cancelled = false;
    void fetchServerConfigs(world).then((serverConfigs) => {
      if (cancelled || !serverConfigs) return;
      try {
        saveNationModelConfigs(serverConfigs);
      } catch {
        // caché local llena: igual se muestra lo del servidor
      }
      setConfigs(serverConfigs);
      setServerSyncState("synced");
      setIsDirty(false);
    }).catch(() => {
      if (!cancelled) setServerSyncState("error");
    });
    return () => { cancelled = true; };
  }, [world]);

  useEffect(() => {
    if (isOllama && selectedConfig) {
      void refreshOllamaModels(selectedConfig.endpoint);
    } else {
      setOllamaModels([]);
      setOllamaModelsState("idle");
      setOllamaModelsError("");
    }
  }, [selectedNationId, selectedConfig?.providerName]);

  const updateSelectedConfig = <Key extends keyof NationModelConfig>(
    key: Key,
    value: NationModelConfig[Key],
  ) => {
    setConfigs((current) => ({
      ...current,
      [selectedNationId]: { ...current[selectedNationId], [key]: value },
    }));
    setIsDirty(true);
    setSaveState("idle");
    setConnectionState({ kind: "idle" });
  };

  const handleSelectNation = (nationId: string) => {
    setSelectedNationId(nationId);
    setIsKeyVisible(false);
    setConnectionState({ kind: "idle" });
  };

  const handleSelectProvider = (providerId: string) => {
    const preset = providerPresetFor(providerId);
    setConfigs((current) => {
      const prev = current[selectedNationId];
      const nextModel = preset.id === "ollama" && !prev.model.trim()
        ? DEFAULT_OLLAMA_MODEL
        : preset.id === "aia-agent"
          ? AIA_AGENT_MODEL
          : prev.model;
      return {
        ...current,
        [selectedNationId]: {
          ...prev,
          providerName: preset.label,
          endpoint: preset.endpoint,
          model: nextModel,
        },
      };
    });
    setIsDirty(true);
    setSaveState("idle");
    setConnectionState({ kind: "idle" });
    if (preset.id === "ollama") {
      void refreshOllamaModels(preset.endpoint);
    }
  };

  const handleSave = () => {
    try {
      saveNationModelConfigs(configs);
    } catch {
      setSaveState("error");
      return;
    }
    // Fuente de verdad en el servidor: lo local es caché.
    saveServerConfigs(world.seed, configs).then(
      () => {
        setIsDirty(false);
        setSaveState("saved");
      },
      (error) => {
        debug.tag("modelConfigUI").error("No se pudo guardar en el servidor:", error instanceof Error ? error.message : error);
        setIsDirty(false);
        setSaveState("saved");
      },
    );
  };

  const handleRestore = () => {
    if (!selectedNation) return;
    setConfigs((current) => ({
      ...current,
      [selectedNation.id]: buildDefaultNationModelConfig(selectedNation),
    }));
    setIsDirty(true);
    setSaveState("idle");
    setConnectionState({ kind: "idle" });
  };

  const handleTestConnection = async () => {
    if (!selectedConfig || connectionState.kind === "testing") return;
    setConnectionState({ kind: "testing" });
    try {
      await testNationModelConnection(selectedConfig);
      setConnectionState({ kind: "success" });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      const attemptedUrl = providerPresetFor(selectedConfig.providerName).id === "aia-agent"
        ? `${window.location.origin}/__aia-agent-test (server-side)`
        : selectedConfig.endpoint;
      debug.tag("modelConfigUI").error("Test connection falló", {
        nation: selectedNationId,
        provider: selectedConfig.providerName,
        endpoint: selectedConfig.endpoint,
        attemptedUrl,
        cause: detail,
      });
      setConnectionState({
        kind: "error",
        code: error instanceof ModelConnectionError ? error.code : "unknown",
        detail,
        attemptedUrl,
      });
    }
  };

  if (!selectedNation || !selectedConfig) {
    return (
      <div className="modelConfigEmpty">
        <h1>No Nations Available</h1>
        <button className="secondaryControl" onClick={onBack} type="button">{backLabel}</button>
      </div>
    );
  }

  return (
    <div className="modelConfigPage">
      <header className="modelConfigTopbar">
        <div>
          <p className="eyebrow">AI Civilization Sandbox</p>
          <h1>Nation AI Configuration</h1>
          <p>Configure an OpenAI-compatible model and a distinct national personality for every nation.</p>
        </div>
        <div className="modelConfigTopbarActions">
          {isDirty && <span className="unsavedBadge">Unsaved changes</span>}
          {serverSyncState === "synced" && <span className="unsavedBadge">Servidor sincronizado</span>}
          <button className="secondaryControl" onClick={onBack} type="button">{backLabel}</button>
        </div>
      </header>

      <div className="modelConfigWorkspace">
        <nav className="modelConfigNationNav" aria-label="Nations">
          <div className="modelConfigNationNavTitle">
            <span>Nations</span>
            <strong>{world.nations.length}</strong>
          </div>
          <div className="modelConfigNationList">
{world.nations.map((nation) => {
               const config = configs[nation.id];
                const iconPath = getModelIconForConfig(config);
                const hasIcon = iconPath !== "/resources/models/no-model.svg";
               return (
                 <button
                   className={selectedNationId === nation.id ? "active" : ""}
                   key={nation.id}
                   onClick={() => handleSelectNation(nation.id)}
                   type="button"
                 >
                   {hasIcon ? (
                      <img src={iconPath} alt="" className="modelIcon" width="24" height="24" onError={(event) => { event.currentTarget.src = "/resources/models/generic-ai.svg"; }} />
                   ) : (
                     <span className="nationColor" style={{ backgroundColor: nation.color }} />
                   )}
                   <span className="textWrap">
                     <strong>{getLocalizedName(nation, language)}</strong>
                     <small>{config?.enabled ? "External model enabled" : "Simulation AI"}</small>
                   </span>
                   <i className={config?.enabled ? "enabled" : ""} aria-hidden="true" />
                 </button>
               );
             })}
          </div>
        </nav>

        <section className="modelConfigEditor">
          <div className="modelConfigNationHeader">
            {getModelIconForConfig(selectedConfig) !== "/resources/models/no-model.svg" ? (
              <img src={getModelIconForConfig(selectedConfig)} alt="" className="modelIcon" width="32" height="32" onError={(event) => { event.currentTarget.src = "/resources/models/generic-ai.svg"; }} />
            ) : (
              <span style={{ backgroundColor: selectedNation.color }} />
            )}
            <div>
              <p>Selected Nation</p>
              <h2>{getLocalizedName(selectedNation, language)}</h2>
            </div>
            <label className="modelEnabledControl">
              <input
                checked={selectedConfig.enabled}
                onChange={(event) => updateSelectedConfig("enabled", event.target.checked)}
                type="checkbox"
              />
              <span>Enable External Model</span>
            </label>
          </div>

          <div className="modelConfigNotice">
            <strong>Browser-only configuration</strong>
            <p>API Keys are stored in this browser. Do not enter production credentials on a shared device.</p>
          </div>

          <div className="modelConfigForm">
            <label>
              <span>Provider</span>
              <select
                onChange={(event) => handleSelectProvider(event.target.value)}
                value={selectedPreset.id}
              >
                {MODEL_PROVIDERS.map((preset) => (
                  <option key={preset.id} value={preset.id}>{preset.label}</option>
                ))}
              </select>
              <small>{isOllama ? "Ollama no usa clave API." : isAiaAgent ? "AIA Agent corre en el mismo host (OpenCode :4000), sin clave." : "Servicio compatible con la API de OpenAI."}</small>
            </label>
            <label>
              <span>API Endpoint</span>
              <input
                onChange={(event) => updateSelectedConfig("endpoint", event.target.value)}
                placeholder="https://provider.example/v1/chat/completions"
                spellCheck={false}
                type="url"
                value={selectedConfig.endpoint}
              />
              <small>Enter the complete OpenAI-compatible Chat Completions endpoint.</small>
            </label>
            <label>
              <span>Model Name</span>
              {isAiaAgent ? (
                <>
                  <select disabled value={AIA_AGENT_MODEL}>
                    <option value={AIA_AGENT_MODEL}>{AIA_AGENT_MODEL}</option>
                  </select>
                  <small>Modelo único de AIA Agent (OpenCode :4000 con OpenRouter).</small>
                </>
              ) : isOllama ? (
                <>
                  <select
                    disabled={ollamaModelsState !== "idle" || ollamaModels.length === 0}
                    onChange={(event) => updateSelectedConfig("model", event.target.value)}
                    value={ollamaModels.includes(selectedConfig.model) ? selectedConfig.model : ""}
                  >
                    <option value="" disabled>
                      {ollamaModelsState === "loading"
                        ? "Cargando modelos de Ollama…"
                        : ollamaModels.length === 0
                          ? "Sin modelos (revisa el error)"
                          : "Elige un modelo"}
                    </option>
                    {ollamaModels.map((model) => (
                      <option key={model} value={model}>{model}</option>
                    ))}
                  </select>
                  <small>
                    <button onClick={() => void refreshOllamaModels(selectedConfig.endpoint)} type="button">
                      Actualizar modelos
                    </button>
                    {ollamaModelsState === "error" && <> — {ollamaModelsError}</>}
                  </small>
                </>
              ) : (
                <input
                  onChange={(event) => updateSelectedConfig("model", event.target.value)}
                  placeholder="Example: provider/model-name"
                  spellCheck={false}
                  type="text"
                  value={selectedConfig.model}
                />
              )}
            </label>
            {!isOllama && !isAiaAgent && (
            <label>
              <span>API Key</span>
              <div className="apiKeyInput">
                <input
                  autoComplete="off"
                  onChange={(event) => updateSelectedConfig("apiKey", event.target.value)}
                  placeholder="Optional for local services"
                  spellCheck={false}
                  type={isKeyVisible ? "text" : "password"}
                  value={selectedConfig.apiKey}
                />
                <button onClick={() => setIsKeyVisible((visible) => !visible)} type="button">
                  {isKeyVisible ? "Hide" : "Show"}
                </button>
                </div>
              </label>
            )}
            <label className="personalityField">
              <span>Nation Personality Prompt</span>
              <textarea
                onChange={(event) => updateSelectedConfig("personalityPrompt", event.target.value)}
                placeholder="Describe this nation's values, ambitions, temperament, and strategic style."
                rows={9}
                value={selectedConfig.personalityPrompt}
              />
              <small>This prompt is sent as the system message before the game's structured decision request.</small>
            </label>
          </div>

          <div className="modelConfigFooter">
            <div className="modelConfigStatus" aria-live="polite">
              {connectionState.kind === "testing" && <span>Testing connection...</span>}
              {connectionState.kind === "success" && <span className="success">✅ Connection successful.</span>}
              {connectionState.kind === "error" && (
                <span className="error">
                  🔴 {connectionErrorLabel(connectionState.code)}
                  {connectionState.detail && <><br /><small>{connectionState.detail}</small></>}
                  {connectionState.attemptedUrl && <><br /><small>URL: {connectionState.attemptedUrl}</small></>}
                </span>
              )}
              {saveState === "saved" && <span className="success">Configuration saved locally.</span>}
              {saveState === "error" && <span className="error">Unable to save configuration in this browser.</span>}
            </div>
            <div className="modelConfigActions">
              <button className="ghostControl" onClick={handleRestore} type="button">Restore Nation Defaults</button>
              <button
                className="secondaryControl"
                disabled={connectionState.kind === "testing"}
                onClick={() => void handleTestConnection()}
                type="button"
              >
                {connectionState.kind === "testing" ? "Testing..." : "Test Connection"}
              </button>
              <button className="primaryControl" onClick={handleSave} type="button">Save Configuration</button>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

function connectionErrorLabel(code: ModelConnectionErrorCode | "unknown"): string {
  const labels: Record<ModelConnectionErrorCode | "unknown", string> = {
    invalid_endpoint: "Enter a valid HTTP or HTTPS API endpoint.",
    missing_model: "Enter a model name before testing the connection.",
    model_not_found: "Model not installed on this provider (see detail below).",
    request_rejected: "The model service rejected the request. Check the model name and API Key.",
    request_timeout: "Connection timed out. Check the API endpoint and network.",
    network_error: "Unable to reach the model service. Check the endpoint, network, and CORS settings.",
    unknown: "Connection test failed unexpectedly.",
  };
  return labels[code];
}
