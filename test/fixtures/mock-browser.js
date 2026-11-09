(() => {
  // Test-only Firefox facade. It is never bundled into the extension.
  const original = Element.prototype.attachShadow;
  Element.prototype.attachShadow = function (options) {
    return original.call(this, { ...options, mode: "open" });
  };

  const settings = {
    language: "fr", format: "jpeg", mode: "split",
    limits: "both", maxWidth: 2048, maxHeight: 4096,
    maxFileMiB: 8, quality: 86,
  };
  window.browser = {
    i18n: { getUILanguage: () => "en-US" },
    storage: { local: {
      get: async () => ({ settings }),
      set: async () => {},
    } },
    runtime: {
      onMessage: { addListener(callback) { window.captureMessage = callback; } },
      async sendMessage() { return { accepted: true }; },
    },
  };
})();
