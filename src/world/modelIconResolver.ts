import { Assets, Sprite, type Texture } from "pixi.js";
import { getModelIconForConfig } from "../resources/modelIcons";
import type { NationModelConfigs } from "./modelConfig";

const TEXTURE_CACHE = new Map<string, Texture>();

export async function preloadModelIcons(configs: NationModelConfigs): Promise<void> {
  const paths = new Set<string>();
  for (const config of Object.values(configs)) {
    if (!config.enabled) continue;
    const iconPath = getModelIconForConfig(config);
    if (iconPath && !TEXTURE_CACHE.has(iconPath)) {
      paths.add(iconPath);
    }
  }
  await Promise.allSettled(
    [...paths].map((path) => Assets.load(path).then((tex) => TEXTURE_CACHE.set(path, tex))),
  );
}

export function getModelTexture(model: string, enabled: boolean): Texture | null {
  if (!enabled) return null;
  const path = getModelIconForConfig({ model, enabled });
  if (!path) return null;
  return TEXTURE_CACHE.get(path) ?? null;
}

export function createNationModelSprite(
  nationId: string,
  configs: NationModelConfigs,
): Sprite | null {
  const config = configs[nationId];
  if (!config || !config.enabled) return null;
  const texture = getModelTexture(config.model, config.enabled);
  if (!texture) return null;
  const sprite = new Sprite(texture);
  sprite.scale.set(0.5);
  return sprite;
}
