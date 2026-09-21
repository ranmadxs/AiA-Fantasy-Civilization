# Flujo de Peaceful Expand

| Paso | Descripción | ¿LLM? | ¿Motor? | 🧠 IA Interna |
|------|-------------|--------|---------|----------------|
| 1 | LLM decide `expansion: "peaceful_expand"`, `targetNationId: null` | ✅ | — | — |
| 2 | `applyDecisionToWorld` guarda `nationPolicies.expansion = { policy: "peaceful_expand" }` | — | ✅ | ✅ Cada 2 meses |
| 3 | `resolveTurn` llama a `executePeacefulExpansion()` | — | ✅ | — |
| 4 | Filtra provincias **adyacentes** con `nationId === undefined` (neutras) | — | ✅ `getAdjacentTiles` | — |
| 5 | Si no hay adyacentes → `findNearestFreeTile` (fallback) | — | ✅ | — |
| 6 | Calcula costo escalado: `peacefulExpandCostFor(n, fromStable, eraDiscount)` | — | ✅ | — |
| 7 | Si `gold < cost` → salta provincia | — | ✅ | ✅ Cada 2 meses (policy) |
| 8 | `province.nationId = nationId` — cambia dueño | — | ✅ | — |
| 9 | `annexProvinceCities`: solo ciudades **sin nación activa** cambian de dueño (+ evento `Anexión pacífica`); las de naciones activas se respetan y sus tiles se excluyen | — | ✅ | — |
| 10 | `nationStockpile.gold -= cost` | — | ✅ | — |
| 11 | `reserveTiles()` — reserva tiles para construcción | — | ✅ | — |
| 12 | Genera evento `peaceful_expand — colonizó X por Y oro` | — | ✅ | — |
| 13 | Próximo turno: nueva provincia en `ownedProvinces` → disponible para construcción | — | ✅ | ✅ Cada 2 meses |

## Restricciones clave

- Solo provincias **adyacentes** a territorio propio (o `findNearestFreeTile` como fallback)
- Solo provincias con `nationId === undefined` (neutras) — NO enemigas
- Cada nueva ciudad cuesta más: 1, 1.25, 1.5, 1.75, 2...
- Máximo de expansiones por turno: 2-4 según establos vecinos
- `peaceful_expand` no inicia guerra, nunca ataca
