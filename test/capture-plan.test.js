import assert from "node:assert/strict";
import test from "node:test";
import { nextScrollY, pageProgress } from "../src/capture-plan.js";

test("scroll position overlaps the preceding frame", () => {
  assert.equal(nextScrollY(1950, 3), 648);
});

test("scroll positions do not underflow", () => {
  assert.equal(nextScrollY(1, 3), 0);
});

test("rejects invalid image scales", () => {
  assert.throws(() => nextScrollY(100, 0), RangeError);
});

test("progress is clamped", () => {
  assert.equal(pageProgress(0, 100), 0);
  assert.equal(pageProgress(20, 100), 20);
  assert.equal(pageProgress(150, 100), 100);
});
