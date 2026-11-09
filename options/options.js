import { DEFAULT_SETTINGS, normalizeSettings } from "../src/settings.js";

const form = document.getElementById("preferences");
const status = document.getElementById("status");
const fields = [
  "format", "mode", "limits", "maxWidth", "maxHeight", "maxFileMiB", "quality",
];

function localize() {
  const language = browser.i18n.getUILanguage();
  document.documentElement.lang = language.startsWith("fr") ? "fr" : "en";
  document.title = "LongPage Snap · " + browser.i18n.getMessage("settingsTitle");
  for (const element of document.querySelectorAll("[data-i18n]")) {
    const message = browser.i18n.getMessage(element.dataset.i18n);
    if (message) {
      element.textContent = message;
    }
  }
}

function readForm() {
  return normalizeSettings(Object.fromEntries(
    fields.map((key) => [key, form.elements.namedItem(key).value])
  ));
}

function populate(settings) {
  for (const key of fields) {
    form.elements.namedItem(key).value = settings[key];
  }
  updateDisplay();
}

function updateDisplay() {
  const format = form.elements.namedItem("format").value;
  const mode = form.elements.namedItem("mode").value;
  const limits = form.elements.namedItem("limits").value;

  document.getElementById("quality-field").hidden = format === "png";
  document.getElementById("quality-value").textContent =
    form.elements.namedItem("quality").value + "%";
  document.getElementById("single-hint").hidden = mode !== "single";
  document.getElementById("width-field").hidden = limits === "fileSize";
  document.getElementById("height-field").hidden = limits === "fileSize";
  document.getElementById("filesize-field").hidden = limits === "dimensions";
}

async function initialize() {
  localize();
  const saved = await browser.storage.local.get("settings");
  populate(normalizeSettings(saved.settings));
}

form.addEventListener("input", updateDisplay);
form.addEventListener("change", updateDisplay);

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!form.reportValidity()) {
    return;
  }
  try {
    await browser.storage.local.set({ settings: readForm() });
    status.textContent = browser.i18n.getMessage("savedSettings");
  } catch (error) {
    status.textContent = browser.i18n.getMessage("settingsError") +
      " " + (error?.message ?? "");
  }
});

document.getElementById("reset").addEventListener("click", () => {
  populate(DEFAULT_SETTINGS);
  status.textContent = "";
});

void initialize().catch((error) => {
  status.textContent = browser.i18n.getMessage("settingsError") +
    " " + (error?.message ?? "");
});
