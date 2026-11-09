import assert from "node:assert/strict";
import test from "node:test";
import { screenshotFilename } from "../src/filename.js";

const time = new Date("2026-11-09T08:00:00.000Z");

test("uses a readable page title", () => {
  assert.equal(
    screenshotFilename("Example: Page / Home", time),
    "longpage-snap-Example-Page-Home-2026-11-09T08-00-00-000Z.jpg",
  );
});

test("removes unsafe filename characters", () => {
  const name = screenshotFilename("../../test<>:\\|?*\n", time);
  assert.match(name, /^longpage-snap-[a-zA-Z0-9._-]+\.jpg$/);
  assert.ok(!name.includes("/"));
  assert.ok(!name.includes("\\"));
});

test("normalizes accented titles", () => {
  assert.match(screenshotFilename("Crème brûlée", time), /Creme-brulee/);
});

test("falls back for empty and punctuation-only titles", () => {
  assert.match(screenshotFilename("", time), /^longpage-snap-page-/);
  assert.match(screenshotFilename("!!!", time), /^longpage-snap-page-/);
});

test("bounds long title components", () => {
  const name = screenshotFilename("x".repeat(500), time);
  const stem = name.slice("longpage-snap-".length, -"-2026-11-09T08-00-00-000Z.jpg".length);
  assert.equal(stem.length, 64);
});
