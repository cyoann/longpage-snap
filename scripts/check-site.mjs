import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join, resolve, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { SCENARIOS, CHECKS, scenarioById } from "../docs/lab/data.js";
import { readImageHeader, filenamePart, assessFiles } from "../docs/lab/image-meta.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../docs");
let failures = 0;
function check(label, task) {
  try {
    task();
    console.log("PASS " + label);
  } catch (error) {
    failures += 1;
    console.error("FAIL " + label + ": " + error.message);
  }
}

const htmlFiles = ["index.html", "lab/index.html", "lab/fixture.html", "lab/verify.html"];

check("eight named fixtures and a complete release matrix", () => {
  assert.equal(SCENARIOS.length, 8);
  assert.equal(new Set(SCENARIOS.map((scenario) => scenario.id)).size, SCENARIOS.length);
  assert.ok(CHECKS.length >= 18);
  assert.equal(new Set(CHECKS.map((entry) => entry.id)).size, CHECKS.length);
  for (const entry of CHECKS) {
    assert.ok(SCENARIOS.some((scenario) => scenario.id === entry.scenario), entry.id);
    assert.ok(entry.expected && entry.label && entry.format && entry.mode, "Incomplete test: " + JSON.stringify(entry));
  }
  assert.equal(scenarioById("growth").sections + scenarioById("growth").extraSections, 14);
  assert.equal(scenarioById("long").sections, 46);
});

check("all HTML entry points have local, resolvable assets and links", () => {
  for (const rel of htmlFiles) {
    const html = readFileSync(join(root, rel), "utf8");
    assert.match(html, /<html lang="en"/);
    assert.match(html, /<meta name="viewport"/);
    assert.match(html, /<h1(?:\s|>)/);
    const attributes = [...html.matchAll(/\b(?:href|src)="([^"]+)"/g)];
    for (const [, href] of attributes) {
      if (/^(?:https?:|mailto:|#|data:)/.test(href)) {
        continue;
      }
      const target = new URL(href, "https://example.test/longpage-snap/" + rel);
      const prefix = "/longpage-snap/";
      assert.ok(target.pathname.startsWith(prefix), rel + " external relative URL: " + href);
      const localPath = join(root, target.pathname.slice(prefix.length));
      assert.ok(existsSync(localPath), rel + " has broken link: " + href +
        " (" + relative(root, localPath) + ")");
    }
  }
});

check("fixture renderer and report use the scenario matrix", () => {
  const renderer = readFileSync(join(root, "lab/fixture.js"), "utf8");
  const lab = readFileSync(join(root, "lab/lab.js"), "utf8");
  assert.match(renderer, /scenarioById\(/);
  assert.match(renderer, /IntersectionObserver/);
  assert.match(renderer, /dataset\.growth/);
  assert.match(renderer, /appendRange\(/);
  assert.match(renderer, /FINISH|finishDetails/);
  assert.match(lab, /SCENARIOS, CHECKS/);
  assert.match(lab, /application\/json/);
  assert.match(lab, /localStorage\.setItem/);
});

check("PNG dimensions are parsed without image decoding", () => {
  const bytes = new Uint8Array(32);
  bytes.set([137,80,78,71,13,10,26,10],0);
  bytes.set([73,72,68,82],12);
  bytes.set([0,0,3,32,0,0,2,88],16);
  assert.deepEqual(readImageHeader(bytes), {
    format:"png",mime:"image/png",width:800,height:600,
  });
});

check("JPEG dimensions are parsed from SOF markers", () => {
  const bytes = new Uint8Array(40);
  bytes.set([255,216,255,192,0,17,8,4,0,2,0],0);
  assert.deepEqual(readImageHeader(bytes), {
    format:"jpeg",mime:"image/jpeg",width:512,height:1024,
  });
});

check("WebP dimensions are parsed from VP8X and lossless VP8L headers", () => {
  const vp8x = new Uint8Array(35);
  vp8x.set([82,73,70,70],0); vp8x.set([87,69,66,80],8);
  vp8x.set([86,80,56,88],12);
  vp8x.set([0x1f,0x03,0x00,0x57,0x02,0x00],24);
  assert.deepEqual(readImageHeader(vp8x), {
    format:"webp",mime:"image/webp",width:800,height:600,
  });
  const vp8l = new Uint8Array(35);
  vp8l.set([82,73,70,70],0); vp8l.set([87,69,66,80],8);
  vp8l.set([86,80,56,76],12); vp8l[20]=0x2f;
  vp8l[21]=0x1f; vp8l[22]=0x03; vp8l[23]=0x96; vp8l[24]=0;
  assert.deepEqual(readImageHeader(vp8l), {
    format:"webp",mime:"image/webp",width:800,height:601,
  });
});

check("incomplete multipart captures are rejected", () => {
  const record = (n) => ({
    name:"sample-part-" + String(n).padStart(3, "0") + ".jpg",
    size:4000, header:{ format:"jpeg",width:100,height:200 },
  });
  assert.equal(assessFiles([record(1),record(2)],{mode:"split"}).failures.length,0);
  assert.ok(assessFiles([record(1),record(3)],{mode:"split"}).failures.length);
  assert.ok(assessFiles([record(1),record(1)],{mode:"split"}).failures.length);
  assert.ok(assessFiles([record(1),record(2)],{mode:"single"}).failures.length);
  assert.equal(filenamePart("snap-part-008.webp").part,8);
});

check("byte and dimension thresholds are enforced", () => {
  const record = {
    name:"test.png",size:2 * 1024 * 1024,
    header:{format:"png",width:600,height:1200},
  };
  assert.equal(assessFiles([record],{format:"png",mode:"single"}).failures.length,0);
  assert.ok(assessFiles([record],{maxWidth:500}).failures.length);
  assert.ok(assessFiles([record],{maxHeight:1000}).failures.length);
  assert.ok(assessFiles([record],{maxFileMiB:1}).failures.length);
  assert.ok(assessFiles([record],{format:"jpeg"}).failures.length);
});

if (failures) {
  console.error("SITE CHECKS: " + failures + " failure(s)");
  process.exitCode = 1;
} else {
  console.log("SITE CHECKS: PASS");
}
