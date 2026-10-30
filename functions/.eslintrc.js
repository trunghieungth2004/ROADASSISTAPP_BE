module.exports = {
  root: true,
  env: {
    es6: true,
    node: true,
  },
  extends: [
    "eslint:recommended",
    "plugin:import/errors",
    "plugin:import/warnings",
    "plugin:import/typescript",
    "google",
    "plugin:@typescript-eslint/recommended",
  ],
  parser: "@typescript-eslint/parser",
  parserOptions: {
    project: ["tsconfig.eslint.json"],
    sourceType: "module",
  },
  ignorePatterns: [
    "/lib/**/*",
    "/generated/**/*",
    "/test-report/**/*",
    ".eslintrc.js",
  ],
  plugins: [
    "@typescript-eslint",
    "import",
  ],
  rules: {
    "quotes": ["error", "double"],
    "require-jsdoc": 0,
    "import/no-unresolved": 0,
    "indent": ["error", 2],
    "@typescript-eslint/no-explicit-any": 1,
    "max-lines": ["error", {"max": 800, "skipBlankLines": true, "skipComments": true}],
    "max-lines-per-function": ["error", {"max": 250, "skipBlankLines": true, "skipComments": true}],
    "complexity": ["error", 30],
  },
  overrides: [
    {
      files: ["test/**/*.ts"],
      rules: {
        "max-lines": "off",
        "max-lines-per-function": "off",
        "complexity": "off",
      },
    },
    {
      files: ["service/dispatch/tickets/transition.ts"],
      rules: {
        "max-lines-per-function": "off",
        "complexity": "off",
      },
    },
    {
      files: [
        "service/dispatch/accept.ts",
        "service/dispatch/tickets/create.ts",
        "service/dispatch/tickets/destination.ts",
        "service/dispatch/tickets/read.ts",
        "service/dispatch/tickets/tow.ts",
        "service/dispatch/shop/feed.ts",
        "service/dispatch/shop/mobile.ts",
        "service/dispatch/shop/estimate.ts",
        "service/provider/crud.ts",
        "service/push/service.ts",
      ],
      rules: {"complexity": "off"},
    },
    {
      files: ["*.js"],
      parser: "espree",
      parserOptions: {
        ecmaVersion: 2020,
      },
      rules: {
        "@typescript-eslint/no-require-imports": "off",
      },
    },
  ],
};
