import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { qaRequest,qaCases,qaSettings,qaReport } from "../src/qa-suite.js";

const host="https://cyoann.github.io/longpage-snap/lab/fixture.html";
test("QA runs only from user-approved test fixture URLs",()=>{
  assert.equal(qaRequest(host+"?case=baseline&qa=smoke"),"smoke");
  assert.equal(qaRequest(host+"?case=sticky&qa=full"),"full");
  for(const url of [
    "https://example.com/longpage-snap/lab/fixture.html?qa=full",
    "https://cyoann.github.io.evil.test/longpage-snap/lab/fixture.html?qa=full",
    "https://cyoann.github.io/longpage-snap/lab/?qa=full",
    "http://cyoann.github.io/longpage-snap/lab/fixture.html?qa=full",
    host+"?qa=all",host+"?case=baseline", "not a url",
  ]) assert.equal(qaRequest(url),null,url);
});
test("smoke and full suites cover critical behaviors with stable test IDs",()=>{
  const smoke=qaCases("smoke"),full=qaCases("full");
  assert.equal(smoke.length,5);
  assert.equal(full.length,11);
  assert.equal(new Set(full.map(c=>c.id)).size,full.length);
  for(const testcase of smoke)assert.ok(full.includes(testcase));
  for(const id of ["baseline-jpeg","baseline-png","baseline-webp",
    "sticky","lazy","growth","long-automatic","split-dimensions"]) {
    assert.ok(full.some(c=>c.id===id),"Missing "+id);
  }
  assert.throws(()=>qaCases("unknown"),RangeError);
});
test("QA overrides never mutate the saved export settings",()=>{
  const saved=Object.freeze({
    mode:"single",format:"webp",quality:79,
    limits:"both",maxHeight:4000, maxWidth:3000,
  });
  const plan=qaSettings(saved,qaCases("full").find(c=>c.id==="split-dimensions"));
  assert.equal(plan.mode,"split");
  assert.equal(plan.format,"jpeg");
  assert.equal(plan.maxHeight,500);
  assert.equal(plan.quality,86,"QA uses reproducible default quality");
  assert.equal(plan.maxWidth,4096,"QA ignores personal output limits");
  assert.equal(saved.mode,"single");
  assert.equal(saved.format,"webp");
  assert.equal(saved.maxHeight,4000);
});
test("machine-readable QA report records failures and explicit blind spots",()=>{
  const report=qaReport([
    {id:"baseline",status:"pass",parts:1},
    {id:"lazy",status:"fail",reason:"FINISH missing"},
    {id:"long",status:"blocked",reason:"memory"},
  ],"smoke","0.3.11");
  assert.equal(report.schema,"longpage-snap-qa-android/v1");
  assert.deepEqual(report.totals,{passed:1,failed:1,blocked:1,count:3});
  assert.ok(report.limitations.some(x=>x.includes("download prompts")));
  assert.equal(report.tests[1].reason,"FINISH missing");
});
test("image-ink verifier distinguishes headings from flat backgrounds",()=>{
  const source=readFileSync(new URL("../src/qa-visual.js",import.meta.url),"utf8");
  const sandbox=vm.createContext({});
  vm.runInContext(source,sandbox);
  const {inkCount,rgb}=sandbox.LongPageSnapQaVisual;
  const solid=new Uint8ClampedArray(10*4).fill(236);
  const dark=solid.slice();dark.set([15,25,33,255],12);
  assert.equal(inkCount(solid),0);
  assert.equal(inkCount(dark),1);
  assert.equal(inkCount(solid,true),10);
  assert.deepEqual(Array.from(rgb("rgb(123, 45, 220)")),[123,45,220]);
});
test("Android runner uses actual capture engine rather than fixture DOM-only checks",()=>{
  const background=readFileSync(new URL("../src/background.js",import.meta.url),"utf8");
  const content=readFileSync(new URL("../src/content.js",import.meta.url),"utf8");
  assert.ok(background.includes('send(tabId, "qa-validate"'));
  assert.ok(background.includes('capture(tab,qaSettings(base,testcase),{'));
  assert.ok(background.includes('browser.tabs.captureVisibleTab'));
  assert.ok(content.includes('globalThis.LongPageSnapQaVisual.check(message)'));
  assert.ok(content.includes('qaReportHost'));
});
