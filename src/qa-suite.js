// One-shot, user-authorized release suite on the public fixture document.
// The suite never writes saved capture preferences or submits test images.
export const FIXTURE_ORIGIN = "https://cyoann.github.io";
export const FIXTURE_PATH = "/longpage-snap/lab/fixture.html";
const MAX_RUN_CASES = 20;
const definitions = [
  { id:"baseline-jpeg", scenario:"baseline", format:"jpeg", mode:"automatic", zones:10 },
  { id:"baseline-png", scenario:"baseline", format:"png", mode:"automatic", zones:10 },
  { id:"baseline-webp", scenario:"baseline", format:"webp", mode:"automatic", zones:10 },
  { id:"single", scenario:"long", format:"jpeg", mode:"single", zones:46, allowReadableLimit:true },
  { id:"automatic", scenario:"long", format:"jpeg", mode:"automatic", zones:46 },
  { id:"split-dimensions", scenario:"baseline", format:"png", mode:"split", limits:"dimensions",
    maxWidth:4096, maxHeight:900, zones:10, expectMultiple:true },
  { id:"split-filesize", scenario:"baseline", format:"jpeg", mode:"split", limits:"fileSize",
    maxFileMiB:1, zones:10 },
  { id:"zip-bulk", scenario:"long", format:"jpeg", mode:"automatic", zones:46, checkZip:true },
  { id:"sticky", scenario:"sticky", format:"jpeg", mode:"automatic", zones:11 },
  { id:"lazy", scenario:"lazy", format:"jpeg", mode:"automatic", zones:12 },
  { id:"growth", scenario:"growth", format:"jpeg", mode:"single", zones:14,
    allowReadableLimit:true },
  { id:"nested", scenario:"nested", format:"jpeg", mode:"automatic", zones:9,
    knownLimitation:true },
  { id:"wide", scenario:"wide", format:"jpeg", mode:"automatic", zones:9,
    knownLimitation:true },
  { id:"motion", scenario:"motion", format:"jpeg", mode:"automatic", zones:9,
    knownLimitation:true },
  { id:"locale-fr", scenario:"baseline", format:"jpeg", mode:"automatic", language:"fr", zones:10 },
];
export const RUN_CASES = Object.freeze(definitions.map((entry) => Object.freeze(entry)));
export const MANUAL_CHECKS = Object.freeze([
  { id:"zip-fallback", reason:"Firefox's native download acceptance cannot be observed by the extension." },
  { id:"discard", reason:"The user-facing Discard control is unit-tested; a native download prompt cannot be verified here." },
  { id:"failure-dialog", reason:"Resource-limit errors depend on hardware; device-specific dialog review remains necessary." },
]);
export const CHECK_COUNT = RUN_CASES.length + MANUAL_CHECKS.length;

export function isFixtureTab(url) {
  try {
    const parsed = new URL(url);
    return parsed.origin === FIXTURE_ORIGIN && parsed.pathname === FIXTURE_PATH &&
      !parsed.username && !parsed.password;
  } catch {
    return false;
  }
}

export function selectSettings(saved, testCase) {
  if (!RUN_CASES.includes(testCase)) {
    throw new Error("Unknown automated capture case.");
  }
  return {
    ...saved,
    format:testCase.format,
    mode:testCase.mode,
    language:testCase.language ?? saved.language,
    limits:testCase.limits ?? saved.limits,
    maxWidth:testCase.maxWidth ?? saved.maxWidth,
    maxHeight:testCase.maxHeight ?? saved.maxHeight,
    maxFileMiB:testCase.maxFileMiB ?? saved.maxFileMiB,
  };
}

export function classifyCapture(testCase, result) {
  if (!result || result.ok !== true) {
    const error = String(result?.error || "Capture did not finish.");
    if (testCase.allowReadableLimit && /readable single image cannot fit|single image cannot fit|single-image canvas limit|single-image memory or dimension limit/i.test(error)) {
      return { status:"pass", reason:"Readable Single Image safety limit handled without splitting." };
    }
    return { status:"fail", reason:error.slice(0,240) };
  }
  if (result.parts < 1 || !result.audit?.valid) {
    return { status:"fail", reason:result.audit?.reason ?? "Output image inspection failed." };
  }
  if (testCase.mode === "single" && result.parts !== 1) {
    return { status:"fail", reason:"Single Image produced more than one part." };
  }
  if (testCase.expectMultiple && result.parts < 2) {
    return { status:"fail", reason:"Configured dimension limit did not produce multiple images." };
  }
  if (testCase.checkZip && !result.audit.zipVerified) {
    return { status:"fail", reason:"The in-memory ZIP was not verified." };
  }
  return {
    status:"pass",
    reason:result.audit.reason || "Encoded images and fixture markers validated.",
  };
}

export function newReport() {
  return {
    schema:"longpage-snap-automated-qa/v1",
    startedAt:new Date().toISOString(),
    completedAt:null,
    extensionVersion:browser.runtime.getManifest().version,
    suite:"full",
    results:[],
    metadata:{
      automated:RUN_CASES.length,
      manual:MANUAL_CHECKS.length,
      limitations:"Native Firefox download confirmation, unrestricted pages and cross-device fidelity are not automated.",
    },
  };
}

export function completeReport(report, cancelled = false) {
  report.completedAt = new Date().toISOString();
  report.cancelled = cancelled;
  const completed = new Set(report.results.map((entry) => entry.id));
  for (const c of RUN_CASES) {
    if (!completed.has(c.id)) {
      report.results.push({ id:c.id, scenario:c.scenario, status:"skipped",
        reason:cancelled ? "Run cancelled." : "Capture not executed." });
    }
  }
  report.results.push(...MANUAL_CHECKS.map((entry) => ({ ...entry, status:"manual" })));
  report.summary = {
    passed:report.results.filter((entry) => entry.status==="pass").length,
    failed:report.results.filter((entry) => entry.status==="fail").length,
    manual:report.results.filter((entry) => entry.status==="manual").length,
    skipped:report.results.filter((entry) => entry.status==="skipped").length,
  };
  return report;
}

export { MAX_RUN_CASES };
