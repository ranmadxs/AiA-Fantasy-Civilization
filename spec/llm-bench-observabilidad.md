# Spec: Bench y Observabilidad LLM (calidad, latencia, modelo)

**Versión:** 1.0
**Última actualización:** 2026-09-17
**Proyecto:** AI Civilization Sandbox
**Licencia:** GPL-2.0-only

---

## 1. Problema

Los LLMs de naciones responden pero sus decisiones no se materializan en el mundo. Evidencia de `target/app.log` (sesión 2026-09-17, seed `observer-world-001`):

| Turno | Nación / modelo | Decisión logueada | Efecto real |
|---|---|---|---|
| M1 | aurora `qwen2.5:0.5b` | `expansion=none, economy=none, diplomacy=none, target=verdant` | No-op por diseño (`none` preserva policy). Target válido desperdiciado |
| M1 | sol `deepseek-r1:8B` | `none / construction / none, target=null` | Solo construye |
| M2 | aurora | `control_city / construction / none, target=null` | Policy huérfana: `control_city` sin `declare_war` previo no mueve tropas |
| M2 | sol | `expansion=..., economy=..., diplomacy=...` + `rationale="brief reason"` | Fallo de parseo: copió el placeholder del prompt |
| M3 | sol | `expansion=option, economy=option, diplomacy=option` | Copió literal `option` |
| M4 | aurora | `none / recovery / seek_alliance, target=null` | Filtrado en `diplomacy.ts:136-138` (`if (!targetNationId) continue`) |

Regla del usuario: **nada de fallbacks** — no inventar decisiones locales (`none`, aliado más débil, guerra fantasma). Solo hacer que el modelo conteste mejor.

Causa raíz (no síntoma):

1. **Placeholder caníbal:** el ejemplo final del prompt manda literal `"targetNationId":"nation_id"` (luego `"nation_id_or_null"`). Los modelos chicos (0.5b) imitan el ejemplo, no la instrucción.
2. **Prompt largo y contradictorio para 0.5b:** ~30 líneas, 48 combos, más `Declare war first, then control_city` en el mismo turno (imposible en 1 turno: la guerra se crea en `executeDiplomacyPoliciesWithEvents` y el ataque corre después en `advanceArmyGroups`).
3. **Sin modo JSON:** body actual `temperature:0.5~0.7, max_tokens:1024`, sin `"format":"json"` de Ollama. `deepseek-r1` devuelve `<think>...</think>{...}` y `parseDecision` toma desde el primer `{`.
4. **Reintento ciego:** `attempt > 1` repite placeholder genérico sin decir qué estuvo mal ni cuáles son los IDs válidos.

## 2. Estado base (trabajo del otro agente, sin commitear al 2026-09-17)

Ya resuelto por el otro agente (no repetir):

- `src/world/llmExecutor.ts`: `temperature 0.7→0.5`, `neutralProvinces` en prompt, `PRIORITY RULE peaceful_expand`, `DECISION RULES 1-2-3`, `EXAMPLES` JSON, saneo de target a `undefined`, contención de errores sin tumbar el loop.
- `src/world/modelConfig.ts` + `NationModelConfiguration.tsx`: soporte Ollama (`nara:11434`, `/api/tags`, proxy `fetchOllama`).
- `src/world/debugLog.ts` + `vite.config.ts`: pipeline `POST /__aia-log → target/app.log + target/error.log` + `target/ai-preferences.json`.
- `src/world/turnSimulation.ts`: `logTurnToDisk + flushLogs` por turno.
- Tests nuevos: `test/llm-providers.test.ts`, `test/logger.test.ts`, `test/prefs.test.ts`.

Lo que **sigue faltando** (delta de esta spec): `format:json`, `temperature 0`, ejemplo con id real, strip `<think>`, log raw, bench contra Ollama local.

## 3. Objetivo

- ≥90% respuestas JSON válidas + `targetNationId` válido en **1 intento**.
- p95 latencia <10s/turno (elección del usuario: **latencia sobre accuracy**, 1 sola llamada por turno).
- Cero decisiones inventadas localmente. El reintento solo re-pregunta con corrección.
- Bench reproducible: lo que pasa en el script pasa en la web (mismo `buildPrompt` + mismo body).

## 4. Diseño F1 — Llamada única rápida (`src/world/llmExecutor.ts`, ~20 líneas)

- Body Ollama: añadir `"format":"json"` + `"options":{"temperature":0,"num_predict":256,"num_ctx":4096}`, `max_tokens 1024→256`. Solo Ollama; resto de proveedores sin `format`.
- `buildPrompt`: ejemplo final con **id real del contexto** (p.ej. `"targetNationId":"sol"` si soy `aurora`) + línea `If no attack/alliance needed use null`. Eliminar `"nation_id"` / `"nation_id_or_null"` literales.
- `parseDecision`: stripear `<think>[\s\S]*?</think>` antes de buscar el primer `{`.
- Reintento correctivo (no sustitutivo): si `validateTarget == null` pero la acción lo exige, el siguiente `attempt` manda como `user`: `Previous target="X" invalid. Valid IDs: [a,b,c]. Return ONLY corrected JSON.` Reusa el loop existente (máx 6 intentos).
- Exportar `buildPrompt` (`export function buildPrompt`) para que el bench importe la función real. Sin duplicar prompts.

## 5. Diseño F2 — Modelo (subir lo necesario)

- `src/world/modelConfig.ts:56` `DEFAULT_OLLAMA_MODEL`: `qwen2.5:0.5b → qwen2.5:3b`. `.env` `LLM_MODEL` igual.
- Criterio: el bench (F4) decide. Si `3b` no llega al ≥90%, subir a `7b/8b` (`qwen2.5:7b` o `llama3.1:8b` si está en `nara`) y documentar aquí.
- `deepseek-r1:8B` se mantiene solo para `sol` hasta medir sus ~40s/turno contra el presupuesto p95 <10s.
- `0.5b` (~500M params) queda descartado como executor: por debajo del umbral de instruction-following JSON fiable por más prompt que se le ponga.

## 6. Diseño F3 — Observabilidad genérica a `target/`

- Nuevo `scripts/llmObserve.mjs` (~40 líneas): importa `formatLogLine` vía `vite.ssrLoadModule("/world/debugLog.ts")` (igual que `test_model.mjs:17-19` hace con `buildDemoWorld`), expone `observeLLM({model, turn, nationId, prompt, raw, parsed, latencyMs, endpoint})` y escribe formato Java `INFO [llmBench]/[llmExecutor]` a `target/logs/llm_calls_YYYY-MM-DD.log` (misma carpeta/estilo que `loggerBase.mjs:initLog`).
- En browser no se toca nada: `debug.tag("llmExecutor")` ya fluye a `target/app.log` vía `/__aia-log`.
- Añadir 1 línea temporal en `llmExecutor.ts:117`: `llmLog.info("raw:", fullText.slice(0,600))` + `latencia_ms` por 1 sesión para correlacionar prompt→raw→parseado por turno. Quitar tras estabilizar.

## 7. Diseño F4 — Benchmark con las llamadas reales (`scripts/bench_llm.mjs` nuevo)

Reproduce el caso real, no un mock:

1. Levanta `vite.ssrLoadModule`, carga `buildDemoWorld("observer-world-001")` + contexto `NationTurnContext` real (igual que `test_model.mjs:17-24`).
2. Importa el `buildPrompt` exportado (F1) y construye los casos que hoy fallan: M1 `none`, M2 `control_city null`, M4 `seek_alliance null` (+ placeholders `...`/`option`).
3. Dispara el **body exacto de la web** contra `http://localhost:11434/v1/chat/completions` (Ollama local; la web sigue en `nara:11434`).
4. Matriz: modelos `[qwen2.5:0.5b, qwen2.5:3b, deepseek-r1:8B, llama3.1:8b si existe]` × prompts `[actual, fijo-F1]` × casos `[M1, M2, M4]`.
5. Reporta por caso `latencia_ms, json_ok, target_ok, decision` + tabla final; vuelca todo vía F3 a `target/logs/bench_YYYY-MM-DD.log`.
6. Uso: `node scripts/bench_llm.mjs --model qwen2.5:3b --cases M2,M4`. Lo que pase en bench pasa en web (misma función + mismo body).

## 8. Verificación y riesgos

Verificación:

- `node scripts/bench_llm.mjs` ≥90% válido en 1 intento con el modelo elegido.
- `pnpm dev` 3 turnos → `target/app.log` con `target=<id>` (no `null`), `target/error.log` vacío.
- `npx tsc --noEmit` sin errores en `llmExecutor.ts`; `test/llm-providers|logger|prefs.test.ts` verdes.

Riesgos:

- `vite dev` vacía `app.log/error.log` en cada arranque (`vite.config.ts:41-44`): el bench escribe a `target/logs/` para no perder historial.
- Web usa `nara:11434`, bench usa `localhost:11434`: divergencia de modelos instalados; el bench lista `/api/tags` local y lo reporta.
- `deepseek-r1` puede exceder el presupuesto de latencia aun con `num_predict:256`; si p95 >10s se excluye del default aunque su calidad sea mayor.
