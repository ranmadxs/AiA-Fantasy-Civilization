module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/test'],
  testMatch: ['**/*.test.ts'],
  moduleNameMapper: {
    '^../../plugins/map-yard/index\\.js$': '<rootDir>/test/__mocks__/map-yard.js',
  },
};
