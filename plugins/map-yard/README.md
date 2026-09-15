# @aia/map-yard

Plugin de mapas fantasy para AiA-Fantasy-Civilization. Copia adaptada a ESM puro desde `map-yard/script/` (sin symlinks, sin `require`, sin CLI globals en import).

## Contenido

- `src/edgeBlend.js` — servicio de degradado HD (`transitionLayer`, `waterFeather`). Origen `lib/edge-blend.js`.
- `src/tolkienFilter.js` — overlay estilo libro Tolkien. Origen `tolkien_filter.js`.
- `src/reliefFilter.js` — overlay relieve geográfico. Origen `relief_filter.js`.
- `src/generateMap.js` — generador base continente. Origen `generate_map.js`.
- `index.js` — barrel, único import que debe usar AiA.

## Firmas

```js
import { parseBiomeMap, buildTolkienSVG, createRNG, generateMap } from '../plugins/map-yard/index.js';

// Base AiA (SVG pelado, solo terreno):
const parsed = parseBiomeMap(baseHtml); // ts por moda, ignora #132028/#1a5276/#ffffff/#88c8f8
const rng = createRNG(42);
const out = buildTolkienSVG(baseHtml, parsed.biomeMap, parsed.tileSize, rng, '42', { width, height });

// Base map-yard:
const { svg, html } = generateMap({ seed: 42, width: 1920, height: 1080, tileSize: 8 });
```

## Notas

- `PALETTE_AIA`: mapea colores AiA (`#315f8f` ocean, `#4a89a8` ocean/coast, `#2e7d9e` lake, `#88a95f` plain, `#477457` forest, `#9a8d65` mountain/hill, `#7d7f85` mountain, `#c9b06b` desert).
- `parseBiomeMap` detecta `tileSize` por moda para no envenenarse con el rect de fondo full-canvas.
- `buildTolkienSVG` / `buildEnhancedSVG` reciben `{ width, height }` por opts (no globals).
- CLI standalone preservado: `node src/tolkienFilter.js --source f.html [--seed N] [--width N] [--height N]`.
