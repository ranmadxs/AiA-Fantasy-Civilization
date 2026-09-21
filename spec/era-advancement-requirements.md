# Requisitos para Avanzar de Era

## Resumen

Agregar requisitos mínimos adicionales al costo en oro para cada transición de era. Cada turno el LLM puede intentar avanzar; si no cumple requisitos, se muestra un evento y puede reintentar el próximo turno.

---

## Tabla de requisitos

| Transición | Oro | Requisito adicional |
|------------|-----|---------------------|
| 🗿 Stone → 🏺 Ancient | 10 | ≥ 15 pueblos |
| 🏺 Ancient → 🏰 Medieval | 100 | ≥ 5,000 población total |
| 🏰 Medieval → ⚙️ Modern | 10,000 | ≥ 1 reino activo |
| 🌑 Dark Medieval → ⚙️ Modern | 10,000 | ≥ 1 reino activo |
| ⚙️ Modern → 🌐 Contemporary | 100,000 | ≥ 1,000,000 población total |

---

## Definición de datos

### `EraRequirement` (nuevo tipo en `src/world/era.ts`)

```typescript
export type EraRequirement = {
  minPueblos?: number;        // # de cities con tipo "pueblo"
  minPoblacion?: number;      // población total de la nación
  minReinosActivos?: number;  // # de reinos con activo: true
};
```

### `ERA_REQUIREMENTS` (nuevo constante en `src/world/era.ts`)

```typescript
export const ERA_REQUIREMENTS: Record<string, EraRequirement> = {
  ancient:         { minPueblos: 15 },
  medieval:        { minPoblacion: 5000 },
  dark_medieval:   { minReinosActivos: 1 },
  modern:          { minReinosActivos: 1 },
  contemporary:    { minPoblacion: 1000000 },
};
```

---

## Funciones a agregar en `src/world/era.ts`

### `checkEraRequirements(upcomingEra, world, nationId, stockpile, reinos): { met: boolean, faltan: string[] }`

Verifica si una nación cumple todos los requisitos para la era destino.

```typescript
export function checkEraRequirements(
  upcomingEra: string,
  world: World,
  nationId: string,
  stockpile: NationStockpile | undefined,
  reinos: Array<{ nationId: string; activo: boolean }>,
): { met: boolean; faltan: string[] } {
  const req = ERA_REQUIREMENTS[upcomingEra];
  if (!req) return { met: true, faltan: [] };

  const faltan: string[] = [];

  if (req.minPueblos !== undefined) {
    const pueblos = world.cities.filter(
      (c) => c.nationId === nationId && (c.tipo ?? "pueblo") === "pueblo"
    ).length;
    if (pueblos < req.minPueblos) {
      faltan.push(`${req.minPueblos - pueblos} pueblos faltantes (tienes ${pueblos})`);
    }
  }

  if (req.minPoblacion !== undefined) {
    const { population } = calculateNationCityEconomy(nationId, world);
    if (population < req.minPoblacion) {
      faltan.push(
        `${(req.minPoblacion - population).toLocaleString()} población faltante (tienes ${population.toLocaleString()})`
      );
    }
  }

  if (req.minReinosActivos !== undefined) {
    const reinosActivos = reinos.filter(
      (r) => r.nationId === nationId && r.activo
    ).length;
    if (reinosActivos < req.minReinosActivos) {
      faltan.push(
        `${req.minReinosActivos - reinosActivos} reino(s) faltante(s) (tienes ${reinosActivos})`
      );
    }
  }

  const cost = eraChangeCost(upcomingEra);
  if ((stockpile?.gold ?? 0) < cost) {
    faltan.push(`${cost - (stockpile?.gold ?? 0)} oro faltante (cuesta ${cost})`);
  }

  return { met: faltan.length === 0, faltan };
}
```

---

## Modificación en `src/world/turnSimulation.ts`

### Bloque de transición de era (línea ~347-383)

**Antes:**
```typescript
if ((stock?.gold ?? 0) >= cost) {
  stock.gold -= cost;
  // → AVANZAR
} else {
  // → "faltan oro"
}
```

**Después:**
```typescript
const reqResult = checkEraRequirements(upcoming, world, nation.id, stock, reinos);

if (reqResult.met && (stock?.gold ?? 0) >= cost) {
  stock.gold -= cost;
  // → AVANZAR (igual que ahora)
} else if (!reqResult.met) {
  // → evento "🚫 Requisitos de era no cumplidos"
  //   description: `${nation.name} no puede avanzar a ${upcoming}: ${faltan.join(', ')}`
  // → NO descuenta oro, puede reintentar próximo turno
} else {
  // → evento "🚫 Faltan oro" (como ahora)
}
```

### Evento nuevo: `era_requirements_failed`

```typescript
events.push({
  id: `event-era-blocked-${nation.id}`,
  month: nextMonth,
  kind: "era",
  title: "🚫 Requisitos de era no cumplidos",
  description: `${nation.name} no puede avanzar a la era ${upcoming}: ${faltan.join('; ')}.`,
  nationIds: [nation.id],
});
```

---

## Reglas del grace period (reintento)

- **Cada turno** el LLM decide: `era: "advance_era"` o `"stay"`
- Si no cumple requisitos: se muestra evento, **no se descuenta oro**, se puede intentar de nuevo el próximo turno
- **No hay penalización** por intentar fallar
- El LLM debería decidir `era: "stay"` si no cumple (pero puede seguir intentando)

---

## Archivos afectados

| Archivo | Cambio |
|---------|--------|
| `src/world/era.ts` | Agregar `EraRequirement`, `ERA_REQUIREMENTS`, `checkEraRequirements()` |
| `src/world/turnSimulation.ts` | Modificar bloque de transición de era (línea 347-383) |
| `spec/era-advancement-requirements.md` | Este archivo |

---

## Datos de referencia

- `world.cities.filter(c => c.nationId === id && (c.tipo ?? 'pueblo') === 'pueblo').length` → # pueblos
- `calculateNationCityEconomy(id, world).population` → población total
- `reinos.filter(r => r.nationId === id && r.activo).length` → # reinos activos
- `eraChangeCost(era)` → costo en oro (ya existe)

---

## Consideraciones

- Las naciones en `army_building` policy podrían no cumplir requisitos si no han construido pueblos
- El LLM debe decidir `era` cada turno; si falla, puede reintentar
- Los eventos existentes de era (`era`, `era-blocked`) se mantienen compatibles
- El costo de oro se descuenta **solo** si se cumplen todos los requisitos
- `skip_dark` también valida requisitos de `modern` (necesita reino)
