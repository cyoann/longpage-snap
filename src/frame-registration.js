// Pure pixel-overlap registration for Firefox Android screenshot stitching.
// Loaded as a classic injected script before src/content.js; also VM-testable.
(() => {
  function alignFramePixels({
    previousPixels, previousTop, covered, nextPixels, nextHeight, width,
    nominalTop, maxShift = 88,
  }) {
    const nominalOverlap = covered - nominalTop;
    if (!Number.isInteger(width) || width < 1 ||
        nominalOverlap < 20 || previousTop >= covered || nextHeight < 32 ||
        previousPixels.length < (covered - previousTop) * width * 4 ||
        nextPixels.length < nextHeight * width * 4) {
      return { delta: 0, confidence: "unavailable" };
    }

    const samplesX = [...new Set([0.08, 0.25, 0.48, 0.73, 0.92]
      .map((fraction) => Math.min(width - 1, Math.floor(width * fraction))))];
    const minimumOverlap = Math.min(28, Math.max(16, Math.floor(nominalOverlap / 3)));
    const span = Math.min(maxShift, Math.floor(nextHeight / 3), 112);

    function compare(delta) {
      const candidateTop = nominalTop + delta;
      if (candidateTop < 0) {
        return null;
      }
      const from = Math.max(previousTop, candidateTop, covered - 116);
      const to = Math.min(covered - 3, candidateTop + nextHeight - 3);
      if (to - from < minimumOverlap) {
        return null;
      }
      let sum = 0;
      let count = 0;
      for (let y = from; y < to; y += 3) {
        for (const x of samplesX) {
          const oldIdx = ((y - previousTop) * width + x) * 4;
          const newIdx = ((y - candidateTop) * width + x) * 4;
          for (let channel = 0; channel < 3; channel += 1) {
            sum += Math.abs(
              previousPixels[oldIdx + channel] - nextPixels[newIdx + channel],
            );
            count += 1;
          }
        }
      }
      return count ? { delta, error: sum / count } : null;
    }

    const nominal = compare(0);
    if (!nominal) {
      return { delta: 0, confidence: "unavailable" };
    }
    let best = nominal;
    for (let delta = -span; delta <= span; delta += 1) {
      if (!delta) {
        continue;
      }
      const candidate = compare(delta);
      if (!candidate) {
        continue;
      }
      // Avoid arbitrary corrections on flat/uninformative sections.
      if (candidate.error + Math.abs(delta) * 0.008 <
          best.error + Math.abs(best.delta) * 0.008) {
        best = candidate;
      }
    }

    if (best.delta && nominal.error - best.error >= 2.5 && best.error <= 26) {
      return { delta: best.delta, confidence: "matched", error: best.error };
    }
    return {
      delta: 0,
      confidence: nominal.error < 18 ? "nominal" : "ambiguous",
      error: nominal.error,
    };
  }
  /**
   * Frame registration alone does not fix previously captured pixels that
   * were temporarily blank when Firefox moved its toolbar or painted content.
   * A later screenshot already overlaps those pixels, but the stitcher
   * previously discarded that entire overlap. Refresh a small, bounded tail
   * adjacent to the seam from the new screenshot, without shifting coverage.
   *
   * This never rewrites a previously staged segment. It is intentionally
   * conservative: a sufficiently large overlap must include the whole tail.
   */
  function planSeamRefresh({
    top, covered, screenshotEnd, segmentStart, segmentHeight,
  }) {
    if (![top, covered, screenshotEnd, segmentStart, segmentHeight].every(
      (value) => Number.isFinite(value)
    ) || segmentHeight <= 0 || top >= covered ||
        covered > segmentStart + segmentHeight ||
        screenshotEnd < covered) {
      return null;
    }
    const overlap = covered - Math.max(top, segmentStart);
    if (overlap < 32) {
      return null;
    }
    const height = Math.min(32, Math.floor(overlap * 0.4));
    if (height < 12) {
      return null;
    }
    const outputTop = covered - height;
    if (outputTop < Math.max(top, segmentStart) ||
        outputTop + height > screenshotEnd) {
      return null;
    }
    return {
      outputTop,
      height,
      sourceY: outputTop - top,
      destinationY: outputTop - segmentStart,
    };
  }

  globalThis.LongPageSnapFrameRegistration = Object.freeze({
    alignFramePixels, planSeamRefresh,
  });
})();
