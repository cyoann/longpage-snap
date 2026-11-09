export const DEFAULT_SETTINGS = Object.freeze({
  format: "jpeg",
  language: "auto",
  mode: "automatic",
  limits: "dimensions",
  maxWidth: 4096,
  maxHeight: 8192,
  maxFileMiB: 8,
  quality: 86,
});

const FORMATS = new Set(["jpeg", "png", "webp"]);
const LANGUAGES = new Set(["auto", "en", "fr"]);
const MODES = new Set(["automatic", "single", "split"]);
const LIMITS = new Set(["dimensions", "fileSize", "both"]);

function boundedInteger(value, min, max, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number >= min && number <= max ? number : fallback;
}

export function normalizeSettings(value) {
  const input = value && typeof value === "object" ? value : {};
  return {
    format: FORMATS.has(input.format) ? input.format : DEFAULT_SETTINGS.format,
    language: LANGUAGES.has(input.language) ? input.language : DEFAULT_SETTINGS.language,
    mode: MODES.has(input.mode) ? input.mode : DEFAULT_SETTINGS.mode,
    limits: LIMITS.has(input.limits) ? input.limits : DEFAULT_SETTINGS.limits,
    maxWidth: boundedInteger(input.maxWidth, 240, 16384, DEFAULT_SETTINGS.maxWidth),
    maxHeight: boundedInteger(input.maxHeight, 240, 16384, DEFAULT_SETTINGS.maxHeight),
    maxFileMiB: boundedInteger(input.maxFileMiB, 1, 100, DEFAULT_SETTINGS.maxFileMiB),
    quality: boundedInteger(input.quality, 30, 100, DEFAULT_SETTINGS.quality),
  };
}

export function mimeType(format) {
  return ({
    jpeg: "image/jpeg",
    png: "image/png",
    webp: "image/webp",
  })[format] ?? "image/jpeg";
}

export function extensionFor(format) {
  return format === "jpeg" ? "jpg" : format;
}

export function useDimensionLimit(settings) {
  return settings.mode !== "automatic" && settings.limits !== "fileSize";
}

export function useFileLimit(settings) {
  return settings.mode !== "automatic" && settings.limits !== "dimensions";
}

export function chooseOutputScale({
  inputWidth,
  pageWidth,
  pageHeight,
  imageHeight,
  settings,
  memoryBudgetBytes,
}) {
  if (![inputWidth, pageWidth, pageHeight, imageHeight, memoryBudgetBytes].every(
    (value) => Number.isFinite(value) && value > 0
  )) {
    throw new RangeError("Invalid capture dimensions.");
  }
  const sourceScale = inputWidth / pageWidth;
  const single = settings.mode === "single";
  const maxWidth = useDimensionLimit(settings) ? settings.maxWidth : 8192;
  const maxHeight = useDimensionLimit(settings) ? settings.maxHeight : 16384;

  let scale = Math.min(sourceScale, maxWidth / pageWidth);
  if (single) {
    // Match the capture controller's capacity reserve for lazy-loaded growth.
    const reserve = 1.3;
    scale = Math.min(
      scale,
      maxHeight / (pageHeight * reserve),
      16384 / (pageHeight * reserve),
      Math.sqrt(memoryBudgetBytes / (4 * pageWidth * pageHeight * reserve)),
    );
    if (Math.floor(pageWidth * scale) < 240) {
      throw new RangeError(
        "A readable single image exceeds the device memory or height limit. Select Automatic or Split images."
      );
    }
  }
  const width = Math.max(1, Math.floor(pageWidth * scale));
  const safeHeight = Math.min(
    maxHeight, 16384, Math.floor(memoryBudgetBytes / (4 * width)),
  );
  const segmentMaxHeight = single
    ? Math.min(safeHeight, Math.ceil(pageHeight * scale * 1.3))
    : safeHeight;

  if (segmentMaxHeight < 1) {
    throw new RangeError("Canvas memory limit exceeded.");
  }
  return {
    scale,
    width,
    segmentMaxHeight,
    single,
    sourceScale,
    imageHeight,
  };
}
