export function nextScrollY(coveredPixels, scale) {
  if (!Number.isFinite(coveredPixels) || !Number.isFinite(scale) || scale <= 0) {
    throw new RangeError("Invalid screenshot coverage.");
  }
  return Math.max(0, Math.floor(coveredPixels / scale - 2));
}

export function pageProgress(coveredPixels, pagePixels) {
  if (pagePixels <= 0) {
    return 0;
  }
  return Math.min(100, Math.max(0, Math.floor(100 * coveredPixels / pagePixels)));
}
