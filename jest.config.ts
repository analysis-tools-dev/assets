export default {
  preset: "ts-jest/presets/default-esm",
  testEnvironment: "node",
  testPathIgnorePatterns: ["/node_modules/"],
  reporters: ["default"],
  globals: { "ts-jest": { diagnostics: false, useESM: true } },
  transform: {},
};
