import { eraTransitionTarget, isReinoEra, nextEra } from "../src/world/era";

describe("era oscura opcional (salto por IA/LLM)", () => {
  test("advance_era sigue la cadena normal", () => {
    expect(nextEra("medieval")).toBe("dark_medieval");
    expect(eraTransitionTarget("medieval", "advance_era")).toBe("dark_medieval");
    expect(eraTransitionTarget("stone", "advance_era")).toBe("ancient");
  });

  test("skip_dark salta de medieval a modern", () => {
    expect(eraTransitionTarget("medieval", "skip_dark")).toBe("modern");
    expect(eraTransitionTarget("stone", "skip_dark")).toBeUndefined();
    expect(eraTransitionTarget("dark_medieval", "skip_dark")).toBeUndefined();
    expect(eraTransitionTarget("medieval", "stay")).toBeUndefined();
  });

  test("reino solo donde corresponde aunque se pueda saltar dark", () => {
    expect(isReinoEra("medieval")).toBe(true);
    expect(isReinoEra("dark_medieval")).toBe(true);
    expect(isReinoEra("modern")).toBe(false);
  });
});
