import { describe, test, expect } from "@jest/globals";
import {
  RunDocumentSchema,
  NationDocumentSchema,
  EventDocumentSchema,
  NationMonthlyDocumentSchema,
  WorldMonthlyDocumentSchema,
  EventSourceSchema,
} from "../src/server/mongo/models";

// NOTA: estos tests son puros (validación zod, sin conexión a MongoDB).
// La integración contra Mongo real (CRUD, nextRunNumber, prune, cascade)
// se verifica con `node scripts/mongo-verify.mjs`, porque el driver
// mongodb@7.6.0 no completa el handshake dentro del sandbox de Jest
// ("Missing required sub-document 'driver'"), mientras que en node
// plano conecta correctamente.

const makeRun = (seed: string, runNumber: number) => ({
  seed,
  runNumber,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  closedAt: null,
  createdBy: "test",
  status: "running",
  monthsSimulated: 5,
  worldParams: { nationCount: 3, cityCount: 6, freeProvinceRatio: 0.2 },
  worldSummary: { nations: 3, provinces: 12, cities: 6, tiles: 1024 },
  llmNations: [{ nationId: "n1", provider: "ollama", model: "qwen2.5", enabled: true }],
  gameOver: null,
});

describe("models zod", () => {
  test("RunDocumentSchema valido", () => {
    expect(RunDocumentSchema.safeParse(makeRun("seed-1", 1)).success).toBe(true);
  });

  test("RunDocumentSchema rechaza campos faltantes", () => {
    expect(RunDocumentSchema.safeParse({ seed: "seed-1" }).success).toBe(false);
  });

  test("RunDocumentSchema rechaza status inválido", () => {
    expect(RunDocumentSchema.safeParse({ ...makeRun("s", 1), status: "zzz" }).success).toBe(false);
  });

  test("NationDocumentSchema valido", () => {
    expect(
      NationDocumentSchema.safeParse({
        _id: "oid",
        runId: "run-1",
        seed: "seed-1",
        nationId: "n1",
        name: "Valdoria",
        nameEs: "Valdoria",
        nameEn: "Valdoria",
        nameZh: "Valdoria",
        color: "#c03",
        governmentFormId: "monarchy",
        capitalProvinceId: "p1",
        llm: {
          provider: "ollama",
          model: "qwen2.5",
          endpoint: "http://localhost:11434",
          enabled: true,
          personalityPrompt: "p",
        },
        createdAt: new Date().toISOString(),
      }).success,
    ).toBe(true);
  });

  test("EventDocumentSchema valido", () => {
    expect(
      EventDocumentSchema.safeParse({
        _id: "oid",
        runId: "run-1",
        seed: "seed-1",
        source: "warSystem",
        eventId: "e1",
        simMonth: 5,
        simYear: 1,
        simMonthOfYear: 6,
        kind: "battle_fought",
        topTab: "guerra",
        subTab: "combate",
        title: "Battle",
        description: "D",
        nationIds: ["n1", "n2"],
        createdAt: new Date().toISOString(),
      }).success,
    ).toBe(true);
  });

  test("EventDocumentSchema rechaza source inválido", () => {
    expect(
      EventDocumentSchema.safeParse({
        seed: "s",
        source: "nope",
        eventId: "e",
        simMonth: 1,
        simYear: 1,
        simMonthOfYear: 2,
        kind: "market",
        topTab: "mercado",
        subTab: "ofertas",
        title: "t",
        description: "d",
        nationIds: [],
        createdAt: new Date().toISOString(),
      }).success,
    ).toBe(false);
  });

  test("EventSourceSchema cubre los 13 orígenes", () => {
    for (const s of [
      "militaryEconomy", "spyUpdate", "diplomacyExecution",
      "diplomacyEvaluation", "warMovement", "warSystem",
      "peacefulExpansion", "construction", "market", "hunger",
      "deserters", "domination", "init",
    ]) {
      expect(EventSourceSchema.safeParse(s).success).toBe(true);
    }
  });

  test("NationMonthlyDocumentSchema valido", () => {
    expect(
      NationMonthlyDocumentSchema.safeParse({
        _id: "oid",
        runId: "run-1",
        seed: "seed-1",
        nationId: "n1",
        simYear: 1,
        simMonthOfYear: 6,
        simMonth: 5,
        gold: 100,
        water: 50,
        resources: { grain: 30 },
        monthlyIncome: { gold: 10, water: 5 },
        provinces: ["p1"],
        provinceCount: 1,
        tileCount: 100,
        capitalProvinceId: "p1",
        cities: [{ id: "c1", name: "C", provinceId: "p1", level: 1, population: 100, isCapital: true }],
        population: 100,
        era: "Primitive",
        isActive: true,
        createdAt: new Date().toISOString(),
      }).success,
    ).toBe(true);
  });

  test("WorldMonthlyDocumentSchema valido", () => {
    expect(
      WorldMonthlyDocumentSchema.safeParse({
        _id: "oid",
        runId: "run-1",
        seed: "seed-1",
        simYear: 1,
        simMonthOfYear: 6,
        simMonth: 5,
        totals: { gold: 100, tilesClaimed: 100, provincesClaimed: 1, cities: 1, population: 100, nationsActive: 1 },
        byNation: [],
        capitals: [],
        cities: [],
        createdAt: new Date().toISOString(),
      }).success,
    ).toBe(true);
  });
});
