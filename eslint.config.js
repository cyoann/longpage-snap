export default [
  {
    files: ["src/**/*.js", "test/**/*.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        browser: "readonly",
        document: "readonly",
        window: "readonly",
        globalThis: "readonly",
        requestAnimationFrame: "readonly",
        HTMLAnchorElement: "readonly",
      },
    },
    rules: {
      "eqeqeq": ["error", "always"],
      "no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      "no-undef": "error",
      "no-var": "error",
      "prefer-const": "error",
      "semi": ["error", "always"],
      "curly": ["error", "all"],
    },
  },
];
