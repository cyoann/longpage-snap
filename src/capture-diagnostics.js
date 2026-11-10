// Opt-in, page-local stitching diagnostics for the public LongPage Snap fixtures.
// No URLs, titles, images, DOM text, or user browsing history are collected.
// Only the eight controlled GitHub Pages test fixtures enable this recorder.
(() => {
  const FIXTURES = new Set([
    "baseline", "sticky", "lazy", "growth", "long", "nested", "wide", "motion",
  ]);
  const MAX_EVENTS = 320;
  const NUMERIC_FIELDS = new Set([
    "frame", "scrollY", "pageTop", "viewportHeight", "viewportWidth",
    "maxScrollY", "pageHeight", "imageWidth", "imageHeight", "nominalTop",
    "alignedTop", "delta", "error", "coveredBefore", "coveredAfter",
    "start", "end", "overlap", "scale", "sourceScale", "remainingPixels",
    "segmentStart", "segmentHeight", "parts", "targetY",
    "zone11Top", "zone11Bottom", "zone11HeadingTop", "zone11HeadingBottom",
    "finishTop", "finishBottom",
  ]);
  const ENUM_FIELDS = Object.freeze({
    confidence: new Set(["unavailable", "nominal", "matched", "ambiguous", "skipped"]),
    mode: new Set(["single", "automatic", "split"]),
  });

  function fixtureName(location) {
    if (!location || !["cyoann.github.io", "localhost", "127.0.0.1"].includes(
      location.hostname,
    ) || !["/longpage-snap/lab/fixture.html", "/lab/fixture.html"].includes(
      location.pathname,
    )) {
      return null;
    }
    const selected = new URLSearchParams(location.search).get("case") || "baseline";
    return FIXTURES.has(selected) ? selected : null;
  }

  function create(location) {
    const scenario = fixtureName(location);
    if (!scenario) {
      return null;
    }
    const entries = [];
    let truncated = false;
    function add(kind, values = {}) {
      if (!["begin", "prepare", "frame", "finish", "failure"].includes(kind)) {
        return;
      }
      if (entries.length >= MAX_EVENTS) {
        truncated = true;
        return;
      }
      const entry = { kind };
      for (const [key, raw] of Object.entries(values)) {
        if (NUMERIC_FIELDS.has(key) && typeof raw === "number" && Number.isFinite(raw)) {
          entry[key] = Math.round(raw * 100) / 100;
        } else if (Object.hasOwn(ENUM_FIELDS, key) && ENUM_FIELDS[key].has(raw)) {
          entry[key] = raw;
        }
      }
      entries.push(entry);
    }
    function snapshot() {
      return {
        schema: "longpage-snap-stitch-trace/v1",
        scenario,
        eventCount: entries.length,
        truncated,
        events: entries.map((entry) => ({ ...entry })),
      };
    }
    return Object.freeze({ add, snapshot });
  }

  globalThis.LongPageSnapDiagnostics = Object.freeze({
    create, fixtureName, MAX_EVENTS,
  });
})();
