import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("../src/frame-registration.js", import.meta.url), "utf8");
const runtime = vm.createContext({ Uint8ClampedArray, console });
vm.runInContext(source, runtime);
const { alignFramePixels } = runtime.LongPageSnapFrameRegistration;

const width = 200;
const previousTop = 200;
const covered = 450;
const nextHeight = 310;
function sourcePixel(y, x) {
  return [
    ((y * 7 + x * 13) ^ (y * 3)) & 255,
    ((y * 23 + x * 7) ^ (x * 2)) & 255,
    (y * 9 + (x >> 2) * 17) & 255,
    255,
  ];
}
function frame(start, rows) {
  const pixels = new Uint8ClampedArray(width * rows * 4);
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < width; x += 1) {
      pixels.set(sourcePixel(y + start, x), (y * width + x) * 4);
    }
  }
  return pixels;
}
function match(nextTop, reportedTop) {
  return alignFramePixels({
    previousPixels: frame(previousTop, covered - previousTop),
    previousTop, covered,
    nextPixels: frame(nextTop, nextHeight), nextHeight,
    width, nominalTop: reportedTop, maxShift: 88,
  });
}

test("registers a screenshot shifted 60 pixels by Android toolbar movement", () => {
  const result = match(375, 315);
  assert.equal(result.delta, 60);
  assert.equal(result.confidence, "matched");
});

test("does not move a correctly aligned screenshot", () => {
  assert.equal(match(340, 340).delta, 0);
});

test("cannot invent an alignment from featureless color bands", () => {
  const previousPixels = new Uint8ClampedArray(width * (covered - previousTop) * 4);
  const nextPixels = new Uint8ClampedArray(width * nextHeight * 4);
  previousPixels.fill(120);
  nextPixels.fill(120);
  const result = alignFramePixels({
    previousPixels, previousTop, covered,
    nextPixels, nextHeight, width, nominalTop: 340, maxShift: 88,
  });
  assert.equal(result.delta, 0);
});

test("does not analyze missing or insufficient overlap", () => {
  const noOverlap = alignFramePixels({
    previousPixels: new Uint8ClampedArray(0),
    previousTop: 0, covered: 100,
    nextPixels: new Uint8ClampedArray(0), nextHeight: 200,
    width: 200, nominalTop: 95,
  });
  assert.equal(noOverlap.delta, 0);
  assert.equal(noOverlap.confidence, "unavailable");
});

test("pixel registration is available to the classic extension content script", () => {
  assert.ok(!source.includes("drawImage(canvas"));
  assert.ok(source.includes("globalThis.LongPageSnapFrameRegistration"));
});

test("aligns a shifted banded-page footer using stable color and text edges", () => {
  const w = 288;
  const start = 1660;
  const end = 1970;
  function pixel(y, x) {
    let color = y >= 1920
      ? [21, 25, 36]
      : [(Math.floor(y / 160) * 29) % 250, 155, 105];
    if (y >= 1930 && y < 1942 && x > 30 && x < 260 && Math.floor(x / 7) % 2 === 0) {
      color = [245, 245, 245];
    }
    if (y >= 1960 && y < 1970 && x > 65 && x < 200) {
      color = [244, 244, 244];
    }
    return [...color, 255];
  }
  function sample(offset, rows) {
    const pixels = new Uint8ClampedArray(rows * w * 4);
    for (let y = 0; y < rows; y += 1) {
      for (let x = 0; x < w; x += 1) {
        pixels.set(pixel(y + offset, x), (y * w + x) * 4);
      }
    }
    return pixels;
  }
  const result = alignFramePixels({
    previousPixels: sample(start, end - start),
    previousTop: start,
    covered: end,
    nextPixels: sample(1870, 330),
    nextHeight: 330,
    width: w,
    nominalTop: 1820,
    maxShift: 88,
  });
  assert.equal(result.delta, 50);
  assert.equal(result.confidence, "matched");
});

test("repair uses the newer image only for a bounded tail at a true overlap", () => {
  const plan = runtime.LongPageSnapFrameRegistration.planSeamRefresh;
  const repair = plan({
    top: 310, covered: 450, screenshotEnd: 650,
    segmentStart: 0, segmentHeight: 1200,
  });
  assert.equal(repair.outputTop, 418);
  assert.equal(repair.height, 32);
  assert.equal(repair.sourceY, 108);
  assert.equal(repair.destinationY, 418);
});

test("repair skips tiny overlaps, gaps and previously exported segments", () => {
  const plan = runtime.LongPageSnapFrameRegistration.planSeamRefresh;
  assert.equal(plan({
    top: 435, covered: 450, screenshotEnd: 660,
    segmentStart: 0, segmentHeight: 1000,
  }), null, "Do not repaint when overlap is only 15 px");
  assert.equal(plan({
    top: 510, covered: 450, screenshotEnd: 700,
    segmentStart: 0, segmentHeight: 1000,
  }), null, "Never repair an alignment gap");
  assert.equal(plan({
    top: 310, covered: 450, screenshotEnd: 700,
    segmentStart: 460, segmentHeight: 1000,
  }), null, "Never repaint a previously staged segment");
  assert.equal(plan({
    top: 310, covered: 450, screenshotEnd: 440,
    segmentStart: 0, segmentHeight: 1000,
  }), null, "The new screenshot must include the old seam");
});

test("repair keeps the rest of the previous capture untouched", () => {
  const plan = runtime.LongPageSnapFrameRegistration.planSeamRefresh;
  const oldFrame = new Uint8Array(800).fill(175);
  const freshFrame = new Uint8Array(400).fill(214);
  // Simulate missing glyph pixels in the old capture near the seam.
  oldFrame.fill(255, 420, 438);
  freshFrame.fill(25, 106, 124);
  const repair = plan({
    top: 310, covered: 450, screenshotEnd: 710,
    segmentStart: 0, segmentHeight: 800,
  });
  const before = oldFrame.slice(0, repair.outputTop);
  oldFrame.set(freshFrame.subarray(repair.sourceY, repair.sourceY + repair.height),
    repair.destinationY);
  assert.deepEqual(oldFrame.slice(0, repair.outputTop), before);
  assert.equal(oldFrame[420], 25, "Newly painted heading pixels replace a blank old seam");
  assert.equal(oldFrame[390], 175, "Earlier captured content remains untouched");
});
