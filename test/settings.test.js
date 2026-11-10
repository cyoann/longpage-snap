import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_SETTINGS,
  chooseOutputScale,
  extensionFor,
  mimeType,
  normalizeSettings,
  useFileLimit,
  useDimensionLimit,
  shouldRetrySingleGrowth,
  singleImageFallback,
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
  assert.equal(useFileLimit(normalizeSettings({ mode: "split", limits: "fileSize" })), true);
  assert.equal(useFileLimit(DEFAULT_SETTINGS), false);
});

test("automatic exports ignore user split thresholds", () => {
  const settings = normalizeSettings({
    mode: "automatic", limits: "both", maxHeight: 250, maxFileMiB: 1,
  });
  assert.equal(useFileLimit(settings), false);
  assert.equal(useDimensionLimit(settings), false);
});

test("custom split mode applies dimension and file limits", () => {
  const settings = normalizeSettings({ mode: "split", limits: "both" });
  assert.equal(useFileLimit(settings), true);
  assert.equal(useDimensionLimit(settings), true);
});

test("language override is validated", () => {
  assert.equal(normalizeSettings({ language: "fr" }).language, "fr");
  assert.equal(normalizeSettings({ language: "ja" }).language, "auto");
});

test("retry a growing single-image page once, not arbitrary memory errors", () => {
  const settings = { ...DEFAULT_SETTINGS, mode: "single" };
  const growth = new Error(
    "This page grew beyond the available single-image memory or dimension limit. " +
    "Choose Automatic or Split by custom limits."
  );
  assert.equal(shouldRetrySingleGrowth(settings, growth, 0), true);
  assert.equal(shouldRetrySingleGrowth(settings, growth, 1), false);
  assert.equal(shouldRetrySingleGrowth({ ...settings, mode: "automatic" }, growth, 0), false);
  assert.equal(shouldRetrySingleGrowth(settings, new Error("Out of memory."), 0), false);
  assert.equal(shouldRetrySingleGrowth(settings, new Error("The operation is insecure."), 0), false);
  assert.equal(shouldRetrySingleGrowth(settings,
    new Error("The page grew beyond the single-image canvas limit. Select Automatic export."), 0), true);
});

test("known Single Image memory limits offer a one-shot Automatic fallback", () => {
  const single = { ...DEFAULT_SETTINGS, mode: "single" };
  const error = new Error("A readable single image cannot fit this device. Select Automatic or Multiple images.");
  assert.deepEqual(singleImageFallback(single, error), {
    code: "single-image-limit", mode: "automatic",
  });
  assert.equal(single.mode, "single", "Fallback planning must not mutate saved settings");
  for (const reason of [
    "A single image cannot fit this device's canvas. Choose Automatic export.",
    "The page grew beyond the single-image canvas limit. Select Automatic export.",
    "This page grew beyond the available single-image memory or dimension limit.",
    "The single image exceeds the file-size limit. Raise the limit or select Automatic export.",
  ]) {
    assert.equal(singleImageFallback(single, Error(reason))?.mode, "automatic", reason);
  }
});

test("do not offer retry for general errors or already Automatic captures", () => {
  const single = { ...DEFAULT_SETTINGS, mode: "single" };
  for (const error of [
    "The operation is insecure.",
    "Unexpected image segment.",
    "Image 1 (temporary image storage): indexedDB transaction aborted.",
    "Scrolling made no progress.",
    "Screenshot alignment gap detected.",
    "Canvas context unavailable.",
    "The final section is outside Firefox's captured viewport.",
  ]) {
    assert.equal(singleImageFallback(single, Error(error)), null, error);
  }
  const memory = Error("A readable single image cannot fit this device.");
  assert.equal(singleImageFallback({ ...single, mode: "automatic" }, memory), null);
  assert.equal(singleImageFallback({ ...single, mode: "split" }, memory), null);
  assert.equal(singleImageFallback(undefined, memory), null);
});
