import { scenarioById } from "./data.js";

const params = new URLSearchParams(location.search);
const scenario = scenarioById(params.get("case") || "baseline");
const zones = document.getElementById("zones");
const finishDetails = document.getElementById("finish-details");
const tag = document.getElementById("fixture-label");

document.title = scenario.title + " · LongPage Snap test fixture";
document.getElementById("fixture-name").textContent = scenario.title;
document.getElementById("fixture-description").textContent = scenario.description;
document.getElementById("fixture-expectation").textContent = "Expected: " + scenario.expected;
document.getElementById("fixture-spec").textContent =
  "CASE=" + scenario.id.toUpperCase() + " · zones=" +
  (scenario.sections + (scenario.extraSections || 0)) +
  " · css-height=" + scenario.sectionHeight + "px/zone";
tag.textContent = scenario.id.toUpperCase();

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

let observer;
if (scenario.id === "lazy") {
  observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) {
        continue;
      }
      observer.unobserve(entry.target);
      const image = entry.target;
      const zoneNumber = Number(image.dataset.zone);
      // Fixed, bounded delay: no network requests or randomized timing.
      setTimeout(() => {
        image.src = svgLabel(zoneNumber);
        image.closest(".lazy-box").querySelector(".lazy-state").textContent =
          "LOADED " + String(zoneNumber).padStart(2, "0");
      }, 80);
    }
  }, { rootMargin: "140px" });
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
    setInterval(() => {
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

appendRange(1, scenario.sections);

if (scenario.id === "sticky") {
  // The sticky element must itself be a direct child of body. Nesting it
  // inside a short wrapper would end the sticky constraint immediately.
  const sticky = document.getElementById("sticky-slot");
  sticky.className = "sticky-test";
  sticky.textContent = "STICKY HEADER — COUNT ONCE";
  sticky.dataset.testSticky = "true";
  const fixed = addText(document.body, "div", "fixed-test", "FIXED · COUNT ONCE");
  fixed.dataset.testFixed = "true";
}

if (scenario.id === "growth") {
  let grown = false;
  const grow = () => {
    if (grown || window.scrollY < 520) {
      return;
    }
    grown = true;
    window.removeEventListener("scroll", grow);
    appendRange(scenario.sections + 1, scenario.sections + scenario.extraSections, true);
    document.documentElement.dataset.growth = "complete";
    document.getElementById("fixture-spec").textContent += " · growth=complete";
  };
  window.addEventListener("scroll", grow, { passive: true });
  grow();
}

document.documentElement.dataset.fixtureReady = "true";
