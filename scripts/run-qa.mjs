#!/usr/bin/env node
// One command: execute every host-side release gate and always emit a JSON report.
// On-device Firefox captures use the separate, explicitly-triggered QA mode.
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";

const checks = [
  {id:"syntax",name:"JavaScript syntax",executable:"npm",args:["run","check"]},
  {id:"unit",name:"Unit and capture integration tests",executable:"npm",args:["test"]},
  {id:"eslint",name:"ESLint",executable:"npm",args:["run","lint"]},
  {id:"mozilla-lint",name:"Mozilla extension validator",executable:"npx",args:["--no-install","web-ext","lint"]},
  {id:"build",name:"Build Firefox extension",executable:"npx",args:["--no-install","web-ext","build"]},
  {id:"mobile-ui",name:"Real Chromium/Edge 390px UI",executable:"npm",args:["run","check:mobile"]},
  {id:"site-static",name:"Static site and fixture checks",executable:"node",args:["scripts/check-site.mjs"]},
  {id:"site-browser",name:"Eight browser-rendered fixtures",executable:"node",args:["scripts/check-site-browser.mjs"]},
];
const results=[];
for (const check of checks) {
  process.stdout.write("\n=== QA: "+check.name+" ===\n");
  const started=Date.now();
  const executable=process.platform==="win32" && ["npm","npx"].includes(check.executable)
    ? check.executable+".cmd" : check.executable;
  const proc=spawnSync(executable,check.args,{
    stdio:"inherit",shell:process.platform==="win32",
    timeout:5*60*1000,
  });
  const passed=proc.status===0 && !proc.error;
  results.push({
    id:check.id, name:check.name,
    status:passed?"pass":"fail",
    exitCode:proc.status,
    elapsedMs:Date.now()-started,
    error:proc.error?.message ?? null,
  });
  process.stdout.write((passed?"PASS ":"FAIL ")+check.name+"\n");
}
const summary={
  schema:"longpage-snap-qa-desktop/v1",
  generatedAt:new Date().toISOString(),
  node:process.version,
  platform:process.platform,
  results,
  totals:{
    passed:results.filter(x=>x.status==="pass").length,
    failed:results.filter(x=>x.status==="fail").length,
    count:results.length,
  },
  limitations:[
    "Host-browser capture preview is not Firefox Android's captureVisibleTab.",
    "Physical Android smoke/full QA and native download acceptance remain separate.",
  ],
};
const out=resolve(".qa-results");
mkdirSync(out,{recursive:true});
const output=join(out,"desktop-ci-report.json");
writeFileSync(output,JSON.stringify(summary,null,2)+"\n");
process.stdout.write("\nQA report: "+output+"\n"+
  summary.totals.passed+"/"+summary.totals.count+" passed, "+
  summary.totals.failed+" failed.\n");
if(summary.totals.failed)process.exitCode=1;
