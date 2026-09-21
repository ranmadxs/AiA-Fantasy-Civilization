export function getModelIconPath(model: string): string {
  const lowered = model.toLowerCase();
  // Modelos Ling de inclusionai (p.ej. aia-agent) usan el icono ling-tiny.
  if (lowered.includes("ling")) return "/resources/models/ling-tiny.svg";
  const family = model.split(":")[0].split("/")[0].toLowerCase();
  const map: Record<string, string> = {
    "qwen2.5": "qwen2.5",
    "qwen3": "qwen3",
    "deepseek-r1": "deepseek-r1",
    "ling-tiny": "ling-tiny",
    "nemotron-3": "nemotron-3",
  };
  for (const [key, icon] of Object.entries(map)) {
    if (family.includes(key)) return `/resources/models/${icon}.svg`;
  }
  return "/resources/models/generic-ai.svg";
}

export function getModelIconForConfig(config?: { model: string; enabled: boolean }): string {
  if (!config || !config.enabled) return "/resources/models/no-model.svg";
  return getModelIconPath(config.model);
}
