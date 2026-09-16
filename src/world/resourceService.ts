import * as PIXI from "pixi.js";

type EraName = "stone" | "ancient" | "medieval" | "dark_medieval" | "modern" | "contemporary";

const BASE_PATH = "src/world/resources/capital/era";
const SHARED_PATH = "src/world/resources/capital/shared";

const AVAILABLE_ERAS: EraName[] = [
  "stone",
  "ancient",
  "medieval",
  "dark_medieval",
  "modern",
  "contemporary",
];

export class ResourceService {
  private static instance: ResourceService;
  private loadedTextures: Map<string, PIXI.Texture> = new Map();
  private cache: Map<string, string> = new Map();

  private constructor() {}

  static getInstance(): ResourceService {
    if (!ResourceService.instance) {
      ResourceService.instance = new ResourceService();
    }
    return ResourceService.instance;
  }

  async loadCapitalIcon(era: string): Promise<PIXI.Texture | null> {
    const path = this.getCapitalIconPath(era);
    if (this.loadedTextures.has(path)) {
      return this.loadedTextures.get(path)!;
    }
    try {
      const texture = await PIXI.Assets.load(path);
      this.loadedTextures.set(path, texture);
      return texture;
    } catch {
      return null;
    }
  }

  getCapitalIconPath(era: string): string {
    const key = `capital:${era}`;
    if (this.cache.has(key)) {
      return this.cache.get(key)!;
    }
    const path = `${BASE_PATH}/${era}/capital_icon.png`;
    this.cache.set(key, path);
    return path;
  }

  getSharedAssetPath(name: string): string {
    return `${SHARED_PATH}/${name}`;
  }

  getLoadedTexture(era: string): PIXI.Texture | undefined {
    return this.loadedTextures.get(this.getCapitalIconPath(era));
  }

  hasEraResources(era: string): boolean {
    return AVAILABLE_ERAS.includes(era as EraName);
  }

  getAvailableEras(): EraName[] {
    return [...AVAILABLE_ERAS];
  }

  /** Precarga los 6 iconos de era. Awaited por WorldMap antes de dibujar. */
  async preloadAll(): Promise<void> {
    await Promise.allSettled(AVAILABLE_ERAS.map((era) => this.loadCapitalIcon(era)));
  }

  invalidate(era: string): void {
    const path = this.getCapitalIconPath(era);
    this.loadedTextures.delete(path);
    this.cache.delete(`capital:${era}`);
  }

  getBasePath(): string {
    return BASE_PATH;
  }

  getSharedBasePath(): string {
    return SHARED_PATH;
  }
}
