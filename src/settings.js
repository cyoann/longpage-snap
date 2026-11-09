export const DEFAULT_SETTINGS = Object.freeze({
  format: "jpeg",
  mode: "automatic",
  limits: "dimensions",
  maxWidth: 4096,
  maxHeight: 8192,
  maxFileMiB: 8,
  quality: 86,
});

const FORMATS = new Set(["jpeg", "png", "webp"]);
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
    mode: MODES.has(input.mode) ? input.mode : DEFAULT_SETTINGS.mode,
    limits: LIMITS.has(input.limits) ? input.limits : DEFAULT_SETTINGS.limits,
    maxWidth: boundedInteger(input.maxWidth, 240, 16384, DEFAULT_SETTINGS.maxWidth),
    maxHeight: boundedInteger(input.maxHeight, 240, 32768, DEFAULT_SETTINGS.maxHeight),
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
  return settings.limits !== "fileSize";
}

export function useFileLimit(settings) {
  return settings.limits !== "dimensions";
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
    scale = Math.min(
      scale,
      maxHeight / pageHeight,
      16384 / pageHeight,
      Math.sqrt(memoryBudgetBytes / (4 * pageWidth * pageHeight)),
    );
    if (Math.floor(pageWidth * scale) < 240) {
      throw new RangeError(
        "A readable single image exceeds the device memory or height limit. Select Automatic or Split images."
      );
    }
  }
  const width = Math.max(1, Math.floor(pageWidth * scale));
  const segmentMaxHeight = single
    ? Math.ceil(pageHeight * scale)
    : Math.min(
      maxHeight,
      16384,
      Math.floor(memoryBudgetBytes / (4 * width)),
    );

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
