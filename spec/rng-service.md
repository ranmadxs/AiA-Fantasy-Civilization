# Spec: Servicio Central de RNG Determinista (`rngService`)

> Inspiración: `RNGManager` de Stochastic Warfare (patrones, NO su código: su lib es
> Python bajo PolyForm Noncommercial, incompatible con este repo GPL-2.0-only).
> Aquí solo se adoptan las ideas (streams por dominio, disciplina PRNG), con
> implementación 100% propia en TypeScript.

## 1. Problema

La simulación promete determinismo por seed, pero hoy está roto por goteo:

| Archivo | Uso actual | Estado |
|---|---|---|
| `src/world/buildDemoWorld.ts` | `mulberry32` / `randomAt` con `seedHash` | ✅ bien |
| `src/world/war.ts` (`seededRandom`) | hash puntual `(seed, salt, mes)` | ✅ bien |
| `src/world/settlement.ts` (`seededRandom`) | hash puntual `(seed, salt, mes)` | ✅ bien |
| `src/world/mapSkin.ts` | stream propio `seedHash ^ 0x70CC1E` | ✅ bien |
| `src/world/market.ts` | 6× `Math.random()` (ofertas, precios, IDs) | ❌ rompe determinismo |
| `src/world/currency.ts:23` | `Math.random()` (reservas metálicas) | ❌ rompe determinismo |
| `src/world/construction.ts:25` | `Date.now()` en IDs | ❌ no reproducible |
| `src/world/chat.ts:25` | `Date.now()` + `Math.random()` en IDs | ❌ no reproducible |

Además `mulberry32` + `hashString` están duplicados en 3 archivos.

Consecuencia: tocar `market.ts` (o el orden de sus llamadas) mueve batallas, espionaje
y economía aunque la seed sea la misma. Imposible validar, imposible debuggear por replay.

## 2. Objetivo

Un servicio central `src/world/rngService.ts` con dos mecanismos (igual que el
`RNGManager` de referencia):

- **`stream(domain)`** — generador secuencial `mulberry32` por dominio. Cada sistema
  consume solo su stream; tocar mercado no mueve ni una batalla.
- **`at(seed, salt, mes)`** — hash puntual determinista, idéntico al `seededRandom`
  actual (para no cambiar ni un número en guerra/asentamientos).

Regla de oro (heredada): **prohibido `Math.random` / `Date.now` en `src/world`**.
Se verifica con grep en CI (`pr.yml`).

## 3. Diseño

```text
seed ──→ RngService ──┬── stream("war") ──→ war.ts (reclutas, ataque, defensa)
                      ├── stream("market") ──→ market.ts (ofertas, fluctuación, precios)
                      ├── stream("economy") ──→ currency.ts, settlement.ts
                      ├── stream("spies") ──→ spies.ts, detección futura
                      ├── stream("skin") ──→ mapSkin.ts (visual, ya usa ^ 0x70CC1E)
                      └── at(salt, mes) ──→ settlement, war (puntual, sin estado)
```

### 3.1 API propuesta

```ts
// src/world/rngService.ts
export type RngDomain = "war" | "market" | "economy" | "spies" | "skin" | "worldgen";

export function hashString(value: string): number;      // FNV-1a (el actual, centralizado)
export function mulberry32(seed: number): () => number; // el actual, centralizado

/** Stream secuencial por dominio. Misma (seed, domain) → misma secuencia, siempre. */
export function stream(seed: string, domain: RngDomain): () => number;

/** Valor puntual en [0,1). Idéntico al seededRandom actual: mismo (seed,salt,mes) → mismo valor. */
export function at(seed: string, salt: string, currentMonth: number): number;
```

Constantes de dominio fijas (XOR sobre el seedHash, estilo `mapSkin`):

```ts
const DOMAIN_XOR = { war: 0xWA…, market: 0xMA…, economy: 0xEC…, spies: 0xSP…, skin: 0x70CC1E, worldgen: 0x00 } as const;
```

(`skin` conserva `0x70CC1E` para no cambiar el overlay actual. `worldgen` en `0x00`
equivale al `rng` principal de hoy.)

### 3.2 Migración por archivo (sin cambiar resultados donde ya hay determinismo)

| Archivo | Cambio | Efecto en números |
|---|---|---|
| `market.ts` | `Math.random()` → `stream(seed,"market")`; IDs `system-sell-…` por contador + `at()` | Cambia (hoy es azar puro; pasa a determinista) |
| `currency.ts:23` | `Math.random()` → `stream(seed,"economy")` | Cambia (mismo caso) |
| `construction.ts:25` | `Date.now()` → `at(seed, "construction:…", mes)` o contador de sim | Cambia a reproducible |
| `chat.ts:25` | `Date.now()+Math.random` → contador + `at()` | Cambia a reproducible |
| `war.ts`, `settlement.ts` | `seededRandom` local → `at()` del servicio (mismo algoritmo, mismos salts) | **Idéntico** |
| `mapSkin.ts` | `createRNG(^0x70CC1E)` → `stream(seed,"skin")` (misma constante) | **Idéntico** |
| `buildDemoWorld.ts` | `mulberry32`/`randomAt` locales → importados del servicio | **Idéntico** |

Los streams de simulación deben derivarse del `world.seed` y avanzar por turno/mes
de forma explícita (p. ej. `stream()` instanciado por mundo en `SimulationState`,
no global), para que replay = misma secuencia.

### 3.3 Fuera de alcance (a propósito)

- Gates de combate, moral Markov, Lanchester, OODA (specs separadas futuras).
- Cambiar `tile.river`, provincias o recursos (este spec no toca lógica, solo azar).
- Dependencia externa alguna: cero paquetes nuevos.

## 4. Verificación

1. **Doble corrida misma seed** → JSON canónico (`tiles ProvinceId/nationId`, provincias,
   naciones, ciudades, eventos) bit-idéntico, incluyendo mercado y moneda.
2. **Aislamiento**: test que avanza solo el stream `market` N veces y comprueba que
   `stream("war")` devuelve la misma secuencia que sin ese avance.
3. **Prohibición**: `grep -rn "Math.random\|Date.now()" src/world --include="*.ts"`
   → 0 resultados fuera de `rngService.ts`. Se añade el grep como step en `pr.yml`.
4. **Compatibilidad**: `seededRandom` viejo vs `at()` nuevo, fuzz de 10k salts → 0 diferencias.
5. `node scripts/svg_generate.mjs --base=aia` → mismo `Parse 194×130 ts=10`, overlay válido.

## 5. Pasos de implementación (cuando se apruebe)

1. Crear `src/world/rngService.ts` (hash + mulberry32 + `stream` + `at` + `DOMAIN_XOR`).
2. Migrar `market.ts`, `currency.ts`, `construction.ts`, `chat.ts` (los rotos).
3. Unificar `war.ts`, `settlement.ts`, `mapSkin.ts`, `buildDemoWorld.ts` al servicio.
4. Borrar `seededRandom`/`mulberry32`/`randomAt`/`hashString` locales duplicados.
5. Añadir el grep anti-`Math.random` a `.github/workflows/pr.yml`.
6. Correr verificación §4 y `smoke-simulation.mjs`.

## 6. Referencias

- Stochastic Warfare: `RNGManager`, streams por módulo (`get_stream(ModuleId)`),
  decisiones indexadas por identidad, disciplina "no bare random", iteración
  determinista — https://clay-m-smith.github.io/stochastic-warfare/concepts/architecture/#determinism-reproducibility
- Estado actual medido con `grep` sobre `src/world` (ver §1).
- Nota legal: patrones sí, código no (Python + PolyForm Noncommercial vs TS + GPL-2.0-only).
