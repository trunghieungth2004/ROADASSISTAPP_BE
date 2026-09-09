module.exports = {
  testEnvironment: "node",
  rootDir: ".",
  preset: "ts-jest",
  moduleFileExtensions: [
    "ts",
    "js",
    "json",
  ],
  testMatch: [
    "<rootDir>/test/integration/**/*.test.ts",
  ],
  setupFiles: [
    "<rootDir>/test/setup/integration.ts",
  ],
  testTimeout: 30000,
  forceExit: true,
  maxWorkers: 1,
};
