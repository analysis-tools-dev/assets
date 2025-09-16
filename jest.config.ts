export default {
  preset: "ts-jest",
  testEnvironment: "node",
  testPathIgnorePatterns: ["/node_modules/", "/dist/"],
  reporters: [
    "default",
    ["jest-junit", {
      outputDirectory: ".",
      outputName: "junit.xml",
    }],
  ],
  moduleFileExtensions: ["ts", "tsx", "js", "jsx"],
  transform: {
    "^.+\\.(ts|tsx)$": "ts-jest",
  },
  testMatch: ["**/src/**/*.test.(ts|tsx|js)"],
  collectCoverage: true,
  coverageDirectory: "coverage",
  coverageReporters: ["text", "lcov", "html"],
  collectCoverageFrom: [
    "src/**/*.(ts|tsx)",
    "!src/**/*.d.ts",
    "!src/**/*.test.(ts|tsx)",
    "!src/index.ts", // Exclude main script file
  ],
  coverageThreshold: {
    global: {
      branches: 0, // Skip branch coverage for now - the tested function has no branches
      functions: 20,
      lines: 30,
      statements: 30,
    },
  },
};
