import { SCENARIOS, CHECKS } from "./data.js";

const STORAGE_KEY = "longpage-snap.qa.lab.v1";
const cards = document.getElementById("scenario-cards");
const checklist = document.getElementById("checklist");
const summary = document.getElementById("summary");
const version = document.getElementById("version");
const statuses = ["Not run", "Pass", "Fail", "Blocked"];

function node(tag, text, className) {
  const element = document.createElement(tag);
  if (text !== undefined) {
    element.textContent = text;
  }
  if (className) {
    element.className = className;
  }
  return element;
}

for (const scenario of SCENARIOS) {
  const card = node("article", undefined, "card");
  const tag = node("span", scenario.tag, "pill" +
    (scenario.tag.includes("limitation") ? " warn" : ""));
  const heading = node("h3", scenario.title);
  const description = node("p", scenario.description);
  const expected = node("p", "Expected: " + scenario.expected);
  expected.className = "small";
  const link = node("a", "Open fixture");
  link.href = "./fixture.html?case=" + encodeURIComponent(scenario.id);
  card.append(tag, heading, description, expected, link);
  cards.append(card);
}

let report = { version: "", cases: {} };
try {
  const previous = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
  if (previous && typeof previous === "object" && typeof previous.cases === "object") {
    report = {
      version: String(previous.version || "").slice(0, 70),
      cases: previous.cases,
    };
  }
} catch {
  // Private browsing or disabled storage: test controls still work in memory.
}
version.value = report.version;

function persist() {
  report.version = version.value.slice(0, 70);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(report));
  } catch {
    // In restricted browsing sessions, results can still be exported as JSON.
  }
  updateSummary();
}

function updateSummary() {
  const counts = Object.fromEntries(statuses.map((status) => [status, 0]));
  for (const test of CHECKS) {
    const status = report.cases[test.id]?.status;
    counts[statuses.includes(status) ? status : "Not run"] += 1;
  }
  summary.textContent = [
    CHECKS.length + " tests",
    counts.Pass + " passed",
    counts.Fail + " failed",
    counts.Blocked + " blocked",
    counts["Not run"] + " not run",
  ].join(" · ");
}

for (const entry of CHECKS) {
  const data = report.cases[entry.id] || {};
  const row = node("tr");

  const detail = node("td");
  const title = node("div", entry.label, "check-title");
  const settings = node("div", entry.mode + " · " + entry.format, "muted small");
  const expected = node("p", entry.expected, "small");
  const link = node("a", "Open fixture", "small");
  link.href = "./fixture.html?case=" + encodeURIComponent(entry.scenario);
  detail.append(title, settings, expected, link);

  const statusCell = node("td");
  const select = node("select", undefined, "status-select");
  select.setAttribute("aria-label", entry.label + " result");
  for (const status of statuses) {
    const option = node("option", status);
    option.value = status;
    select.append(option);
  }
  select.value = statuses.includes(data.status) ? data.status : "Not run";
  statusCell.append(select);

  const notes = node("td");
  const note = node("textarea", undefined, "note-field");
  note.rows = 2;
  note.maxLength = 500;
  note.placeholder = "Device observations";
  note.setAttribute("aria-label", entry.label + " notes");
  note.value = typeof data.note === "string" ? data.note.slice(0, 500) : "";
  notes.append(note);

  const save = () => {
    report.cases[entry.id] = { status: select.value, note: note.value.slice(0, 500) };
    persist();
  };
  select.addEventListener("change", save);
  note.addEventListener("change", save);
  note.addEventListener("input", save);
  row.append(detail, statusCell, notes);
  checklist.append(row);
}
version.addEventListener("input", persist);
updateSummary();

document.getElementById("export-report").addEventListener("click", () => {
  persist();
  const result = {
    schema: "longpage-snap-qa/v1",
    createdAt: new Date().toISOString(),
    extensionVersion: report.version,
    browser: navigator.userAgent,
    viewport: { width: innerWidth, height: innerHeight, devicePixelRatio },
    origin: location.origin,
    tests: CHECKS.map((test) => ({
      ...test,
      result: report.cases[test.id]?.status || "Not run",
      note: report.cases[test.id]?.note || "",
    })),
  };
  const blob = new Blob([JSON.stringify(result, null, 2)], { type:"application/json" });
  const url = URL.createObjectURL(blob);
  const link = node("a");
  link.href = url;
  link.download = "longpage-snap-qa-" + new Date().toISOString().slice(0, 10) + ".json";
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

document.getElementById("clear-report").addEventListener("click", () => {
  if (!confirm("Clear all local checklist results?")) {
    return;
  }
  report = { version: version.value, cases: {} };
  for (const row of checklist.rows) {
    row.querySelector("select").value = "Not run";
    row.querySelector("textarea").value = "";
  }
  persist();
});
