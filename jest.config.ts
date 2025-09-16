export default {
  preset: "ts-jest",
  testEnvironment: "node",
  testPathIgnorePatterns: ["/node_modules/", "/dist/"],
  reporters: ["default"],
  moduleFileExtensions: ["ts", "tsx", "js", "jsx"],
  transform: {
    "^.+\\.(ts|tsx)$": "ts-jest",
  },
  testMatch: ["**/src/**/*.test.(ts|tsx|js)"],
  collectCoverageFrom: ["src/**/*.(ts|tsx)", "!src/**/*.d.ts"],
};
