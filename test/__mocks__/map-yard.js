module.exports = {
  parseBiomeMap: () => ({ biomeMap: {}, tileSize: 10, cols: 0, rows: 0 }),
  buildTolkienSVG: () => "<svg></svg>",
  createRNG: () => () => Math.random(),
};
