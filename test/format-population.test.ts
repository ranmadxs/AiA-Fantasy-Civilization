import { formatPopulation } from "../src/world/formatPopulation";

describe("formatPopulation (<1000 exacto, K/M con punto)", () => {
  test("menos de 1000 muestra número exacto", () => {
    expect(formatPopulation(0)).toBe("0");
    expect(formatPopulation(42)).toBe("42");
    expect(formatPopulation(120)).toBe("120");
    expect(formatPopulation(999)).toBe("999");
  });

  test("desde 1000 usa K con punto y sin espacio", () => {
    expect(formatPopulation(1000)).toBe("1.0K");
    expect(formatPopulation(1530)).toBe("1.5K");
  });

  test("millones usan M con espacio", () => {
    expect(formatPopulation(1000000)).toBe("1.0 M");
    expect(formatPopulation(2100000)).toBe("2.1 M");
  });

  test("nunca muestra 0K/OK para poblaciones pequeñas", () => {
    expect(formatPopulation(40)).not.toBe("0K");
    expect(formatPopulation(40)).toBe("40");
  });
});
