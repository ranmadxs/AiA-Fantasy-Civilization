# Decisión por Actor

| Decisión | ¿LLM? | ¿Motor? | 🧠 IA Interna |
|----------|--------|---------|----------------|
| `expansion` (peaceful_expand/control_city/none) | ✅ Sí | — | ✅ Cada 2 meses |
| `economy` (army_building/construction/recovery) | ✅ Sí | — | ✅ Cada 2 meses |
| `diplomacy` (declare_war/seek_alliance/seek_peace) | ✅ Sí | — | ✅ Cada 2 meses |
| `era` (advance_era/skip_dark/stay) | ✅ Sí | — | ✅ Cada 2 meses |
| `cartMove` (traslado entre provincias) | ✅ Sí | — | ❌ No |
| Provincia objetivo a atacar (`targetProvinceId`) | ✅ Sí (validada: enemiga en guerra + atacable, con fallback automático) | ✅ `pickTargetProvince` (score frontera) | ✅ Automático |
| Tropas por provincia (asignación) | ❌ | ✅ `createArmyGroupFromBestCity` | ❌ No |
| Movimiento de tropas | ❌ | ✅ `moveArmyGroups` | ❌ No |
| Stance (attack/defend/garrison) | ❌ | ✅ Automático | ❌ No |
| `declare_war` (dispara guerra) | ✅ Sí | — | ✅ Cada 2 meses |
| Cantidad de ejército (policy) | ✅ Sí | — | ✅ Cada 2 meses |
| Recrutamiento de unidades | ❌ | ✅ `queueRecruitmentForPolicy` | ❌ No |
