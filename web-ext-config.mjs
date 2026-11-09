export default {
  ignoreFiles: [
    "test/**",
    "README.md",
    "LICENSE",
    "package*.json",
    "eslint.config.js",
    "web-ext-config.mjs",
  ],
  build: {
    overwriteDest: true,
  },
  lint: {
    warningsAsErrors: true,
  },
};
