import { scenarioById, SCENARIO_IDS } from "./data.js";

const params = new URLSearchParams(location.search);
const zones = document.getElementById("zones");
const finishDetails = document.getElementById("finish-details");
const tag = document.getElementById("fixture-label");
const stickySlot = document.getElementById("sticky-slot");
const allowed = new Set(SCENARIO_IDS);
let scenario;
let observer;
let growthListener;
let motionTimer;
let generation = 0;

function addText(parent, tagName, className, content) {
  const node = document.createElement(tagName);
  if (className) {
    node.className = className;
  }
  node.textContent = content;
  parent.append(node);
  return node;
}

function svgLabel(number) {
  const label = "LAZY IMAGE " + String(number).padStart(2, "0");
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="145">' +
    '<rect width="100%" height="100%" fill="#f2f7ff"/>' +
    '<rect x="8" y="8" width="584" height="129" stroke="#184a90" fill="none" stroke-width="3"/>' +
    '<text x="300" y="82" text-anchor="middle" fill="#113e81" ' +
    'font-size="27" font-family="sans-serif" font-weight="bold">' + label + '</text></svg>';
  return "data:image/svg+xml;charset=UTF-8," + encodeURIComponent(svg);
}

function makeZone(number, extra = false) {
  const zone = document.createElement("section");
  zone.className = "zone";
  zone.style.setProperty("--hue", String((number * 43) % 360));
  zone.style.minHeight = scenario.sectionHeight + "px";
  zone.dataset.zone = String(number).padStart(2, "0");

  const top = document.createElement("div");
  top.className = "zone-number";
  addText(top, "strong", "", "ZONE " + String(number).padStart(2, "0"));
  addText(top, "span", "", extra ? "ADDED AFTER SCROLL" : "CONTROLLED CONTENT");
  zone.append(top);

  if (scenario.id === "lazy") {
    const box = document.createElement("div");
    box.className = "lazy-box";
    const img = document.createElement("img");
    img.width = 600;
    img.height = 145;
    img.alt = "LAZY IMAGE " + String(number).padStart(2, "0");
    img.dataset.zone = String(number);
    img.loading = "lazy";
    box.append(img);
    addText(box, "span", "lazy-state", "WAITING " + String(number).padStart(2, "0"));
    zone.append(box);
    observer.observe(img);
  }

  if (scenario.id === "nested" && number === 4) {
    const box = document.createElement("div");
    box.className = "nested-scroller";
    box.setAttribute("tabindex", "0");
    box.setAttribute("aria-label", "Deliberately nested scrollable content");
    for (let inner = 1; inner <= 15; inner += 1) {
      addText(box, "div", "", "INNER ROW " + String(inner).padStart(2, "0") +
        " — content below this container's fold is intentionally out of scope");
    }
    zone.append(box);
  }

  if (scenario.id === "wide" && number === 4) {
    const chart = document.createElement("div");
    chart.className = "wide-chart";
    addText(chart, "span", "", "X=0");
    addText(chart, "span", "", "WIDE CONTENT — 1040 PX");
    addText(chart, "span", "", "X=1040");
    zone.append(chart);
  }

  if (scenario.id === "motion" && number === 4) {
    const box = document.createElement("div");
    box.className = "motion-box";
    const dot = document.createElement("span");
    dot.className = "motion-dot";
    dot.setAttribute("aria-hidden", "true");
    box.append(dot);
    const clock = addText(box, "span", "motion-clock", "FRAME +0");
    let frame = 0;
    motionTimer = setInterval(() => {
      clock.textContent = "FRAME +" + (++frame);
    }, 500);
    zone.append(box);
  }

  addText(zone, "div", "zone-bottom",
    "END ZONE " + String(number).padStart(2, "0") + " · " + scenario.id.toUpperCase());
  return zone;
}

function appendRange(first, last, extra = false) {
  for (let index = first; index <= last; index += 1) {
    zones.append(makeZone(index, extra));
  }
  document.documentElement.dataset.zoneCount = String(last);
  finishDetails.textContent = "CASE " + scenario.id.toUpperCase() +
    " · ZONES 01–" + String(last).padStart(2, "0");
}

function teardown() {
  generation += 1;
  observer?.disconnect();
  observer = undefined;
  if (growthListener) {
    window.removeEventListener("scroll", growthListener);
    growthListener = undefined;
  }
  if (motionTimer) {
    clearInterval(motionTimer);
    motionTimer = undefined;
  }
  document.querySelectorAll(".fixed-test[data-test-fixed]").forEach((el) => el.remove());
  stickySlot.className = "";
  stickySlot.textContent = "";
  stickySlot.removeAttribute("data-test-sticky");
  zones.replaceChildren();
  document.documentElement.dataset.growth = "";
}

function renderFixture(id, updateHistory = false) {
  if (!allowed.has(id)) {
    return false;
  }
  teardown();
  scenario = scenarioById(id);
  const currentGeneration = generation;
  if (updateHistory) {
    // Same-document history keeps Firefox activeTab permission alive. This
    // enables an explicitly started, fully automatic test sequence without
    // requesting access to unrelated sites.
    const url = new URL(location.href);
    url.searchParams.set("case", scenario.id);
    history.replaceState(null, "", url.pathname + url.search + url.hash);
  }
  window.scrollTo({top:0,left:0,behavior:"instant"});
  document.title = scenario.title + " · LongPage Snap test fixture";
  document.getElementById("fixture-name").textContent = scenario.title;
  document.getElementById("fixture-description").textContent = scenario.description;
  document.getElementById("fixture-expectation").textContent = "Expected: " + scenario.expected;
  document.getElementById("fixture-spec").textContent =
    "CASE=" + scenario.id.toUpperCase() + " · zones=" +
    (scenario.sections + (scenario.extraSections || 0)) +
    " · css-height=" + scenario.sectionHeight + "px/zone";
  tag.textContent = scenario.id.toUpperCase();

  if (scenario.id === "lazy") {
    observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) {
          continue;
        }
        observer.unobserve(entry.target);
        const img = entry.target;
        const number = Number(img.dataset.zone);
        setTimeout(() => {
          if (generation !== currentGeneration || !img.isConnected) {
            return;
          }
          img.src = svgLabel(number);
          img.closest(".lazy-box").querySelector(".lazy-state").textContent =
            "LOADED " + String(number).padStart(2, "0");
        }, 80);
      }
    }, { rootMargin: "140px" });
  }

  appendRange(1, scenario.sections);

  if (scenario.id === "sticky") {
    stickySlot.className = "sticky-test";
    stickySlot.textContent = "STICKY HEADER — COUNT ONCE";
    stickySlot.dataset.testSticky = "true";
    const fixed = addText(document.body, "div", "fixed-test", "FIXED · COUNT ONCE");
    fixed.dataset.testFixed = "true";
  }

  if (scenario.id === "growth") {
    let grown = false;
    growthListener = () => {
      if (grown || window.scrollY < 520 || generation !== currentGeneration) {
        return;
      }
      grown = true;
      window.removeEventListener("scroll", growthListener);
      growthListener = undefined;
      appendRange(scenario.sections + 1, scenario.sections + scenario.extraSections, true);
      document.documentElement.dataset.growth = "complete";
      document.getElementById("fixture-spec").textContent += " · growth=complete";
    };
    window.addEventListener("scroll", growthListener, { passive:true });
    growthListener();
  }

  document.documentElement.dataset.fixtureCase = scenario.id;
  document.documentElement.dataset.fixtureReady = "true";
  return true;
}

// Controlled fixture switching. It does not navigate, access network, modify
// user data, or expose privileged WebExtension APIs to the website.
document.addEventListener("longpage-snap:select-fixture", (event) => {
  if (typeof event.detail !== "string") {
    return;
  }
  renderFixture(event.detail, true);
});

renderFixture(params.get("case") || "baseline");
