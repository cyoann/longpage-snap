import { DEFAULT_SETTINGS, normalizeSettings } from "../src/settings.js";

const form = document.getElementById("preferences");
const status = document.getElementById("status");
const fieldNames = [
  "language", "format", "mode", "limits", "maxWidth", "maxHeight", "maxFileMiB", "quality",
];
const t = (key, vars = {}) => {
  const selected = form.elements.namedItem("language").value;
  const detected = browser.i18n.getUILanguage?.() || navigator.language || "en";
  return globalThis.LongPageSnapLocales.get(key, selected, detected, vars);
};

function localize() {
  const selected = form.elements.namedItem("language").value;
  const detected = browser.i18n.getUILanguage?.() || navigator.language || "en";
  const locale = globalThis.LongPageSnapLocales.locale(selected, detected);
  document.documentElement.lang = locale;
  document.title = "LongPage Snap · " + t("settingsTitle");
  for (const element of document.querySelectorAll("[data-i18n]")) {
    element.textContent = t(element.dataset.i18n);
  }
}

function readForm() {
  return normalizeSettings(Object.fromEntries(
    fieldNames.map((key) => [key, form.elements.namedItem(key).value])
  ));
}

function populate(settings) {
  for (const key of fieldNames) {
    form.elements.namedItem(key).value = settings[key];
  }
  localize();
  updateDisplay();
}

function updateDisplay() {
  const format = form.elements.namedItem("format").value;
  const mode = form.elements.namedItem("mode").value;
  const limits = form.elements.namedItem("limits").value;
  const custom = mode !== "automatic";
  const dimensions = custom && limits !== "fileSize";
  const filesize = custom && limits !== "dimensions";

  document.getElementById("quality-field").hidden = format === "png";
  document.getElementById("quality-value").textContent =
    form.elements.namedItem("quality").value + "%";

  const description = document.getElementById("mode-description");
  const hint = mode === "single" ? "modeSingleHint" :
    mode === "split" ? "modeSplitHint" : "modeAutomaticHint";
  description.dataset.i18n = hint;
  description.textContent = t(hint);

  document.getElementById("custom-limits").hidden = !custom;
  document.getElementById("dimensions-fields").hidden = !dimensions;
  document.getElementById("width-field").hidden = !dimensions;
  document.getElementById("height-field").hidden = !dimensions;
  document.getElementById("filesize-field").hidden = !filesize;
  for (const key of ["maxWidth", "maxHeight"]) {
    form.elements.namedItem(key).disabled = !dimensions;
  }
  form.elements.namedItem("maxFileMiB").disabled = !filesize;
  form.elements.namedItem("limits").disabled = !custom;
}

function showSaveError(error) {
  status.textContent = t("settingsError") +
    (error?.message ? ": " + error.message : "");
}

async function initialize() {
  const saved = await browser.storage.local.get("settings");
  populate(normalizeSettings(saved.settings));
}

form.addEventListener("input", (event) => {
  if (event.target.name === "language") {
    localize();
  }
  updateDisplay();
});
form.addEventListener("change", (event) => {
  if (event.target.name === "language") {
    localize();
  }
  updateDisplay();
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!form.reportValidity()) {
    return;
  }
  try {
    await browser.storage.local.set({ settings: readForm() });
    status.textContent = t("savedSettings");
  } catch (error) {
    showSaveError(error);
  }
});

document.getElementById("reset").addEventListener("click", async () => {
  try {
    await browser.storage.local.set({ settings: { ...DEFAULT_SETTINGS } });
    populate(DEFAULT_SETTINGS);
    status.textContent = t("savedSettings");
  } catch (error) {
    showSaveError(error);
  }
});

void initialize().catch(showSaveError);
