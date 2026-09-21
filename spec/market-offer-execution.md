# MarketOffer — Ejecución Incompleta

**Versión:** 1.0  
**Última actualización:** 2026-09-21  
**Proyecto:** AiA-Fantasy-Civilization  
**Estatus:** Bug abierto — MarketOffer no afecta tesoro ni inventarios  
**Dependencias:** `mercado.md`, `llm-vs-internal-ai.md`

---

## 1. Resumen del Problema

El sistema de `MarketOffer` (mercado automatizado por turno) **no transfiere oro ni recursos** entre naciones cuando se ejecutan transacciones. Las ofertas se generan, se marcan como `executed` y se registran como `Transaction`, pero los `stockpiles` de las naciones permanecen sin cambios.

**Impacto:** El mercado es funcional solo como registro/UI. Las naciones no pierden ni ganan oro ni recursos por comercio.

---

## 2. Flujo Actual (Roto)

```
MARKET_START
  → generateOffers() crea MarketOffer[] para TODAS las naciones
     → sellerNationId, buyerNationId, resourceType, quantity, unitPrice
     → NO hay validación de stock ni oro

MARKET_END
  → executeTransactions(marketState, turn, lang)
     → Filtra ofertas activas
     → Calcula transportCost
     → Crea Transaction { totalGold, transportCost, status: "completed" }
     → ❌ NO modifica stockpiles
     → ❌ NO transfiere recursos
     → ❌ NO descuenta oro del comprador
     → ❌ NO suma oro al vendedor
     → ❌ NO valida si buyer tiene gold
     → ❌ NO valida si seller tiene recursos
     → ❌ buyerNationId = "any" nunca se resuelve
```

---

## 3. Ubicación del Código

| Archivo | Función | Línea | Problema |
|---------|---------|-------|----------|
| `src/world/market.ts` | `executeTransactions()` | 105-149 | No recibe `world`, `stockpiles`. No transfiere nada |
| `src/world/market.ts` | `generateOffers()` | 59-95 | No valida stock del seller, oro del buyer |
| `src/world/market.ts` | `MarketOffer` type | 6-17 | `buyerNationId` permite `"any"` sin resolver |
| `src/world/market.ts` | `Transaction` type | 19-26 | No tiene `resourceType`, `quantity`, `sellerNationId`, `buyerNationId` |
| `src/world/market.ts` | `calculateTransportCost()` | 101-103 | Calcula costo pero nadie lo aplica |
| `src/world/turnSimulation.ts` | Llamada a `executeTransactions` | 1600 | Pasa solo `marketState, nextMonth, lang` — sin `world`, sin `stockpiles` |
| `src/world/settlement.ts` | `NationStockpile` type | 20-24 | `resources` usa `ResourceTotals` (solo grain/timber/coal en init) |
| `src/world/types.ts` | `Resource` type | 3 | Solo `["grain", "timber", "iron", "coal", "oil"]` — 5 recursos |
| `src/world/market.ts` | `generateOffers` resources | 67 | Usa 9 recursos: `["grain", "timber", "iron", "coal", "oil", "water", "gold", "silver", "copper"]` |

---

## 4. Problemas Detallados

### 4.1 `executeTransactions` no recibe datos de estado

**Actual:**
```typescript
export function executeTransactions(
  marketState: MarketState,
  currentTurn: number,
  lang?: EventLang,
): { marketState: MarketState; transactions: Transaction[]; events: GameEvent[] }
```

**Falta:** `world: World`, `stockpiles: NationStockpiles`, `nationRelations: NationRelations`

**Impacto:** Sin `world` no puede resolver `"any"` comprador. Sin `stockpiles` no puede mover oro/recursos.

### 4.2 `Transaction` tipo incompleto

**Actual:**
```typescript
type Transaction = {
  id: string;
  offers: string[];
  totalGold: number;
  transportCost: number;
  executedAt: number;
  status: "pending" | "completed" | "failed";
};
```

**Falta:** `resourceType: string`, `quantity: number`, `sellerNationId: string`, `buyerNationId: string`

**Impacto:** No se puede reconstruir qué recursos se transfirieron, ni quién vendió a quién.

### 4.3 `buyerNationId: "any"` nunca se resuelve

Cuando una nación vende, `buyerNationId` es `"any"`. En `executeTransactions` nunca se elige un comprador real.

**Solución:** Filtrar `world.nations` por:
- `nationId !== sellerNationId`
- `isNationActive(world, nationId)`
- `!atWar(sellerNationId, nationId)`
- `stockpiles[nationId].gold >= quantity × unitPrice`
- Elegir el de mayor necesidad o mayor gold

### 4.4 Sin validación de stock/oro

`generateOffers` crea ofertas sin verificar:
- ¿El seller tiene `quantity` de `resourceType` en su stockpile?
- ¿El buyer (cuando se resuelva) tiene suficiente oro?

**Solución:** Validar en `generateOffers` o en `executeTransactions` antes de ejecutar.

### 4.5 Mismatch de recursos

| Fuente | Recursos | Cantidad |
|--------|----------|----------|
| `types.ts` `Resource` | grain, timber, iron, coal, oil | 5 |
| `market.ts` `generateOffers` | grain, timber, iron, coal, oil, water, gold, silver, copper | 9 |
| `settlement.ts` `initialResourcesForNation` | grain, timber, coal | 3 |
| `cityEconomy.ts` `monthlyConsumption` | grain, water | 2 |

**Impacto:** `generateOffers` oferta `water`, `gold`, `silver`, `copper` que no existen en `NationStockpile.resources`.

### 4.6 Transporte no aplica costo

`calculateTransportCost` calcula el costo pero `executeTransactions` no lo descarta de ningún stockpile.

### 4.7 `systemSellResource` no está integrado

`systemSellResource` crea `MarketOffer` con `sellerNationId: "system"`, pero nunca se llama desde el pipeline de turno. Solo existe como función aislada.

---

## 5. Arreglos Requeridos

### 5.1 Extender `executeTransactions`

```diff
 export function executeTransactions(
+  world: World,
+  stockpiles: NationStockpiles,
   marketState: MarketState,
   currentTurn: number,
+  nationRelations: NationRelations,
   lang?: EventLang,
 ): { marketState: MarketState; transactions: Transaction[]; events: GameEvent[] }
```

### 5.2 Extender `Transaction` tipo

```diff
 export type Transaction = {
   id: string;
   offers: string[];
   totalGold: number;
   transportCost: number;
   executedAt: number;
   status: "pending" | "completed" | "failed";
+  resourceType: string;
+  quantity: number;
+  sellerNationId: string;
+  buyerNationId: string;
 };
```

### 5.3 Resolver `"any"` comprador

En `executeTransactions`, antes de ejecutar cada oferta:
```typescript
if (offer.buyerNationId === "any") {
  const buyer = world.nations
    .filter(n => n.id !== offer.sellerNationId && isNationActive(world, n.id) && !atWar(offer.sellerNationId, n.id))
    .filter(n => stockpiles[n.id].gold >= offer.quantity * offer.unitPrice)
    .sort((a, b) => (stockpiles[b.id].gold ?? 0) - (stockpiles[a.id].gold ?? 0))[0];
  if (!buyer) continue; // No hay comprador válido
  offer.buyerNationId = buyer.id;
}
```

### 5.4 Transferir oro y recursos

```typescript
const buyer = stockpiles[offer.buyerNationId];
const seller = stockpiles[offer.sellerNationId];
const totalCost = offer.quantity * offer.unitPrice + transportCost;

// Validar
if (buyer.gold < totalCost) { offer.status = "failed"; continue; }
if (seller.resources[offer.resourceType] < offer.quantity) { offer.status = "failed"; continue; }

// Transferir
buyer.gold -= totalCost;
seller.gold += (offer.quantity * offer.unitPrice); // seller no paga transporte
buyer.resources[offer.resourceType] = (buyer.resources[offer.resourceType] || 0) + offer.quantity;
seller.resources[offer.resourceType] -= offer.quantity;
```

### 5.5 Aplicar transporte

- Si `buyerNationId === "system"`: transportCost = 0, sistema no paga
- Si `sellerNationId === "system"`: transportCost = 0, sistema no cobra
- Si ambos son naciones: transportCost descuenta del buyer

### 5.6 Arreglar `generateOffers`

Opción A: Filtrar a los 5 recursos de `Resource` type
Opción B: Extender `Resource` type a 9 recursos y actualizar `NationStockpile`

**Recomendado: Opción A** — limitar `generateOffers` a `Resource` type existente (`grain`, `timber`, `iron`, `coal`, `oil`)

### 5.7 Actualizar llamada en `turnSimulation.ts:1600`

```diff
- const marketEndResult = executeTransactions(current.marketState, nextMonth, lang);
+ const marketEndResult = executeTransactions(
+   world,
+   updatedStockpiles,
+   current.marketState,
+   nextMonth,
+   warUpdate.relations,
+   lang,
+ );
```

### 5.8 Integrar `systemSellResource`

- Llamar `systemSellResource()` dentro de `generateOffers` o en pipeline separado
- O eliminar si no se necesita

---

## 6. Esquema de Flujo Corregido

```
MARKET_START
  → generateOffers(world.nations, turn, seed)
     → Solo recursos válidos (grain, timber, iron, coal, oil)
     → Validar stock del seller antes de crear oferta
     → sellerNationId: nación, buyerNationId: "any"

MARKET_END
  → executeTransactions(world, stockpiles, marketState, turn, relations, lang)
     → Para cada oferta activa:
       1. Resolver "any" → elegir comprador válido
       2. Validar buyer.gold >= totalCost
       3. Validar seller.resources[resourceType] >= quantity
       4. Transferir oro: buyer.gold -= totalCost, seller.gold += unitPrice × quantity
       5. Transferir recurso: buyer.resources[res] += quantity, seller.resources[res] -= quantity
       6. Aplicar transportCost: buyer.gold -= transportCost
       7. Crear Transaction con resourceType, quantity, sellerNationId, buyerNationId
       8. Marcar status: "executed" o "failed"
     → Expired: status = "expired"
```

---

## 7. Archivos a Modificar

| Archivo | Cambio |
|---------|--------|
| `src/world/market.ts` | `executeTransactions` añade `world, stockpiles, relations` params; `Transaction` añade campos; validación de stock/oro; resolución de `"any"`; aplicar transporte |
| `src/world/market.ts` | `generateOffers` filtrar a `Resource` type válido (5 recursos) |
| `src/world/turnSimulation.ts` | Llamada `executeTransactions` pasa `world, updatedStockpiles, warUpdate.relations` |
| `src/world/types.ts` | (Opcional) Extender `Resource` si se quieren 9 recursos |
| `src/world/settlement.ts` | (Opcional) Extender `initialResourcesForNation` para cubrir más recursos |
| `src/world/market.ts` | `systemSellResource` — integrar o marcar como TODO |

---

## 8. Archivos a Crear

| Archivo | Propósito |
|---------|-----------|
| `test/market-execution.test.ts` | Tests para verificar que executeTransactions modifica stockpiles |

---

## 9. Tests Requeridos

```
Test: executeTransactions transfers gold
  - Setup: seller has 1000 gold, buyer has 500 gold
  - Offer: quantity=10, unitPrice=5
  - Expected: seller.gold += 50, buyer.gold -= 50 (+ transport)

Test: executeTransactions transfers resources
  - Setup: seller has grain=100, buyer has grain=10
  - Offer: quantity=10, resourceType="grain"
  - Expected: seller.grain=90, buyer.grain=20

Test: executeTransactions fails when buyer has no gold
  - Setup: buyer.gold = 0
  - Expected: status = "failed", no transfer

Test: executeTransactions fails when seller has no resources
  - Setup: seller.resources.grain = 0
  - Expected: status = "failed", no transfer

Test: "any" buyer resolution
  - Setup: seller sells grain, multiple buyers available
  - Expected: buyer with most gold chosen

Test: transport cost deducted
  - Setup: transportCost = 5
  - Expected: buyer.gold reduced by unitPrice*quantity + 5

Test: generateOffers only uses valid Resource types
  - Expected: only grain, timber, iron, coal, oil

Test: systemSellResource integration
  - Expected: system offer appears in marketState.offers
```

---

## 10. Relación con Otros Specs

| Spec | Relación |
|------|----------|
| `mercado.md` | Este spec es un fix del §3 del mercado.md |
| `llm-vs-internal-ai.md` | El `CartOffer` (LLM) ya funciona con stockpiles. Este fix hace que `MarketOffer` (automático) también funcione |
| `peaceful-expand-flow.md` | `peaceful_expand` cost 1 gold — verificar que el market no rompe esta economía |
| `construction-flow.md` | Construcción consume recursos — verificar que el market puede proveerlos |

---

## 11. Prioridad

| Prioridad | Arreglo | Razón |
|-----------|---------|-------|
| 🔴 Alta | `executeTransactions` reciba `world, stockpiles` | Sin esto el mercado es inútil |
| 🔴 Alta | Transferir oro y recursos | Funcionalidad base perdida |
| 🔴 Alta | Resolver `"any"` buyer | Sin comprador, las ventas no se ejecutan |
| 🟡 Media | Validar stock/oro | Prevenir ofertas inválidas |
| 🟡 Media | Arreglar `Transaction` tipo | Para rastreo y UI |
| 🟡 Media | Arreglar `generateOffers` recursos | Para consistencia de tipos |
| 🟢 Baja | Integrar `systemSellResource` | Feature adicional |
| 🟢 Baja | Tests | Regresión |

---

## 12. Saqueo de Convoyes en Guerra

### 12.1 Descripción

Cuando un convoy (Shipment) en tránsito pasa por una provincia que se encuentra en guerra y hay un grupo militar enemigo en esa misma provincia, existe una probabilidad de saqueo del **60%**. La nación que saquea decide si atacar o no.

### 12.2 Flujo Completo

```
Convoy en tránsito (Shipment) pasa por provincia enemiga
  │
  ├── ¿Hay grupo de guerra enemigo en esa provincia?
  │     │
  │     ├── NO → convoy pasa normalmente
  │     │
  │     └── SÍ → 60% probabilidad de saqueo
  │           │
  │           ├── Decisión: LLM (nación LLM) o motor (IA interna)
  │           │     decide si atacar el convoy
  │           │
  │           ├── NO ataca → convoy pasa normalmente
  │           │
  │           └── ATACA:
  │                 │
  │                 ├── Desvía un grupo militar para saquear
  │                 │   (el grupo queda en "looting" state)
  │                 │
  │                 ├── Recursos + carretas del convoy
  │                 │   → nación saqueadora
  │                 │
  │                 ├── Soldados en saqueo:
  │                 │   ❌ NO participan en combate
  │                 │   ❌ No pueden moverse
  │                 │
  │                 ├── Devuelven al cuartel más cercano
  │                 │
  │                 └── Al llegar a cuartel:
  │                       todo sumado a arcas de la nación
  │                       (recursos + carretas)
  │
  └── Ruta alternativa:
        Dar vuelta más larga evitando provincias en guerra
        → Más lento pero seguro
        → Decisión: LLM o motor evalúa costo-beneficio
```

### 12.3 Probabilidades

| Situación | Probabilidad de saqueo |
|-----------|------------------------|
| Convoy en provincia enemiga con grupo de guerra | **60%** |
| Convoy en ruta segura (sin guerra) | **0%** |
| Convoy en provincia aliada o neutral | **0%** |
| Convoy con escort militar propio | Reducida (por definir) |

### 12.4 Decisión de Saqueo

**¿Quién decide atacar?**
- **Nación LLM** (Aurora, Verdant, Sol): La IA evalúa si saquear convoyes enemigos merece la pena
- **Nación IA interna** (Lumen, Ember, Cobalt): El motor decide automáticamente según necesidad de recursos

**Factores de decisión:**
- Recursos disponibles en el convoy
- Cantidad de carretas saqueadas vs riesgo
- Estado actual de la nación (¿necesita recursos?)
- Capacidad militar para desviar un grupo

### 12.5 Mecánica del Saqueo

```typescript
// Cuando el convoy entra en provincia en guerra con enemigo
if (provinceInWar && enemyGroupExists && Math.random() < 0.6) {
  // Decisión de atacar
  const shouldAttack = decideToLoot(nationId, shipment);
  
  if (shouldAttack) {
    // Desviar grupo para saquear
    const lootGroup = findNearestAvailableGroup(nationId, provinceId);
    lootGroup.isLooting = true;
    lootGroup.lootReturnTo = findNearestBarracks(nationId, provinceId);
    
    // Calcular saqueo
    const lootedCarts = Math.floor(shipment.carts * 0.5); // 50% de carretas
    const lootedResources = extractResources(shipment);
    
    // Marcar convoy como atacado
    shipment.isUnderAttack = true;
    shipment.lootedBy = nationId;
    shipment.lootedCarts = lootedCarts;
    
    // Recursos van a la nación saqueadora (temporalmente)
    // Se suman a arcas al volver al cuartel
  }
}
```

### 12.6 Estados del Grupo en Saqueo

| Estado | Descripción |
|--------|-------------|
| `idle` | Grupo normal, puede luchar/moverse |
| `looting` | Grupo saqueando, NO puede combatir ni moverse |
| `returning` | Grupo volviendo al cuartel con el botín |
| `restocked` | Grupo de vuelta, recurso sumado a arcas, vuelve a `idle` |

### 12.7 Cambios en Datos del Código

**`src/world/types.ts`** — `Shipment` type:
```diff
 export type Shipment = {
   id: string;
   nationId: string;
   fromProvinceId: string;
   toProvinceId: string;
   toNationId?: string;
   carts: number;
   departsMonth: number;
   arrivesMonth: number;
   pricePerCart: number;
+ isUnderAttack?: boolean;
+ lootedBy?: string;
+ lootedCarts?: number;
 };
```

**`src/world/types.ts`** — `ArmyGroup` type:
```diff
 export type ArmyGroup = {
   id: string;
   nationId: string;
   locationProvinceId: string;
   units: ArmyUnits;
   carts?: number;
   convoy?: boolean;
+ isLooting?: boolean;
+ lootReturnTo?: string;
+ lootReturnMonth?: number;
 };
```

**`src/world/types.ts`** — `Tile` type (ya existe `lostCarts`):
```diff
  lostCarts?: number;
+ lootedResources?: Record<string, number>;
```

### 12.8 Lógica de Devolución al Cuartel

```typescript
function returnLoot(group: ArmyGroup, world: World): void {
  const barracks = findNearestBarracks(group.nationId, group.locationProvinceId);
  if (!barracks) return;
  
  group.lootReturnTo = barracks.provinceId;
  group.isLooting = false;
  group.lootReturnMonth = currentTurn + provinceHops(world, group.locationProvinceId, barracks.provinceId);
}

function collectLoot(group: ArmyGroup, stockpiles: NationStockpiles, world: World): void {
  const barracks = world.provinceById.get(group.lootReturnTo);
  if (!barracks) return;
  
  // Sumar recursos a arcas
  const stock = stockpiles[group.nationId];
  if (stock && group.lootedCarts) {
    stock.resources = group.lootedCarts; // Simplificado: carretas = recursos
    // Evento: "recursos sumados a arcas"
  }
  
  group.isLooting = false;
  group.lootReturnTo = undefined;
}
```

### 12.9 Eventos de Juego

```typescript
// Evento de saqueo
{
  id: `event-cart-loot-war-${month}`,
  month: currentTurn,
  kind: "cart_loot_war",
  title: "⚔️ Saqueo de Convoy",
  description: "Nation A saqueó el convoy de Nation B en province X. N grupos en misión de saqueo.",
  nationIds: [looterNationId, victimNationId],
}

// Evento de retorno de saqueo
{
  id: `event-cart-loot-return-${month}`,
  month: currentTurn,
  kind: "cart_loot_return",
  title: "✅ Saqueo Completado",
  description: "N grupos volvieron al cuartel. Recursos sumados a arcas.",
  nationIds: [looterNationId],
}

// Evento de grupo en saqueo
{
  id: `event-cart-loot-active-${month}`,
  month: currentTurn,
  kind: "cart_loot_active",
  title: "🔄 Grupo en Saqueo",
  description: "N grupos de Nation A están saqueando en province X. No pueden combatir.",
  nationIds: [looterNationId],
}
```

### 12.10 Integración con Pipeline de Turno

```
advanceTurn() pipeline actualizado:
  
  [MARKET_START]
    → generateOffers()
    → LLM decide cartOffer/cartMove/acceptCartOfferId
  
  [HUNGER]
    → Consumo de recursos
  
  [EXTRACTION]
    → Producción dinámica
  
  [ACTING]
    → Ejecutar acciones de naciones
  
  [RESOLVING]
    → Resolver guerras
    → Movimiento de ejércitos
    → ✅ SAQUEO DE CONVOYES (nuevo paso)
      → Verificar convoyes en provincias en guerra
      → 60% probabilidad de detección
      → Decisión de ataque (LLM o motor)
      → Ejecutar saqueo si aplica
  
  [CONSTRUCTION]
    → Progreso de construcciones
  
  [CART_TRADE]
    → advanceCartTrade()
    → ✅ GRUPOS EN SAQUEO devuelven al cuartel
      → Sumar recursos a arcas
  
  [MARKET_END]
    → executeTransactions()
  
  → elapsedMonths += 1
```

### 12.11 Archivos a Modificar

| Archivo | Cambio |
|---------|--------|
| `src/world/types.ts` | `Shipment` añade `isUnderAttack, lootedBy, lootedCarts`. `ArmyGroup` añade `isLooting, lootReturnTo, lootReturnMonth`. `Tile` añade `lootedResources` |
| `src/world/turnSimulation.ts` | Nuevo paso en pipeline: verificar convoyes en guerra y ejecutar saqueo (60%). Lógica de retorno al cuartel. Eventos de saqueo |
| `src/world/war.ts` | Nueva función `decideToLoot()`, `findNearestBarracks()`, `collectLoot()`. Integración con grupos en `looting` state |
| `src/world/carts.ts` | `Shipment` type actualizado con campos de ataque |
| `src/world/llmExecutor.ts` | Prompt con info de convoyes en guerra cercanos y decisión de saquear |
| `src/world/policyAI.ts` | `PolicyDirection` con `lootConvoy?: boolean` para IA interna |

### 12.12 Tests Requeridos

```
Test: convoy looted when passing through war province
  - Setup: shipment passes through province with enemy group
  - Expected: 60% chance of loot event triggered

Test: convoy NOT looted in safe province
  - Setup: shipment in province without war
  - Expected: no loot event

Test: loot decision by LLM
  - Setup: LLM nation with low gold resources
  - Expected: LLM decides to loot convoy

Test: loot decision by internal AI
  - Setup: internal AI nation with low gold resources
  - Expected: engine decides to loot

Test: loot group cannot fight
  - Setup: group.isLooting = true
  - Expected: group cannot be assigned to combat orders

Test: loot return to barracks
  - Setup: group.lootReturnTo = nearest barracks province
  - Expected: group returns, resources added to stock

Test: resources added to treasury
  - Setup: group returns with looted carts
  - Expected: stockpiles[nationId].resources += lootedCarts

Test: route avoidance
  - Setup: LLM chooses longer route to avoid war
  - Expected: shipment avoids war provinces

Test: 60% probability over many convoys
  - Setup: 100 convoys through war province
  - Expected: approximately 60 loot events
```

### 12.13 Prioridad

| Prioridad | Arreglo | Razón |
|-----------|---------|-------|
| 🔴 Alta | Pipeline paso de saqueo en `turnSimulation.ts` | Sin esto los convoyes no son vulnerables |
| 🔴 Alta | 60% probabilidad + detección | Mecánica central |
| 🔴 Alta | Devolución al cuartel + arcas | Sin esto el botín se pierde |
| 🟡 Media | `ArmyGroup.isLooting` state | Para que el grupo no lute |
| 🟡 Media | `Shipment` fields para tracking | Para reconstruir eventos |
| 🟡 Media | LLM prompt con convoyes | Para que LLM pueda decidir saquear |
| 🟢 Baja | Route avoidance | Feature estratégica |
| 🟢 Baja | Tests | Regresión |
