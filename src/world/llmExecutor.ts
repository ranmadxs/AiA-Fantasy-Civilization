import type { NationTurnContext, NationTurnExecutor } from "./turnSimulation";
import type { NationModelConfig, NationModelConfigs } from "./modelConfig";
import { fetchOllama, normalizeChatEndpointUrl, providerPresetFor } from "./modelConfig";
import { runAiaAgentTurn } from "./aiaAgentClient";
import { debug } from "./debugLog";
import { eraChangeCost, getNationEra, nextEra, checkEraRequirements } from "./era";
import { densityPerTile, habitableTilesOf } from "./density";
import { provinceHops } from "./carts";
import { isAttackableFrontier } from "./diplomacy";
import { BUILDING_LIST } from "./configDefaults";

const llmLog = debug.tag("llmExecutor");

const LLM_TIMEOUT = 120_000;
const RETRY_DELAY_MS = 2000;
const MAX_RETRIES = 3;

export type LLMProvider = "ollama" | "openrouter" | "google" | "nvidia" | "aia-agent";

const PROVIDER_BASE_URL: Record<LLMProvider, string> = {
  ollama: "http://localhost:11434/v1",
  openrouter: "https://openrouter.ai/api/v1",
  google: "https://generativelanguage.googleapis.com/v1beta/openai",
  nvidia: "https://integrate.api.nvidia.com/v1",
  "aia-agent": "http://localhost:4000",
};

export const DEFAULT_PROVIDER = "openrouter";
export const DEFAULT_MODEL = "inclusionai/ling-3.0-flash-sante:free";

export type LLMDecision = {
  expansion: string;
  economy: string;
  diplomacy: string;
  era?: string;
  targetNationId?: string;
  targetProvinceId?: string;
  targetTileId?: string;
  rationale?: string;
  cartMove?: { fromProvinceId: string; toProvinceId: string; carts: number };
  cartOffer?: { targetNationId: string; carts: number; pricePerCart: number };
  acceptCartOfferId?: string;
  traslado?: { fromCityId: string; toCityId: string; colonos: number };
  doctrina?: { ejecutarPct: number };
  muster?: Array<{ cityId: string; units: Record<string, number>; stance?: string }>;
  move?: Array<{ groupId: string; destinationProvinceId: string; stance?: string }>;
  upgrade?: { provinceId: string; kind: string };
  buildOrders?: Array<{ provinceId: string; kind: string }>;
};

const decisionMap = new Map<string, LLMDecision>();

export function getDecisionLog(): Map<string, LLMDecision> {
  return decisionMap;
}

/** Normaliza el endpoint: si ya es URL completa de chat/completions se usa tal cual. */
export const normalizeChatEndpoint = normalizeChatEndpointUrl;

function logExecutorError(nationId: string, turnNumber: number, cause: string) {
  llmLog.error(`nación ${nationId} turno ${turnNumber}: ${cause} (la nación no actúa este turno)`);
}

export function createLLMExecutor(configs: NationModelConfigs): NationTurnExecutor {
  return async function llmExecutor(context: NationTurnContext): Promise<void> {
    const config = configs[context.nationId];
    if (!config?.enabled) return;

    const model = (config.model || "").trim();
    const modelRef = model;
    if (!modelRef) {
      logExecutorError(context.nationId, context.turnNumber, "sin modelo configurado");
      return;
    }

    const baseUrl = config.endpoint || PROVIDER_BASE_URL[config.providerName as LLMProvider] || PROVIDER_BASE_URL.ollama;
    const chatUrl = normalizeChatEndpoint(baseUrl);
    const doFetch = providerPresetFor(config.providerName).id === "ollama" ? fetchOllama : fetch;

    llmLog.info("llamada:", { chatUrl, model: modelRef, provider: config.providerName });

    const prompt = buildPrompt(context, config);

    if (providerPresetFor(config.providerName).id === "aia-agent") {
      try {
        const { reply, latencyMs } = await runAiaAgentTurn({
          endpoint: config.endpoint || "http://localhost:4000",
          model: modelRef,
          system: `${config.personalityPrompt}\nRespond ONLY with valid JSON, no explanation.`,
          text: prompt,
          timeoutMs: LLM_TIMEOUT,
        });
        const decision = parseDecision(reply);
        if (!decision) {
          logExecutorError(context.nationId, context.turnNumber, "respuesta sin JSON válido");
          return;
        }
        decision.targetNationId = validateTarget(decision, context) ?? undefined;
        decision.targetProvinceId = validateTargetProvince(decision, context);
        decisionMap.set(`${context.nationId}_turn_${context.turnNumber}`, decision);
        applyDecisionToWorld(decision, context);
        llmLog.info(`turno ${context.turnNumber} ${context.nationId} (aia-agent ${latencyMs}ms): expansion=${decision.expansion}, economy=${decision.economy}, diplomacy=${decision.diplomacy}, target=${decision.targetNationId ?? "null"}, rationale="${decision.rationale ?? ""}"`);
      } catch (error) {
        const cause = error instanceof Error ? error.message : String(error);
        logExecutorError(context.nationId, context.turnNumber, cause);
      }
      return;
    }

    for (let attempt = 1, proxy502Retried = false; attempt <= MAX_RETRIES * 2; attempt += 1) {
      try {
        const forceJsonOnly = attempt > 1;
        const response = await doFetch(chatUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(config.apiKey.trim() 
              ? { "Authorization": `Bearer ${config.apiKey.trim()}` } 
              : {}),
          },
          body: JSON.stringify({
            model: modelRef,
            messages: [
              { role: "system", content: forceJsonOnly
                ? `${config.personalityPrompt}\nReturn ONLY valid JSON. No text, no reasoning, no explanation.`
                : `${config.personalityPrompt}\nRespond ONLY with valid JSON, no explanation.`
              },
              { role: "user", content: forceJsonOnly
                ? `Return ONLY this JSON format with values. Nothing else:\n{"expansion":"none","economy":"construction","diplomacy":"none","targetNationId":null,"rationale":"brief"}`
                : prompt
              },
            ],
            max_tokens: 1024,
            temperature: 0.5,
            thinking: false,
          }),
          signal: AbortSignal.timeout(LLM_TIMEOUT),
        });

        if (response.status === 429) {
          const waitMs = RETRY_DELAY_MS * attempt;
          await new Promise((r) => setTimeout(r, waitMs));
          continue;
        }
        // 502 del proxy = upstream caído: 1 reintento a los 3s.
        // Si sigue caído, salta el turno pero NUNCA cambia el modelo.
        // El siguiente turno vuelve a intentar con el mismo modelo original.
        if (response.status === 502 && !proxy502Retried) {
          proxy502Retried = true;
          llmLog.warn(`turno ${context.turnNumber} ${context.nationId}: proxy 502, reintento en 3s`);
          await new Promise((r) => setTimeout(r, 3000));
          continue;
        }
        if (response.status === 502) {
          logExecutorError(context.nationId, context.turnNumber, "proxy 502 tras reintento, salta turno (modelo sin cambiar: " + modelRef + ")");
          return;
        }
        if (!response.ok) {
          throw new Error(`LLM request failed: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();
        const content = data.choices?.[0]?.message?.content ?? "";
        const reasoning = data.choices?.[0]?.message?.reasoning ?? "";
        const fullText = reasoning + content;
        if (!fullText.trim()) throw new Error("Empty response from LLM");
        const decision = parseDecision(fullText);
        if (!decision) continue;
        decision.targetNationId = validateTarget(decision, context) ?? undefined;
        decision.targetProvinceId = validateTargetProvince(decision, context);
        decisionMap.set(`${context.nationId}_turn_${context.turnNumber}`, decision);
        applyDecisionToWorld(decision, context);
        llmLog.info(`turno ${context.turnNumber} ${context.nationId}: expansion=${decision.expansion}, economy=${decision.economy}, diplomacy=${decision.diplomacy}, era=${decision.era ?? "stay"}, target=${decision.targetNationId ?? "null"}, rationale="${decision.rationale ?? ""}"`);
        return;
      } catch (error) {
        if (attempt === MAX_RETRIES * 2) {
          const cause = error instanceof Error ? error.message : String(error);
          logExecutorError(context.nationId, context.turnNumber, cause);
          return;
        }
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS * attempt));
      }
    }
    logExecutorError(context.nationId, context.turnNumber, "sin decisión válida tras reintentos");
  };
}

function validateTarget(decision: LLMDecision, context: NationTurnContext): string | null {
  const others = context.world.nations.filter((n) => n.id !== context.nationId);
  const validIds = others.map((n) => n.id);
  if (decision.targetNationId && validIds.includes(decision.targetNationId)) {
    return decision.targetNationId;
  }
  // Sin objetivo válido: no inventar uno débil (antes forzaba al más débil
  // aunque fuera aliado). Devolver null y dejar que policyAI decida.
  return null;
}

function normalizeTargetProvince(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** Valida la provincia objetivo del LLM: debe existir, ser de un enemigo
 * en guerra con la nación y estar en la frontera. Si no, undefined y el
 * motor elige automáticamente (misma regla para IA interna y LLM). */
export function validateTargetProvince(
  decision: Pick<LLMDecision, "targetNationId" | "targetProvinceId">,
  context: Pick<NationTurnContext, "world" | "nationId" | "simulation">,
): string | undefined {
  const provinceId = normalizeTargetProvince(decision.targetProvinceId);
  if (!provinceId) return undefined;
  const province = context.world.provinceById.get(provinceId);
  if (!province || !province.nationId || province.nationId === context.nationId) return undefined;
  const wars = (context.simulation.diplomacy as { wars?: Array<{ attackerNationId: string; defenderNationId: string }> }).wars ?? [];
  const enemies = new Set<string>();
  for (const war of wars) {
    if (war.attackerNationId === context.nationId) enemies.add(war.defenderNationId);
    if (war.defenderNationId === context.nationId) enemies.add(war.attackerNationId);
  }
  if (!enemies.has(province.nationId)) return undefined;
  if (decision.targetNationId && decision.targetNationId !== province.nationId) return undefined;
  if (!isAttackableFrontier(context.world, context.nationId, provinceId)) return undefined;
  return provinceId;
}

function buildPrompt(context: NationTurnContext, config: NationModelConfig): string {
  const nation = context.world.nationById.get(context.nationId);
  const stockpile = context.simulation.nationStockpiles[context.nationId];
  const policy = context.simulation.nationPolicies[context.nationId];
  const cities = context.world.cities.filter((c) => c.nationId === context.nationId);
   const provinces = context.world.provinces.filter((p) => p.nationId === context.nationId);
   const nationPopulation = cities.reduce((s, c) => s + c.population, 0);

  const eraStates = (context.simulation as any).eraState ?? {};
  const currentEra = getNationEra(context.nationId, eraStates);
  const upcomingEra = nextEra(currentEra);
  const eraCost = upcomingEra ? eraChangeCost(upcomingEra) : 0;
  const skipInfo = currentEra === "medieval"
    ? ` Or skip_dark to jump the optional dark age straight to modern for ${eraChangeCost("modern")} gold.`
    : "";
  // Requisitos no-oro de la próxima era + aviso de la oscura (la IA decide informada).
  const simAnyEarly = context.simulation as any;
  const reqCheck = upcomingEra
    ? checkEraRequirements(upcomingEra, context.world, context.nationId, (simAnyEarly.reinos ?? []) as any[])
    : { met: true, faltan: [] as string[] };
  const reqInfo = upcomingEra && !reqCheck.met
    ? ` Missing requirements: ${reqCheck.faltan.join("; ")} (stay until met).`
    : "";
  const darkWarn = currentEra === "medieval"
    ? ` WARNING: entering the dark age crashes density 10000→500/tile (overpopulation → production falls to 10%); skipping avoids it.`
    : "";

  const enemyNations = context.world.nations
    .filter((n) => n.id !== context.nationId)
    .map((n) => {
      const nCities = context.world.cities.filter((c) => c.nationId === n.id);
      const nPop = nCities.reduce((s, c) => s + c.population, 0);
      return `${n.name} (id=${n.id}, pop=${nPop.toLocaleString()}, cities=${nCities.length}, provinces=${context.world.provinces.filter(p => p.nationId === n.id).length})`;
    })
    .join("\n    ");

  const allNationIds = context.world.nations.map((n) => `${n.id}="${n.name}"`).join(", ");

  const neutralProvinces = context.world.provinces.filter((p) => !p.nationId);
  const neutralInfo = neutralProvinces.length > 0
    ? neutralProvinces.map((p) => `${p.id} (${p.name}, ${p.tileCount} tiles)`).join(", ")
    : "none";

  const simAny = context.simulation as any;
  const myStables: Array<{ provinceId: string; carts: number }> = (simAny.aserraderos ?? [])
    .filter((a: any) => a.nationId === context.nationId && a.activa)
    .map((a: any) => ({ provinceId: a.provinceId, carts: a.carts ?? 0 }));
  const myGroups: Array<{ id: string; provinceId: string; foot: number; carts: number; stance: string; idle: boolean; total: number }> = ((simAny.military?.[context.nationId]?.armyGroups ?? []) as any[])
    .map((g: any) => {
      const units = g.units ?? {};
      const total = ["militia", "infantry", "lightCavalry", "heavyCavalry", "levy", "caballeria"]
        .reduce((s: number, t: string) => s + (units[t] ?? 0), 0);
      return {
        id: g.id,
        provinceId: g.locationProvinceId,
        foot: (units.militia ?? 0) + (units.infantry ?? 0) + (units.levy ?? 0),
        carts: g.carts ?? 0,
        stance: g.stance ?? "?",
        idle: (g.pathProvinceIds ?? []).length === 0,
        total,
      };
    });
  const cartNeedByProvince: Record<string, number> = {};
  for (const g of myGroups) {
    cartNeedByProvince[g.provinceId] = (cartNeedByProvince[g.provinceId] ?? 0) + Math.max(0, Math.ceil(g.foot / 50) - g.carts);
  }
  const cartStatus = myStables.length === 0
    ? "no lvl.3 stables (build stable upgrades first)"
    : myStables.map((s) => `${s.provinceId}: pool ${s.carts}, need ${cartNeedByProvince[s.provinceId] ?? 0}`).join("; ");
  const incomingOffers = ((simAny.cartOffers ?? []) as any[])
    .filter((o: any) => o.targetNationId === context.nationId)
    .map((o: any) => `${o.id} (from ${o.sellerNationId}: ${o.carts} carts @ ${o.pricePerCart} gold each)`)
    .join("; ") || "none";
  const groupStatus = myGroups.length === 0
    ? "none"
    : myGroups.map((g) => `${g.id} @${g.provinceId} (${g.total} troops, ${g.stance}, ${g.idle ? "idle" : "marching"})`).join("; ");
  // Movible por ciudad = guarnición − reserva (22 + 12×nivel + 32 si capital, ver war.ts).
  const garrison = ((simAny.military?.[context.nationId]?.cityGarrisons ?? {}) as Record<string, any>);
  const musterStatus = cities.map((c) => {
    const gar = garrison[c.id] ?? {};
    const total = ["militia", "infantry", "lightCavalry", "heavyCavalry", "levy", "caballeria"]
      .reduce((s: number, t: string) => s + (gar[t] ?? 0), 0);
    const reserve = 22 + (c.level ?? 1) * 12 + (c.isCapital ? 32 : 0);
    return `${c.id} (${c.name}: movable ${Math.max(0, total - reserve)}/${total})`;
  }).join("; ");

  // Sobrepoblación por ciudad: quedarse sobre el tope baja la producción
  // (piso 10%). La IA decide si trasladar ponderando estos números.
  const cityRows = cities.map((c) => {
    const cap = habitableTilesOf(c.provinceId, context.world) * densityPerTile(currentEra);
    const ratio = cap > 0 ? c.population / cap : 0;
    const prod = Math.max(10, Math.round((1 - Math.max(0, ratio - 1)) * 100));
    return { c, cap, ratio, prod };
  });
  const cityStatus = cityRows
    .map((r) => `${r.c.id} (${r.c.name}: ${r.c.population}/${r.cap} hab, prod ${r.prod}%)`)
    .join("; ");
  const overRows = cityRows.filter((r) => r.ratio > 1.1).sort((a, b) => b.ratio - a.ratio).slice(0, 3);
  const moveOptions = overRows.length === 0 ? "none overpopulated" : overRows.map((r) => {
    const dests = cityRows
      .filter((d) => d.c.id !== r.c.id && d.c.population < d.cap)
      .map((d) => ({ d, hops: provinceHops(context.world, r.c.provinceId, d.c.provinceId) }))
      .filter((x) => Number.isFinite(x.hops))
      .sort((a, b) => a.hops - b.hops || (b.d.cap - b.d.c.population) - (a.d.cap - a.d.c.population))
      .slice(0, 2)
      .map((x) => `${x.d.c.id} (${x.hops} tramos, ${x.hops} oro)`)
      .join(" or ");
    return `${r.c.id} → ${dests || "no room"}`;
  }).join("; ");

  // Provincias enemigas atacables (de otro dueño, adyacentes a territorio propio).
  const attackableProvinces: Array<{ id: string; name: string; owner: string }> = [];
  if (context.world.tiles) {
    const ownTileCoords = new Set(
      context.world.tiles
        .filter((t) => {
          const p = t.provinceId ? context.world.provinceById.get(t.provinceId) : undefined;
          return p?.nationId === context.nationId;
        })
        .map((t) => `${t.x},${t.y}`),
    );
    const seenAttackable = new Set<string>();
    for (const tile of context.world.tiles) {
      const prov = tile.provinceId ? context.world.provinceById.get(tile.provinceId) : undefined;
      if (!prov || !prov.nationId || prov.nationId === context.nationId || seenAttackable.has(prov.id)) continue;
      const bordersOwn = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) =>
        ownTileCoords.has(`${tile.x + dx},${tile.y + dy}`),
      );
      if (!bordersOwn) continue;
      seenAttackable.add(prov.id);
      attackableProvinces.push({ id: prov.id, name: prov.nameEs ?? prov.name ?? prov.id, owner: prov.nationId });
    }
  }
  return [
    `You are the national decision maker of ${nation?.name ?? context.nationId} (id=${context.nationId}).`,
    `Turn: ${context.turnNumber}`,
    `Your status: Population=${nationPopulation.toLocaleString()} | Cities=${cities.length} | Provinces=${provinces.length} | Gold=${Math.round(stockpile?.gold ?? 0)} | Era=${currentEra}${upcomingEra ? ` (next: ${upcomingEra} for ${eraCost} gold)` : " (máxima)"}${reqInfo}`,
    ``,
    `Neutral territories available (${neutralProvinces.length} total): ${neutralInfo}`,
    `Peaceful expansion (peaceful_expand) costs only 1 gold per new city and never starts wars.`,
    ``,
    `All nation IDs: ${allNationIds}`,
    ``,
    `Other nations:` + (enemyNations ? "\n    " + enemyNations : " none"),
    ``,
    `DECISION GUIDE — what each option does:`,
    ``,
    `  **PRIORITY RULE: If you have gold >= 1 and neutral provinces are available, choose peaceful_expand first. This is the safest way to grow.**`,
    ``,
    `  expansion:"peaceful_expand": Colonize NEUTRAL territory by paying 1 gold. No target needed, never steals enemy land, never starts war. Choose this if you have gold and neutral tiles are nearby.`,
    `  expansion:"control_city" + targetNationId: ATTACK that nation and CAPTURE one of its cities. You steal the city, its population, and its resources. Use this only when at war or when no neutral territory is available.`,
    `  expansion:"control_resource" + targetNationId: Seize resource tiles from that nation. Only when at war.`,
    `  expansion:"decisive_battle" + targetNationId: Launch a full-scale invasion. Only when at war.`,
    `  expansion:"none": Do not expand militarily this turn.`,
    ``,
    `  economy:"army_building": Build military units (needed before attacking).`,
    `  economy:"construction": Build infrastructure to grow population and economy. Add "constructionIntent": pueblo (new pueblo needs origin>=100 pop) | ciudad (upgrade, medieval+) | reino (vassal 👑, medieval/dark only, needs 10 nation cities + 2 in province, 1/province) | auto. Up to 3 projects per nation per turn if funds allow.`,
    `  "upgrade":{"provinceId":"...","kind":"stable"}: upgrade a stable (lvl1→2 needs lvl2 city + 3 tiles; lvl2→3 needs lvl3 city + 5 tiles, unlocks carts). "buildOrders":[{"provinceId":"...","kind":"granja"}]: explicit constructions, validated (own province, era-unlocked, funds). Invalid ones are rejected with a reason; the chain fills remaining slots.`,
    `  economy:"recovery": Conserve resources to recover population and stability.`,
    ``,
    `  Carts (optional, decide by need): your stables lvl.3 build carts (50 foot each, fast). "cartMove":{"fromProvinceId","toProvinceId","carts"} moves carts between YOUR provinces (1 gold each). "cartOffer":{"targetNationId","carts","pricePerCart"} sells to another nation: YOU set pricePerCart (must be >= 2 gold, always above the 1-gold cost, higher if you need gold). "acceptCartOfferId":"offer-id" accepts an incoming offer (pay on arrival). Omit or null when no trade needed.`,
    `  Your carts: ${cartStatus}`,
    `  Incoming cart offers: ${incomingOffers}`,
    ``,
    `  Overpopulation is per city: staying above cap cuts production (floor 10%). Moving costs 1 gold per tramo + losses (0-10% + 2%/tramo, cap 25%). "traslado":{"fromCityId","toCityId","colonos"} moves people between YOUR cities. Omit or null.`,
    `  Your cities: ${cityStatus}`,
    `  Nearby moves: ${moveOptions}`,
    `  Prisoners and captured civilians: "doctrina":{"ejecutarPct":0-100} sets the % you execute on each capture (default 0 civilians / motor 10 prisoners; rest is spared, 20% escape home, 10% die). Omit to accept everyone.`,
    ``,
    `  diplomacy:"declare_war" + targetNationId: Formally declare war (allows attacking).`,
    `  diplomacy:"seek_alliance" + targetNationId: Form a military alliance.`,
    `  diplomacy:"seek_peace" + targetNationId: Negotiate a truce with a hostile nation.`,
    `  diplomacy:"none": No diplomatic action this turn.`,
    ``,
    `  era:"advance_era": Pay gold to enter the next era (costs rise but production/exploration improve + unlocks). Only advances if era requirements are met.${skipInfo}${darkWarn}`,
    `  era:"skip_dark": Only from medieval: skip the optional dark age and jump straight to modern (validates modern requirements).`,
    `  era:"stay": Remain in the current era.`,
    ``,
    `DECISION RULES — follow these in order:`,
    `  1. If gold >= 1 and neutral provinces exist: choose peaceful_expand with targetNationId: null`,
    `  2. If at war with a nation: choose control_city or decisive_battle with that nation as target`,
    `  3. If no neutral territory and no war: choose none or construction/recovery`,
    ``,
    `IMPORTANT: targetNationId rules:`,
    `  - For peaceful_expand: targetNationId MUST be null`,
    `  - For control_city, control_resource, decisive_battle, declare_war, seek_alliance, seek_peace: targetNationId MUST be a valid Other nation ID from the list above`,
    `  - NEVER use your own id="${context.nationId}" as a target`,
    ``,
     `Current policies: Expansion=${policy?.expansion?.policy ?? "unknown"}, Economy=${policy?.economy?.policy ?? "unknown"}, Diplomacy=${policy?.diplomacy?.policy ?? "unknown"}, Era=${(policy as any)?.era?.policy ?? "stay"}`,
     ``,
     `Enemy frontier provinces (theirs, bordering yours) — ONLY these can be attacked via "targetProvinceId":`,
     attackableProvinces.length > 0
       ? attackableProvinces.map((p) => `    - ${p.id} (${p.name ?? "unknown"}, owner=${p.owner})`).join("\n")
       : "    none",
     `Use "targetProvinceId" with "declare_war"/"control_city"/"decisive_battle" to attack a frontier province. Omit or null for automated targeting.`,
     ``,
     `Your army groups: ${groupStatus}`,
     `Garrisons ready to muster (cityId, movable/total troops): ${musterStatus}`,
     `  "muster":[{"cityId":"...","units":{"militia":30},"stance":"attack"}]: form an army group from that city's garrison (amounts within movable, total >= 25, stance optional attack/defend/garrison/rally/raid/retreat). Omit or null for automated mustering.`,
     `  "move":[{"groupId":"...","destinationProvinceId":"...","stance":"attack"}]: redirect any group (idle or marching, path recomputed from its position, stance optional). Invalid orders are rejected with a reason. Omit or null to keep automated movement.`,
     ``,
     `EXAMPLES of valid JSON responses:`,
    `  When neutral territory is available: {"expansion":"peaceful_expand","economy":"construction","diplomacy":"none","targetNationId":null,"rationale":"Colonizing neutral territory to grow peacefully"}`,
    `  When at war: {"expansion":"control_city","economy":"army_building","diplomacy":"declare_war","targetNationId":"enemy_nation_id","rationale":"Capturing cities to weaken the enemy"}`,
    `  When no expansion needed: {"expansion":"none","economy":"construction","diplomacy":"seek_alliance","era":"stay","targetNationId":null,"rationale":"Building infrastructure and alliances"}`,
    ``,
    "Respond ONLY with valid JSON, no explanation, no analysis, no reasoning text:",
     '{"expansion":"peaceful_expand"|"control_city"|"control_resource"|"decisive_battle"|"none","economy":"army_building"|"construction"|"recovery","diplomacy":"declare_war"|"seek_alliance"|"seek_peace"|"none","era":"advance_era"|"skip_dark"|"stay","targetNationId":"nation_id_or_null","targetProvinceId":"frontier_province_id_or_null","rationale":"brief reason","cartMove":null,"cartOffer":null,"acceptCartOfferId":null,"traslado":null,"doctrina":null,"muster":null,"move":null,"upgrade":null,"buildOrders":null}',
  ].join("\n");
}

export function parseDecision(raw: string): LLMDecision | null {
  const cleaned = raw.replace(/```json\s*/g, "").replace(/```/g, "");
  const jsonStart = cleaned.indexOf("{");
  if (jsonStart === -1) {
    const fallback = cleaned.match(/\{[\s\S]*\}/);
    if (fallback) {
      try {
        const parsed = JSON.parse(fallback[0]);
     return {
       expansion: parsed.expansion ?? "none",
       targetTileId: parsed.targetTileId,
       economy: parsed.economy ?? "construction",
       diplomacy: parsed.diplomacy ?? "none",
       era: parsed.era ?? "stay",
       targetNationId: parsed.targetNationId ?? null,
       targetProvinceId: parsed.targetProvinceId ?? undefined,
       rationale: parsed.rationale ?? "",
        };
      } catch {}
    }
    return null;
  }
  const jsonStr = cleaned.substring(jsonStart);
  try {
    const parsed = JSON.parse(jsonStr);
    return {
      expansion: parsed.expansion ?? "none",
      targetTileId: parsed.targetTileId,
      economy: parsed.economy ?? "construction",
      diplomacy: parsed.diplomacy ?? "none",
      era: parsed.era ?? "stay",
      targetNationId: parsed.targetNationId ?? null,
      targetProvinceId: normalizeTargetProvince(parsed.targetProvinceId),
      rationale: parsed.rationale ?? "",
      cartMove: normalizeCartMove(parsed.cartMove),
      cartOffer: normalizeCartOffer(parsed.cartOffer),
      acceptCartOfferId: typeof parsed.acceptCartOfferId === "string" ? parsed.acceptCartOfferId : undefined,
      traslado: normalizeTraslado(parsed.traslado),
      doctrina: normalizeDoctrina(parsed.doctrina),
      muster: normalizeMuster(parsed.muster),
      move: normalizeMove(parsed.move),
      upgrade: normalizeUpgrade(parsed.upgrade),
      buildOrders: normalizeBuildOrders(parsed.buildOrders),
    };
  } catch {
    const extract = (key: string): string | null => {
      const m = jsonStr.match(new RegExp(`"${key}"\\s*:\\s*"([^"]*)"`));
      return m ? m[1] : null;
    };
    const numExtract = (key: string): string | null => {
      const m = jsonStr.match(new RegExp(`"${key}"\\s*:\\s*(\\d+)`));
      return m ? m[1] : null;
    };
    const expansion = extract("expansion") ?? "none";
    const economy = extract("economy") ?? "construction";
    const diplomacy = extract("diplomacy") ?? "none";
    const era = extract("era") ?? "stay";
    const targetNationId = extract("targetNationId") ?? undefined;
    const rationale = extract("rationale") ?? "";
    return { expansion, economy, diplomacy, era, targetNationId, rationale };
  }
}

function normalizeCartMove(value: unknown): LLMDecision["cartMove"] {
  if (typeof value !== "object" || value === null) return undefined;
  const v = value as Record<string, unknown>;
  if (typeof v.fromProvinceId !== "string" || typeof v.toProvinceId !== "string") return undefined;
  const carts = Math.floor(Number(v.carts));
  if (!Number.isFinite(carts) || carts < 1) return undefined;
  return { fromProvinceId: v.fromProvinceId, toProvinceId: v.toProvinceId, carts };
}

function normalizeCartOffer(value: unknown): LLMDecision["cartOffer"] {
  if (typeof value !== "object" || value === null) return undefined;
  const v = value as Record<string, unknown>;
  if (typeof v.targetNationId !== "string") return undefined;
  const carts = Math.floor(Number(v.carts));
  const price = Math.floor(Number(v.pricePerCart));
  if (!Number.isFinite(carts) || carts < 1 || !Number.isFinite(price) || price < 1) return undefined;
  return { targetNationId: v.targetNationId, carts, pricePerCart: price };
}

function normalizeTraslado(value: unknown): LLMDecision["traslado"] {
  if (typeof value !== "object" || value === null) return undefined;
  const v = value as Record<string, unknown>;
  if (typeof v.fromCityId !== "string" || typeof v.toCityId !== "string") return undefined;
  const colonos = Math.floor(Number(v.colonos));
  if (!Number.isFinite(colonos) || colonos < 1) return undefined;
  return { fromCityId: v.fromCityId, toCityId: v.toCityId, colonos };
}

function normalizeDoctrina(value: unknown): LLMDecision["doctrina"] {
  if (typeof value !== "object" || value === null) return undefined;
  const v = value as Record<string, unknown>;
  const pct = Math.floor(Number(v.ejecutarPct));
  if (!Number.isFinite(pct)) return undefined;
  return { ejecutarPct: Math.max(0, Math.min(100, pct)) };
}

const MUSTER_UNITS = ["militia", "infantry", "lightCavalry", "heavyCavalry", "levy", "caballeria"];
const ORDER_STANCES = ["attack", "defend", "garrison", "rally", "raid", "retreat"];

function normalizeStance(value: unknown): string | undefined {
  return typeof value === "string" && ORDER_STANCES.includes(value) ? value : undefined;
}

function normalizeMuster(value: unknown): LLMDecision["muster"] {
  if (!Array.isArray(value)) return undefined;
  const out: NonNullable<LLMDecision["muster"]> = [];
  for (const item of value) {
    if (typeof item !== "object" || item === null) continue;
    const v = item as Record<string, unknown>;
    if (typeof v.cityId !== "string") continue;
    const units: Record<string, number> = {};
    const raw = (v.units ?? {}) as Record<string, unknown>;
    for (const u of MUSTER_UNITS) {
      const n = Math.floor(Number(raw[u]));
      if (Number.isFinite(n) && n > 0) units[u] = n;
    }
    if (Object.keys(units).length === 0) continue;
    out.push({ cityId: v.cityId, units, stance: normalizeStance(v.stance) });
  }
  return out.length > 0 ? out : undefined;
}

function normalizeMove(value: unknown): LLMDecision["move"] {
  if (!Array.isArray(value)) return undefined;
  const out: NonNullable<LLMDecision["move"]> = [];
  for (const item of value) {
    if (typeof item !== "object" || item === null) continue;
    const v = item as Record<string, unknown>;
    if (typeof v.groupId !== "string" || typeof v.destinationProvinceId !== "string") continue;
    out.push({ groupId: v.groupId, destinationProvinceId: v.destinationProvinceId, stance: normalizeStance(v.stance) });
  }
  return out.length > 0 ? out : undefined;
}

export function normalizeUpgrade(value: unknown): LLMDecision["upgrade"] {
  if (typeof value !== "object" || value === null) return undefined;
  const v = value as Record<string, unknown>;
  if (typeof v.provinceId !== "string" || typeof v.kind !== "string") return undefined;
  if (!(BUILDING_LIST as string[]).includes(v.kind)) return undefined;
  return { provinceId: v.provinceId, kind: v.kind };
}

export function normalizeBuildOrders(value: unknown): LLMDecision["buildOrders"] {
  if (!Array.isArray(value)) return undefined;
  const out: NonNullable<LLMDecision["buildOrders"]> = [];
  for (const item of value) {
    if (typeof item !== "object" || item === null) continue;
    const v = item as Record<string, unknown>;
    if (typeof v.provinceId !== "string" || typeof v.kind !== "string") continue;
    if (!(BUILDING_LIST as string[]).includes(v.kind)) continue;
    out.push({ provinceId: v.provinceId, kind: v.kind });
  }
  return out.length > 0 ? out : undefined;
}

function applyDecisionToWorld(decision: LLMDecision, context: NationTurnContext): void {
  const nation = context.world.nationById.get(context.nationId);
  if (!nation) return;

  const sim = context.simulation as any;
  const nationPolicies = sim.nationPolicies[context.nationId] || {};
  const validExpansions = new Set(["control_city", "control_resource", "decisive_battle", "peaceful_expand", "none"]);
  const validEconomies = new Set(["army_building", "construction", "recovery"]);
  const validDiplomacies = new Set(["declare_war", "seek_alliance", "seek_peace", "seek_vassalage", "demand_vassalage", "none", "surrender"]);
  const validEras = new Set(["advance_era", "skip_dark", "stay"]);

  // Sanitizar: "declare_war" no es ExpansionPolicy válida; va por diplomacia.
  let expansion = validExpansions.has(decision.expansion) ? decision.expansion : "none";
  if ((decision.expansion as string) === "declare_war") expansion = "none";

  if (expansion && expansion !== "none") {
    nationPolicies.expansion = {
      policy: expansion as any,
      label: expansion,
      rationale: decision.rationale || "",
      // peaceful_expand no usa targetNationId (solo neutrales)
      targetNationId: expansion === "peaceful_expand" ? undefined : (decision.targetNationId || undefined),
      targetTileId: decision.targetTileId || undefined,
      targetResource: expansion === "control_resource" ? "grain" : undefined,
      decidedAtMonth: context.turnNumber,
      nextDecisionMonth: context.turnNumber + 2,
    };
  } else if (decision.expansion) {
    nationPolicies.expansion = { ...nationPolicies.expansion, decidedAtMonth: context.turnNumber, nextDecisionMonth: context.turnNumber + 2 };
  }

  if (decision.economy && validEconomies.has(decision.economy)) {
    const validIntents = new Set(["pueblo", "ciudad", "reino", "auto"]);
    const intent = validIntents.has((decision as unknown as { constructionIntent?: string }).constructionIntent ?? "")
      ? (decision as unknown as { constructionIntent: string }).constructionIntent
      : "auto";
    nationPolicies.economy = {
      policy: decision.economy as any,
      label: decision.economy,
      rationale: decision.rationale || "",
      decidedAtMonth: context.turnNumber,
      nextDecisionMonth: context.turnNumber + 2,
    };
    (nationPolicies as unknown as { constructionIntent: string }).constructionIntent = intent;
  } else if (decision.economy) {
    nationPolicies.economy = { ...nationPolicies.economy, decidedAtMonth: context.turnNumber, nextDecisionMonth: context.turnNumber + 2 };
  }

   if (decision.diplomacy && validDiplomacies.has(decision.diplomacy) && decision.diplomacy !== "none") {
     nationPolicies.diplomacy = {
       policy: decision.diplomacy as any,
       label: decision.diplomacy,
       rationale: decision.rationale || "",
       targetNationId: decision.targetNationId || undefined,
       targetProvinceId: decision.targetProvinceId || undefined,
       targetTileId: decision.targetTileId || undefined,
       decidedAtMonth: context.turnNumber,
       nextDecisionMonth: context.turnNumber + 2,
     };
   } else if (decision.diplomacy) {
    nationPolicies.diplomacy = { ...nationPolicies.diplomacy, decidedAtMonth: context.turnNumber, nextDecisionMonth: context.turnNumber + 2 };
  }

  if (decision.era && validEras.has(decision.era)) {
    nationPolicies.era = {
      policy: decision.era as any,
      label: decision.era,
      rationale: decision.rationale || "",
      decidedAtMonth: context.turnNumber,
      nextDecisionMonth: context.turnNumber + 2,
    };
  } else if (decision.era) {
    nationPolicies.era = { ...nationPolicies.era, decidedAtMonth: context.turnNumber, nextDecisionMonth: context.turnNumber + 2 };
  }

  nationPolicies.decidedAtMonth = context.turnNumber;
  nationPolicies.nextDecisionMonth = context.turnNumber + 2;

  // Comercio de carretas: todo lo decide la IA por necesidad (traslado,
  // oferta con precio propio, aceptación). El motor valida y ejecuta.
  const cartPolicy = nationPolicies as unknown as {
    cartMove?: LLMDecision["cartMove"];
    cartOffer?: LLMDecision["cartOffer"];
    acceptCartOfferId?: string;
    traslado?: LLMDecision["traslado"];
    doctrina?: LLMDecision["doctrina"];
    musterOrders?: LLMDecision["muster"];
    moveOrders?: LLMDecision["move"];
    upgradeOrder?: LLMDecision["upgrade"];
    buildOrdersList?: LLMDecision["buildOrders"];
  };
  cartPolicy.cartMove = decision.cartMove;
  cartPolicy.cartOffer = decision.cartOffer;
  cartPolicy.acceptCartOfferId = decision.acceptCartOfferId;
  cartPolicy.traslado = decision.traslado;
  cartPolicy.doctrina = decision.doctrina;
  cartPolicy.musterOrders = decision.muster;
  cartPolicy.moveOrders = decision.move;
  cartPolicy.upgradeOrder = decision.upgrade;
  cartPolicy.buildOrdersList = decision.buildOrders;

  // NO inventar eventos war_declared aquí: la guerra real la crea
  // executeDiplomacyPoliciesWithEvents en resolveTurn a partir de nationPolicies.
  // (Antes se pusheaba un evento fantasma sin WarState, falseando conteos del script 004.)

  sim.nationPolicies[context.nationId] = nationPolicies;
}
