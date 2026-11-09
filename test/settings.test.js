import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_SETTINGS,
  chooseOutputScale,
  extensionFor,
  mimeType,
  normalizeSettings,
  useFileLimit,
} from "../src/settings.js";

test("normalizes incomplete and invalid preferences", () => {
  assert.deepEqual(normalizeSettings(null), DEFAULT_SETTINGS);
  assert.equal(normalizeSettings({ format: "pdf" }).format, "jpeg");
  assert.equal(normalizeSettings({ maxHeight: -1 }).maxHeight, DEFAULT_SETTINGS.maxHeight);
  assert.equal(normalizeSettings({ maxWidth: "2048" }).maxWidth, 2048);
});

test("maps output extensions and MIME types", () => {
  assert.equal(extensionFor("jpeg"), "jpg");
  assert.equal(extensionFor("webp"), "webp");
  assert.equal(mimeType("png"), "image/png");
});

test("single-image mode scales a full page within memory and dimensions", () => {
  const plan = chooseOutputScale({
    inputWidth: 1080,
    pageWidth: 360,
    pageHeight: 6000,
    imageHeight: 600,
    memoryBudgetBytes: 16 * 1024 * 1024,
    settings: { ...DEFAULT_SETTINGS, mode: "single" },
  });
  assert.ok(plan.width >= 240);
  assert.ok(plan.width <= DEFAULT_SETTINGS.maxWidth);
  assert.ok(plan.segmentMaxHeight <= DEFAULT_SETTINGS.maxHeight);
  assert.ok(4 * plan.width * plan.segmentMaxHeight <= 16 * 1024 * 1024 + 32768);
  assert.equal(plan.single, true);
});

test("unreadably tall single-image export fails explicitly", () => {
  assert.throws(() => chooseOutputScale({
    inputWidth: 1080,
    pageWidth: 360,
    pageHeight: 200000,
    imageHeight: 600,
    memoryBudgetBytes: 8 * 1024 * 1024,
    settings: { ...DEFAULT_SETTINGS, mode: "single" },
  }), /readable single image/i);
});

test("file size limitation can be enabled independently", () => {
  assert.equal(useFileLimit(normalizeSettings({ limits: "fileSize" })), true);
  assert.equal(useFileLimit(DEFAULT_SETTINGS), false);
});
