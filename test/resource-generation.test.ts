import { mkdirSync, copyFileSync, existsSync, readdirSync } from "fs";

jest.mock("pixi.js", () => ({
  Assets: {
    load: jest.fn(() => Promise.resolve({})),
    get: jest.fn(() => ({})),
  },
  Texture: jest.fn(),
}));

import { ResourceService } from "../src/world/resourceService";

describe("ResourceService - target/resources generation", () => {
  const TARGET_BASE = "target/resources";
  let service: ResourceService;

  beforeEach(() => {
    service = ResourceService.getInstance();
    mkdirSync(TARGET_BASE, { recursive: true });
  });

  test("genera la ruta correcta para cada era", () => {
    const eras = ["stone", "ancient", "medieval", "dark_medieval", "modern", "contemporary"];
    for (const era of eras) {
      const path = service.getCapitalIconPath(era);
      expect(path).toBe(`src/world/resources/capital/era/${era}/capital_icon.png`);
    }
  });

  test("crea recursos fisicos en target/resources/", () => {
    const eras = ["stone", "ancient", "medieval", "dark_medieval", "modern", "contemporary"];
    const outputDir = `${TARGET_BASE}/capital`;
    mkdirSync(outputDir, { recursive: true });
    for (const era of eras) {
      const src = `src/world/resources/capital/era/${era}/capital_icon.png`;
      const dest = `${outputDir}/${era}.png`;
      copyFileSync(src, dest);
      expect(existsSync(dest)).toBe(true);
    }
  });

  test("target/resources/ contiene exactamente 6 recursos generados", () => {
    const eras = ["stone", "ancient", "medieval", "dark_medieval", "modern", "contemporary"];
    const outputDir = `${TARGET_BASE}/capital`;
    mkdirSync(outputDir, { recursive: true });
    for (const era of eras) {
      const src = `src/world/resources/capital/era/${era}/capital_icon.png`;
      const dest = `${outputDir}/${era}.png`;
      copyFileSync(src, dest);
    }
    const files = readdirSync(outputDir).map((f) => f.replace(/\.png$/, "")).sort();
    expect(files).toHaveLength(6);
    expect(files).toEqual(eras.sort());
  });

  test("hasEraResources retorna true para todas las eras", () => {
    const eras = ["stone", "ancient", "medieval", "dark_medieval", "modern", "contemporary"];
    for (const era of eras) {
      expect(service.hasEraResources(era)).toBe(true);
    }
  });

  test("getAvailableEras retorna todas las eras disponibles", () => {
    const eras = service.getAvailableEras();
    expect(eras).toHaveLength(6);
    expect(eras).toContain("stone");
    expect(eras).toContain("contemporary");
  });
});
