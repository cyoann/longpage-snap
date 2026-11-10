// Deterministic, user-triggered QA matrix for the project's public test lab.
// The suite never changes stored preferences and never navigates unrelated sites.
export const QA_CASES = Object.freeze([
  { id:"baseline-jpeg", fixture:"baseline", mode:"single", format:"jpeg" },
  { id:"baseline-png", fixture:"baseline", mode:"single", format:"png" },
  { id:"baseline-webp", fixture:"baseline", mode:"single", format:"webp" },
  { id:"sticky", fixture:"sticky", mode:"single", format:"jpeg" },
  { id:"lazy", fixture:"lazy", mode:"single", format:"jpeg" },
  { id:"growth", fixture:"growth", mode:"single", format:"jpeg" },
  { id:"split-dimensions", fixture:"baseline", mode:"split", format:"jpeg",
    limits:"dimensions", maxHeight:500 },
  { id:"long-automatic", fixture:"long", mode:"automatic", format:"jpeg" },
  { id:"nested", fixture:"nested", mode:"single", format:"jpeg", knownLimitation:true },
  { id:"wide", fixture:"wide", mode:"single", format:"jpeg", knownLimitation:true },
  { id:"motion", fixture:"motion", mode:"single", format:"jpeg", knownLimitation:true },
]);

const FIXTURE_ORIGIN = "https://cyoann.github.io";
const FIXTURE_PATH = "/longpage-snap/lab/fixture.html";
export function qaRequest(url) {
  try {
    const parsed = new globalThis.URL(url);
    if (parsed.origin !== FIXTURE_ORIGIN || parsed.pathname !== FIXTURE_PATH) {
      return null;
    }
    const scope = parsed.searchParams.get("qa");
    if (scope !== "smoke" && scope !== "full") {
      return null;
    }
    return scope;
  } catch {
    return null;
  }
}
export function qaCases(scope) {
  if (scope === "full") return QA_CASES;
  if (scope === "smoke") return QA_CASES.filter(({id}) =>
    ["baseline-jpeg","sticky","lazy","growth","split-dimensions"].includes(id));
  throw new RangeError("Unsupported QA mode.");
}
export function qaSettings(base, testcase) {
  const settings = { ...base,
    mode: testcase.mode, format: testcase.format,
  };
  if (testcase.mode === "split") {
    settings.limits = testcase.limits;
    settings.maxHeight = testcase.maxHeight;
  }
  return settings;
}
export function qaReport(results, scope, build) {
  const counts = {
    passed:results.filter((test) => test.status === "pass").length,
    failed:results.filter((test) => test.status === "fail").length,
    blocked:results.filter((test) => test.status === "blocked").length,
  };
  return {
    schema:"longpage-snap-qa-android/v1",
    build,
    mode:scope,
    completed:new Date().toISOString(),
    totals:{ ...counts, count:results.length },
    limitations:[
      "Browser-native download prompts and user acceptance are not observable.",
      "Sampled visual pixels cannot prove every text glyph is perfect.",
      "Capture behavior on arbitrary websites is not certified by fixture tests.",
    ],
    tests:results,
  };
}
