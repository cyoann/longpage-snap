import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("../src/viewport-bounds.js", import.meta.url), "utf8");
const scope = vm.createContext({});
vm.runInContext(source, scope);
const { frameBounds } = scope.LongPageSnapViewportBounds;

test("clip Android capture pixels beyond reported visible viewport", () => {
  const result = frameBounds({
    scrollY: 2240, pageTop: 2240, viewportHeight: 643.23,
    sourceScale: 1080 / 414, sourceHeight: 1846, scale: 1.71,
  });
  assert.equal(result.nominalTop, 3830);
  assert.ok(result.clippedSourcePixels >= 160);
  assert.ok(result.usablePixels >= 1095 && result.usablePixels <= 1102);
  // Zone 11 heading starts at document Y=2930.55 in the user trace.
  assert.ok(result.nominalTop + result.usablePixels < 2930.55 * 1.71,
    "The preceding frame may not mark the offscreen heading as captured");
});

test("use actual scroller offset when Android pageTop is delayed by 64.4 CSS pixels", () => {
  const result = frameBounds({
    scrollY: 2690.97, pageTop: 2626.57, viewportHeight: 643.23,
    sourceScale: 1080 / 414, sourceHeight: 1846, scale: 1.71,
  });
  assert.equal(result.nominalTop, Math.round(2690.97 * 1.71));
  assert.ok(Math.abs(result.viewportOffset - 64.4) < 0.001);
  assert.ok(result.nominalTop + result.usablePixels >= 3334 * 1.71 - 2,
    "Final frame can reach footer without treating Chrome as document pixels");
});

test("never crop when screenshot is shorter than visible viewport", () => {
  const result = frameBounds({
    scrollY: 300, pageTop: 300, viewportHeight: 700,
    sourceScale: 2, sourceHeight: 1100, scale: 1,
  });
  assert.equal(result.usablePixels, 550);
  assert.equal(result.clippedSourcePixels, 0);
});

test("reject invalid or zero-height screenshot geometry", () => {
  for (const height of [0, -20, Number.NaN]) {
    assert.throws(() => frameBounds({
      scrollY: 0, pageTop: 0, viewportHeight: height,
      sourceScale: 2, sourceHeight: 1846, scale: 1,
    }), /geometry/);
  }
});
