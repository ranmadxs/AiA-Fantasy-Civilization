/**
 * @aia/map-yard — único entry que debe usar AiA.
 * Todo lo copiado desde map-yard vive aquí; nada en src/ importa rutas fuera del plugin.
 */

export {
  hexToRgb,
  rgba,
  mix,
  collectBorderEdges,
  featherEdge,
  grassFringe,
  mossFringe,
  waterBlend,
  snowFeather,
  transitionLayer,
  pairKind,
  waterFeather,
} from './src/edgeBlend.js';

export {
  createRNG as createTolkienRNG,
  parseBiomeMap as parseTolkienBiomes,
  buildTolkienSVG,
  layerRealRivers,
  PALETTE_AIA,
  runTolkienCLI,
} from './src/tolkienFilter.js';

// Aliases genéricos (los que usa svg_generate.mjs)
export {
  createRNG as createRNG,
  parseBiomeMap as parseBiomeMap,
} from './src/tolkienFilter.js';

export {
  createRNG as createReliefRNG,
  parseBiomeMap as parseReliefBiomes,
  buildEnhancedSVG as buildReliefSVG,
  skipFills as reliefSkipFills,
  runReliefCLI,
} from './src/reliefFilter.js';

export {
  createRNG as createMapRNG,
  generateContinentalMap,
  generateSVGContinental,
  generateBaseHTML,
  generateMap,
  classifyBiome,
  biomeColors as mapBiomeColors,
  DEFAULT_TILE_SIZE,
  runGenerateMapCLI,
} from './src/generateMap.js';
