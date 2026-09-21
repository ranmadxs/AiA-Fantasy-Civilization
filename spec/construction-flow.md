# Flujo de Construcción

| Paso | Qué ocurre | ¿LLM? | ¿Motor? | 🧠 IA Interna |
|------|------------|--------|---------|----------------|
| 1 | LLM decide `economy: "construction"` + opcional `constructionIntent` (pueblo/ciudad/reino/auto) | ✅ | — | ✅ Cada 2 meses |
| 2 | `applyDecisionToWorld` guarda `nationPolicies.economy = { policy: "construction" }` | — | ✅ | ✅ |
| 3 | `resolveTurn` llama a `advanceConstruction()` cada turno | — | ✅ | — |
| 4 | Verifica `nationPolicies[nation.id]?.economy?.policy === "construction"` | — | ✅ | — |
| 5 | Si hay proyecto `status === "building"` → SALTA (uno a la vez) | — | ✅ | — |
| 6 | Itera cadena: `barracks → granja → stable → obra → ... → ciudad → reino → carreta` | — | ✅ `orderedChain` | — |
| 7 | Para cada tipo: verifica `isKindUnlockedByEra(kind, nationEra)` | — | ✅ | — |
| 8 | Busca provincia con ciudad propia sin edificio completado | — | ✅ `ownedProvinces` | — |
| 9 | Calcula costo + recursos necesarios | — | ✅ | — |
| 10 | Si alcanza la 1ª cuota (oro **y** recursos / turnos) → crea `ConstructionProject` (`canAffordFirstQuota`) | — | ✅ | — |
| 11 | `reserveTiles(provinceId, footprint, project.id)` — reserva tiles | — | ✅ | — |
| 12 | Cada turno siguiente: cobra la cuota (`chargeConstructionTurn`); sin fondos → `stalled` + evento `⏸️`, se retoma al haber fondos | — | ✅ | — |
| 13 | Al terminar: obra/ciudad sube nivel o funda ciudad; resto crea instalación (mina/granja/pozo/fábrica/reino) con su producción y nivel | — | ✅ | — |

## Cadena de prioridad (`orderedChain`)

| `constructionIntent` | Orden de construcción |
|---------------------|----------------------|
| `"auto"` | barracks → granja → stable → obra → minas → aserradero → pozo → hierro → fábrica → ciudad → reino → carreta |
| `"pueblo"` | obra primero → luego el resto |
| `"ciudad"` | ciudad primero → luego el resto |
| `"reino"` | reino primero → luego el resto |

## Restricciones clave

- Solo 1 proyecto activo por nación a la vez
- Cada tipo se construye una vez por provincia con ciudad (**salvo**: mejoras de nivel, carretas repetibles, obra-desarrollo)
- Requiere `economy.policy === "construction"`
- `barracks` y `establo` gatean unidades militares
- `ciudad` necesita provincia con tile libre
- `reino` requiere `isReinoEra` + 10+ nación ciudades + 2+ en provincia
- `carreta` requiere `establo niv.3` — ⚠️ **hoy inalcanzable** (tope niv.2): pendiente decidir niv.2 o implementar niv.3
- **Mejoras**: establo→niv.2 (ciudad niv.2 + 3 tiles adyacentes), granja→niv.10 (+1 tile/nivel), pozo→niv.5 (sin tiles extra, `pozoSpotEligible`: tile libre sin veta)
- **Caravana fundadora**: origen ≥100 hab, llegan 90-100 (muertos/desertores en viaje)
- **Crecimiento**: +1 tile/nivel (granja) vía construcción; terminar obra sube `mapRevision` (refresca el mapa)
- **Mantención**: minas/granjas/pozos pagan oro por turno en el loop de producción; sin pago se pausan (`activa: false`)

## Footprint de construcción (`BUILDING_TILE_FOOTPRINT`)

| Tipo | Footprint | Descripción |
|------|-----------|-------------|
| obra (pueblo) | 1 | 1 tile, se reserva al fundar |
| barracks (cuartel) | 1 | 1 tile |
| granja | 1 | 1 tile |
| stable (establo) | 1 | 1 tile |
| mina_carbon | 20 | 20 tiles industriales |
| aserradero | 1 | 1 tile |
| pozo | 1 | 1 tile |
| mina_hierro | 20 | 20 tiles industriales |
| fabrica_armas | 1 | 1 tile |
| ciudad | 15 | 15 tiles urbanos |
| reino | 20 | 20 tiles de vasallaje |
| carreta | 0 | No ocupa tile |
