import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(new URL("../src/capture-diagnostics.js", import.meta.url), "utf8");
const context = vm.createContext({ URLSearchParams });
vm.runInContext(source, context);
const { create, fixtureName, MAX_EVENTS } = context.LongPageSnapDiagnostics;
const location = (hostname, pathname, search = "?case=sticky") =>
  ({ hostname, pathname, search });

test("diagnostics are strictly limited to controlled lab fixtures", () => {
  assert.equal(fixtureName(location("cyoann.github.io",
    "/longpage-snap/lab/fixture.html")), "sticky");
  assert.equal(create(location("cyoann.github.io",
    "/longpage-snap/lab/fixture.html", "?case=unknown")), null);
  assert.equal(create(location("example.org",
    "/longpage-snap/lab/fixture.html")), null);
  assert.equal(create(location("cyoann.github.io", "/private.html")), null);
  assert.equal(create(location("cyoann.github.io",
    "/longpage-snap/lab/verify.html")), null);
  assert.equal(create(location("localhost", "/lab/fixture.html", "?case=lazy"))
    ?.snapshot().scenario, "lazy");
});

test("trace preserves only numeric fields and fixed enums, never content or URLs", () => {
  const trace = create(location("cyoann.github.io",
    "/longpage-snap/lab/fixture.html"));
  trace.add("prepare", {
    scrollY: 124.567, viewportHeight: 600, zone11HeadingTop: 100.12,
    title: "PRIVATE TITLE", url: "https://example.com/private?q=secret",
    image: "data:image/jpeg;base64,PRIVATE", random: { secret: "private" },
    mode: "single", confidence: "matched", error: 8.125,
  });
  trace.add("arbitrary", { scrollY: 42 });
  trace.add("frame", { confidence: "private text", mode: "secret",
    scrollY: Number.POSITIVE_INFINITY });
  const output = trace.snapshot();
  assert.equal(output.eventCount, 2);
  const serialized = JSON.stringify(output);
  for (const word of ["PRIVATE", "private", "base64", "example.com", "secret", "url", "title"]) {
    assert.equal(serialized.includes(word), false, "Leaked field " + word);
  }
  assert.equal(output.events[0].scrollY, 124.57);
  assert.equal(output.events[0].confidence, "matched");
  assert.equal(output.events[0].mode, "single");
  assert.equal(Object.keys(output.events[1]).length, 1);
});

test("bounded trace stops at 320 events and reports truncation", () => {
  const trace = create(location("cyoann.github.io",
    "/longpage-snap/lab/fixture.html"));
  for (let frame = 0; frame < MAX_EVENTS + 200; frame += 1) {
    trace.add("frame", { frame });
  }
  const output = trace.snapshot();
  assert.equal(output.eventCount, MAX_EVENTS);
  assert.equal(output.truncated, true);
  assert.equal(output.events[0].frame, 0);
  assert.equal(output.events.at(-1).frame, MAX_EVENTS - 1);
  assert.equal(output.schema, "longpage-snap-stitch-trace/v1");
});
