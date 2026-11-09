import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function readJSON(path) {
  return JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));
}

const english = readJSON("../_locales/en/messages.json");
const french = readJSON("../_locales/fr/messages.json");
const manifest = readJSON("../manifest.json");

test("English and French catalogs have matching nonempty keys", () => {
  assert.deepEqual(Object.keys(english).sort(), Object.keys(french).sort());
  for (const [key, entry] of Object.entries(english)) {
    assert.ok(entry.message.trim(), key + " has empty English text");
    assert.ok(french[key].message.trim(), key + " has empty French text");
  }
});

test("localization catalogs preserve interpolation variables", () => {
  for (const [key, entry] of Object.entries(english)) {
    const variables = (text) =>
      [...text.matchAll(/\{([a-z]+)\}/gi)].map((match) => match[1]).sort();
    assert.deepEqual(
      variables(entry.message),
      variables(french[key].message),
      key + " has inconsistent interpolation parameters",
    );
  }
});

test("manifest registers localized options and storage", () => {
  assert.equal(manifest.default_locale, "en");
  assert.equal(manifest.name, "__MSG_extensionName__");
  assert.equal(manifest.options_ui.page, "options/options.html");
  assert.ok(manifest.permissions.includes("storage"));
});
