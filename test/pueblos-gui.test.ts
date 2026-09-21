import { buildDemoWorld, countCitiesByTipo } from "../src/world/buildDemoWorld";
import { localizeText } from "../src/world/localization";

describe("pueblos vs ciudades en GUI", () => {
  test("countCitiesByTipo separa por tipo", () => {
    expect(countCitiesByTipo([
      { tipo: "pueblo" },
      { tipo: "pueblo" },
      { tipo: "ciudad" },
      {},
    ])).toEqual({ pueblos: 3, ciudades: 1 });
  });

  test("mundo inicial: todo pueblos, cero ciudades", () => {
    const world = buildDemoWorld("pueblos-001", { nationCount: 6, cityCount: 36 });
    const { pueblos, ciudades } = countCitiesByTipo(world.cities);
    expect(world.cities.length).toBe(36);
    expect(ciudades).toBe(0);
    expect(pueblos).toBe(36);
  });

  test("selector: 36 towns → 36 pueblos (es) / 城镇 (zh)", () => {
    expect(localizeText("6 nations · 36 towns · 20% free", "es")).toContain("36 pueblos");
    expect(localizeText("6 nations · 36 towns · 20% free", "zh")).toContain("36");
    expect(localizeText("Towns", "es")).toBe("Pueblos");
  });
});
