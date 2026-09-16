# Spec: IA Externa por Nación (LLM / Ollama)

**Versión:** 1.0
**Última actualización:** 2026-09-16
**Proyecto:** AI Civilization Sandbox
**Licencia:** GPL-2.0-only

---

## 1. Problema: la pantalla de configuración está desconectada del juego

La pantalla `NationModelConfiguration` (`src/components/NationModelConfiguration.tsx`)
permite configurar por nación un modelo OpenAI-compatible y un prompt de
personalidad, guarda en el navegador (`localStorage`,
clave `ai-civilization:nation-model-configs:v1`) y su `Test Connection`
(`testNationModelConnection` en `src/world/modelConfig.ts`) funciona.

Pero el juego ignora esa configuración: `App.tsx:166` pasa `undefined`
como executor a `advanceSimulationTurn`:

```ts
const next = await advanceSimulationTurn(world, simulationRef.current, undefined, setTurnProgress);
```

Con `undefined`, `turnSimulation.ts:95` usa el executor por defecto
(`async () => undefined`, no-op) y `resolveTurn()` resuelve el turno solo
con la IA interna clásica (`policyAI`, diplomacia, guerra, espionaje).
El resultado: aunque haya naciones con modelo externo en verde y guardadas,
los turnos avanzan siempre con la IA simulada.

Evidencia: `createLLMExecutor` (`src/world/llmExecutor.ts`) no se usa en
ningún `.tsx` de `src/`; solo lo usa `scripts/init_world_004_11_09_2026.mjs`
(script de reportes, no el juego web).

---

## 2. Bug del endpoint: doble sufijo `/chat/completions`

La pantalla pide la URL **completa** del endpoint OpenAI-compatible
(placeholder: `"https://provider.example/v1/chat/completions"`) y
`testNationModelConnection` la usa tal cual en el `fetch` de prueba.

Pero `llmExecutor.ts:50` construye la URL de inferencia añadiendo el sufijo:

```ts
fetch(`${baseUrl}/chat/completions`, { ... })
```

donde `baseUrl = config.endpoint || PROVIDER_BASE_URL[...]`.
Si el usuario pega la URL completa (como indica la pantalla), la llamada real
queda como `.../v1/chat/completions/chat/completions` (404).

Fix requerido en `src/world/llmExecutor.ts`:

- Si `config.endpoint` termina en `/chat/completions`, usarlo tal cual;
  si no, añadir el sufijo.
- Normalizar `providerName` a minúsculas antes del lookup en
  `PROVIDER_BASE_URL` (`"Ollama"` → base ollama), manteniendo el fallback actual.
- Default de modelo `config.model || "qwen2.5:0.5b"` (hoy `"qwen3:14B"`).

---

## 3. Diseño del cableado: executor combinado por turno

Nuevo helper `buildGameExecutor(world)` en `src/App.tsx`, construido al
inicio de cada `runNextTurn` (lee `loadNationModelConfigs(world)` fresco
cada turno: cubre mundo nuevo y regreso de la pantalla con `Save` sin
cableado extra de superficies), pasado a `advanceSimulationTurn` en vez de
`undefined`:

```ts
async (context) => {
  const cfg = configs[context.nationId];
  if (!cfg?.enabled) return;   // IA interna vía resolveTurn, sin cambios
  try {
    await llm(context);        // createLLMExecutor(configs)
  } catch (error) {
    debug.error(
      `[LLM] nación=${context.nationId} turno=${context.turnNumber} ` +
      `endpoint=${cfg.endpoint} model=${cfg.model || "qwen2.5:0.5b"} motivo=${causa}`,
    );
    return;                    // sin acción y sin fallback
  }
}
```

Regla de fallo acordada: si el LLM falla para una nación, esa nación **no
actúa** en este turno (conserva sus `nationPolicies` vigentes y `resolveTurn()`
la resuelve con ellas) y se registra `debug.error` con motivos
(nación, turno, endpoint, modelo, causa: HTTP status, timeout, red o JSON
inválido tras reintentos). El turno continúa para el resto de naciones.
`debug.error` escribe siempre al buffer (300 entradas, descargable) y a
consola con `?debug=1`.
