export function nextScrollY(coveredPixels, scale, viewportHeight) {
  if (!Number.isFinite(coveredPixels) || !Number.isFinite(scale) || scale <= 0) {
    throw new RangeError("Invalid screenshot coverage.");
  }
  // A two-pixel overlap was too small to detect Android's dynamic-toolbar
  // viewport shifts. Keep a real shared band so adjacent frames can be
  // aligned by their pixels. Never overlap more than 160 CSS pixels.
  const overlap = Number.isFinite(viewportHeight) && viewportHeight > 0
    ? Math.min(160, Math.max(16, Math.floor(viewportHeight * 0.23)))
    : 2;
  return Math.max(0, Math.floor(coveredPixels / scale - overlap));
}

export function pageProgress(coveredPixels, pagePixels) {
  if (pagePixels <= 0) {
    return 0;
  }
  return Math.min(100, Math.max(0, Math.floor(100 * coveredPixels / pagePixels)));
}
