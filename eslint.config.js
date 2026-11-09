export default [
  {
    files: ["src/**/*.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        browser: "readonly",
        crypto: "readonly",
        indexedDB: "readonly",
        FileReader: "readonly",
        Image: "readonly",
        MutationObserver: "readonly",
        navigator: "readonly",
        performance: "readonly",
        window: "readonly",
        console: "readonly",
        document: "readonly",
        globalThis: "readonly",
        requestAnimationFrame: "readonly",
        setTimeout: "readonly",
      },
    },
    rules: {
      eqeqeq: ["error", "always"],
      "no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      "no-undef": "error",
      "no-var": "error",
      "prefer-const": "error",
      semi: ["error", "always"],
      curly: ["error", "all"],
    },
  },
];
