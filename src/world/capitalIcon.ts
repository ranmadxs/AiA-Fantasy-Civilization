import { ResourceService } from "./resourceService";
import type { Nation } from "./types";

export class CapitalIconResolver {
  private static instance: CapitalIconResolver;
  private resourceService: ResourceService;

  private constructor() {
    this.resourceService = ResourceService.getInstance();
  }

  static getInstance(): CapitalIconResolver {
    if (!CapitalIconResolver.instance) {
      CapitalIconResolver.instance = new CapitalIconResolver();
    }
    return CapitalIconResolver.instance;
  }

  resolveCapitalIconPath(nation: Nation, currentEra: string): string {
    return this.resourceService.getCapitalIconPath(currentEra);
  }

  resolveNationEra(
    nationId: string,
    eraState: Record<string, { currentEra: string }>,
  ): string {
    return eraState[nationId]?.currentEra ?? "stone";
  }

  hasValidCapitalIcon(
    nationId: string,
    eraState: Record<string, { currentEra: string }>,
  ): boolean {
    const era = this.resolveNationEra(nationId, eraState);
    return this.resourceService.hasEraResources(era);
  }

  listAvailableCapitalIcons(): Array<{ era: string; path: string }> {
    return this.resourceService.getAvailableEras().map((era) => ({
      era,
      path: this.resourceService.getCapitalIconPath(era),
    }));
  }

  getCapitalSpriteOptions(
    nation: Nation | undefined,
    eraState: Record<string, { currentEra: string }>,
  ): { path: string; tint: number; era: string } | null {
    if (!nation) return null;
    const era = this.resolveNationEra(nation.id, eraState);
    if (!this.hasValidCapitalIcon(nation.id, eraState)) {
      return null;
    }
    return {
      path: this.resolveCapitalIconPath(nation, era),
      tint: nation.numericColor,
      era,
    };
  }
}
