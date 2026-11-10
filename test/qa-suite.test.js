import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  RUN_CASES, MANUAL_CHECKS, CHECK_COUNT, isFixtureTab,
  selectSettings, classifyCapture, newReport, completeReport,
} from "../src/qa-suite.js";
import { DEFAULT_SETTINGS } from "../src/settings.js";
import { CHECKS } from "../docs/lab/data.js";

test("all 18 release checks are accounted for without invented automation", () => {
  const declared = [...RUN_CASES, ...MANUAL_CHECKS].map((entry) => entry.id);
  assert.equal(CHECK_COUNT, 18);
  assert.equal(new Set(declared).size, 18);
  assert.deepEqual(declared.slice().sort(), CHECKS.map((item) => item.id).sort());
  assert.equal(RUN_CASES.length, 15);
  assert.equal(MANUAL_CHECKS.length, 3);
  assert.deepEqual(new Set(RUN_CASES.map((entry) => entry.scenario)),
    new Set(["baseline","sticky","lazy","growth","long","nested","wide","motion"]));
});

test("automatic launch is restricted to the explicit controlled HTTPS fixture URL", () => {
  assert.equal(isFixtureTab("https://cyoann.github.io/longpage-snap/lab/fixture.html?case=sticky&automation=1"),true);
  for(const url of [
    "https://cyoann.github.io/longpage-snap/lab/fixture.html?case=baseline",
    "http://cyoann.github.io/longpage-snap/lab/fixture.html?automation=1",
    "https://cyoann.github.io/longpage-snap/lab/",
    "https://example.com/longpage-snap/lab/fixture.html?automation=1",
    "https://cyoann.github.io.evil.test/longpage-snap/lab/fixture.html?automation=1",
    "https://cyoann.github.io/longpage-snap/lab/fixture.html?automation=0",
    "not a URL",
  ]) {
    assert.equal(isFixtureTab(url),false,url);
  }
});

test("per-case settings never mutate saved preferences", () => {
  const saved = structuredClone(DEFAULT_SETTINGS);
  saved.language="fr";
  saved.mode="single";
  saved.quality=91;
  const original = JSON.stringify(saved);
  for(const entry of RUN_CASES) {
    const settings = selectSettings(saved,entry);
    assert.equal(settings.format,entry.format);
    assert.equal(settings.mode,entry.mode);
    assert.equal(settings.quality,91);
    assert.equal(settings.language,entry.language || "fr");
  }
  assert.equal(JSON.stringify(saved),original);
  assert.throws(()=>selectSettings(saved,{mode:"single"}),/Unknown/);
});

test("Single Image resource limits are acceptable, generic failures are not", () => {
  const single = RUN_CASES.find((entry)=>entry.id==="single");
  const baseline = RUN_CASES[0];
  const reason = "A readable single image cannot fit this device.";
  assert.equal(classifyCapture(single,{ok:false,error:reason}).status,"pass");
  assert.equal(classifyCapture(baseline,{ok:false,error:reason}).status,"fail");
  assert.equal(classifyCapture(single,{ok:false,error:"The operation is insecure."}).status,"fail");
  assert.equal(classifyCapture(single,{ok:true,parts:2,audit:{valid:true}}).status,"fail");
});

test("ZIP checks distinguish safe-cap constraints and genuine archive failures", () => {
  const zip = RUN_CASES.find((entry)=>entry.id==="zip-bulk");
  const okay={ok:true,parts:10,audit:{valid:true,zipVerified:true,reason:"ZIP verified."}};
  assert.equal(classifyCapture(zip,okay).status,"pass");
  assert.equal(classifyCapture(zip,{...okay,audit:{valid:true,zipSkipped:true}}).status,"manual");
  assert.equal(classifyCapture(zip,{...okay,audit:{valid:true,zipVerified:false}}).status,"fail");
});

test("failed optical markers fail even when output is a valid JPEG", () => {
  const baseline = RUN_CASES[0];
  const result=classifyCapture(baseline,{ok:true,parts:1,
    audit:{valid:false,reason:"Missing visual fixture markers: zone-11"}});
  assert.equal(result.status,"fail");
  assert.match(result.reason,/zone-11/);
});

test("report has explicit pass/fail/manual/skipped outcomes and no private page data", () => {
  const report=newReport("0.4.0");
  report.results.push({id:"baseline-jpeg",status:"pass"});
  report.results.push({id:"baseline-png",status:"fail",reason:"Missing footer"});
  const done=completeReport(report,true);
  assert.equal(done.extensionVersion,"0.4.0");
  assert.equal(done.results.length,18);
  assert.deepEqual(done.summary,{passed:1,failed:1,manual:3,skipped:13});
  assert.equal(done.cancelled,true);
  const serialized=JSON.stringify(done);
  assert.ok(!serialized.includes("https://"));
  assert.ok(!serialized.includes("data:image"));
});

test("automation suite uses the actual extension capture pipeline, not webpage screenshots", () => {
  const code=readFileSync(new URL("../src/background.js",import.meta.url),"utf8");
  assert.match(code,/capture\(tab,testSettings,testCase\)/);
  assert.match(code,/browser\.tabs\.captureVisibleTab/);
  assert.match(code,/suite-audit/);
  assert.match(code,/if \(automatedCase\)/);
});
