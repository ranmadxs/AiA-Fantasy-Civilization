import { z } from "zod";

export const GameEventKindSchema = z.enum([
  "alliance_signed", "alliance_dissolved", "proposal_accepted", "proposal_created",
  "truce_signed", "war_declared", "vassalage_signed", "vassalage_broken",
  "battle_fought", "city_lost", "city_developed", "military_upkeep_shortage",
  "military_supply_shortage", "military_disbanded", "nation_defeated",
  "province_occupied", "army_group_created", "army_group_merged",
  "army_group_moved", "army_group_ordered", "recruitment_completed",
  "war_ended", "war_continued", "levy_called", "spy_dispatched",
  "intelligence_acquired", "relations_improved", "relations_damaged",
  "relations_sowed_discord", "peaceful_expand", "hunger", "market",
  "construction", "desertion", "currency", "era",
]);
export type GameEventKind = z.infer<typeof GameEventKindSchema>;

export const GameEventSchema = z.object({
  id: z.string(),
  month: z.number().int().min(0),
  kind: GameEventKindSchema,
  title: z.string(),
  description: z.string(),
  nationIds: z.array(z.string()),
});
export type GameEvent = z.infer<typeof GameEventSchema>;

export const EventSourceSchema = z.enum([
  "militaryEconomy", "spyUpdate", "diplomacyExecution",
  "diplomacyEvaluation", "warMovement", "warSystem",
  "peacefulExpansion", "construction", "market", "hunger",
  "deserters", "domination", "cartTrade", "init",
]);
export type EventSource = z.infer<typeof EventSourceSchema>;

export const RunParamsSchema = z.object({
  nationCount: z.number().int().min(1),
  cityCount: z.number().int().min(1),
  freeProvinceRatio: z.number().min(0).max(1),
});

export const RunSummarySchema = z.object({
  nations: z.number().int(),
  provinces: z.number().int(),
  cities: z.number().int(),
  tiles: z.number().int(),
});

export const WorldMonthlyTotalsSchema = z.object({
  gold: z.number(),
  tilesClaimed: z.number(),
  provincesClaimed: z.number(),
  cities: z.number(),
  population: z.number(),
  nationsActive: z.number(),
});

export const WorldMonthlyByNationSchema = z.object({
  nationId: z.string(),
  gold: z.number(),
  tiles: z.number(),
  provinces: z.number(),
  cities: z.number(),
  population: z.number(),
});

export const WorldMonthlyCapitalSchema = z.object({
  nationId: z.string(),
  cityId: z.string(),
  cityName: z.string(),
  provinceId: z.string(),
  level: z.number(),
  population: z.number(),
});

export const WorldMonthlyCitySchema = z.object({
  cityId: z.string(),
  name: z.string(),
  nationId: z.string(),
  provinceId: z.string(),
  level: z.number(),
  population: z.number(),
  isCapital: z.boolean(),
});

export const RunDocumentSchema = z.object({
  _id: z.string().optional(),
  seed: z.string(),
  runNumber: z.number().int().min(0),
  createdAt: z.string(),
  updatedAt: z.string(),
  closedAt: z.string().nullable(),
  createdBy: z.string(),
  status: z.enum(["running", "finished", "gameover"]),
  monthsSimulated: z.number().int(),
  worldParams: RunParamsSchema,
  worldSummary: RunSummarySchema,
  llmNations: z.array(z.object({
    nationId: z.string(),
    provider: z.string(),
    model: z.string(),
    enabled: z.boolean(),
  })),
  gameOver: z.any().nullable(),
});
export const COLLECTIONS = {
  runs: "runs",
  nations: "nations",
  events: "events",
  nation_monthly: "nation_monthly",
  world_monthly: "world_monthly",
  run_counters: "run_counters",
  configs: "configs",
} as const;

export type CollectionName = keyof typeof COLLECTIONS;

export type RunDocument = z.infer<typeof RunDocumentSchema>;

export const NationDocumentSchema = z.object({
  _id: z.string().optional(),
  runId: z.string(),
  seed: z.string(),
  nationId: z.string(),
  name: z.string(),
  nameEs: z.string(),
  nameEn: z.string(),
  nameZh: z.string(),
  color: z.string(),
  governmentFormId: z.string(),
  capitalProvinceId: z.string(),
  capitalCityId: z.string().optional(),
  llm: z.object({
    provider: z.string(),
    model: z.string(),
    endpoint: z.string(),
    enabled: z.boolean(),
    personalityPrompt: z.string(),
  }),
  createdAt: z.string(),
});
export type NationDocument = z.infer<typeof NationDocumentSchema>;

export const EventDocumentSchema = z.object({
  _id: z.string().optional(),
  runId: z.string(),
  seed: z.string(),
  source: EventSourceSchema,
  eventId: z.string(),
  simMonth: z.number().int().min(0),
  simYear: z.number().int().min(1),
  simMonthOfYear: z.number().int().min(1).max(12),
  kind: GameEventKindSchema,
  topTab: z.enum(["general", "nacion", "guerra", "mercado"]),
  subTab: z.string(),
  title: z.string(),
  description: z.string(),
  nationIds: z.array(z.string()),
  lang: z.enum(["en", "es"]).optional(),
  createdAt: z.string(),
});
export type EventDocument = z.infer<typeof EventDocumentSchema>;

export const NationMonthlyDocumentSchema = z.object({
  _id: z.string().optional(),
  runId: z.string(),
  seed: z.string(),
  nationId: z.string(),
  simYear: z.number().int().min(1),
  simMonthOfYear: z.number().int().min(1).max(12),
  simMonth: z.number().int().min(0),
  gold: z.number(),
  water: z.number(),
  resources: z.record(z.string(), z.number()),
  monthlyIncome: z.object({ gold: z.number(), water: z.number() }),
  provinces: z.array(z.string()),
  provinceCount: z.number().int(),
  tileCount: z.number().int(),
  capitalProvinceId: z.string(),
  capitalCityId: z.string().optional(),
  cities: z.array(z.object({
    id: z.string(), name: z.string(), provinceId: z.string(),
    level: z.number(), population: z.number(), isCapital: z.boolean(),
  })),
  population: z.number(),
  era: z.string(),
  isActive: z.boolean(),
  createdAt: z.string(),
});
export type NationMonthlyDocument = z.infer<typeof NationMonthlyDocumentSchema>;

export const WorldMonthlyDocumentSchema = z.object({
  _id: z.string().optional(),
  runId: z.string(),
  seed: z.string(),
  simYear: z.number().int().min(1),
  simMonthOfYear: z.number().int().min(1).max(12),
  simMonth: z.number().int().min(0),
  totals: WorldMonthlyTotalsSchema,
  byNation: z.array(WorldMonthlyByNationSchema),
  capitals: z.array(WorldMonthlyCapitalSchema),
  cities: z.array(WorldMonthlyCitySchema),
  createdAt: z.string(),
});
export type WorldMonthlyDocument = z.infer<typeof WorldMonthlyDocumentSchema>;

export const RunCounterSchema = z.object({
  _id: z.string(),
  seq: z.number().int().min(0),
});
export type RunCounterDocument = z.infer<typeof RunCounterSchema>;

export const ConfigDocumentSchema = z.object({
  _id: z.string().optional(),
  key: z.string(),
  data: z.record(z.string(), z.unknown()),
  createdAt: z.string(),
  updatedAt: z.string(),
  updatedBy: z.string().optional(),
});
export type ConfigDocument = z.infer<typeof ConfigDocumentSchema>;
