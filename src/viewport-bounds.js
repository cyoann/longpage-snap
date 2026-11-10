// Firefox Android may return a screenshot taller than visualViewport.height
// while visualViewport.pageTop lags behind document.scrollingElement.scrollTop.
// Restrict coverage to the stable visible viewport and the scroller position.
(() => {
  function frameBounds({
    scrollY, pageTop, viewportHeight, sourceScale, sourceHeight, scale,
  }) {
    if (![scrollY, viewportHeight, sourceScale, sourceHeight, scale].every(
      (value) => Number.isFinite(value),
    ) || scrollY < 0 || viewportHeight <= 0 || sourceScale <= 0 ||
        sourceHeight <= 0 || scale <= 0) {
      throw new RangeError("Invalid Android screenshot viewport geometry.");
    }
    const sourcePixels = Math.min(
      sourceHeight,
      Math.floor(viewportHeight * sourceScale),
    );
    if (sourcePixels < 1) {
      throw new RangeError("Screenshot has no safe visible pixels.");
    }
    const usablePixels = Math.floor(sourcePixels * scale / sourceScale);
    if (usablePixels < 1) {
      throw new RangeError("Screenshot is too small for safe stitching.");
    }
    return {
      nominalTop: Math.round(scrollY * scale),
      usablePixels,
      clippedSourcePixels: sourceHeight - sourcePixels,
      viewportOffset: Number.isFinite(pageTop) ? scrollY - pageTop : 0,
    };
  }

  globalThis.LongPageSnapViewportBounds = Object.freeze({ frameBounds });
})();
