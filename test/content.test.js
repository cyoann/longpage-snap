import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { nextScrollY } from "../src/capture-plan.js";

const script = readFileSync(new URL("../src/content.js", import.meta.url), "utf8");
const locales = readFileSync(new URL("../src/locales.js", import.meta.url), "utf8");
const zipSource = readFileSync(new URL("../src/zip.js", import.meta.url), "utf8");
const traceSource = readFileSync(new URL("../src/capture-diagnostics.js", import.meta.url), "utf8");
const viewportSource = readFileSync(new URL("../src/viewport-bounds.js", import.meta.url), "utf8");

function makeStyle() {
  const properties = new Map();
  return {
    cssText: "",
    setProperty(name, value, priority = "") {
      properties.set(name, { value, priority });
    },
    getPropertyValue(name) {
      return properties.get(name)?.value ?? "";
    },
    getPropertyPriority(name) {
      return properties.get(name)?.priority ?? "";
    },
    removeProperty(name) {
      properties.delete(name);
    },
  };
}

function harness({
  width, height, pageHeight, layoutHeight = height, storageError = false,
  growAtScrollY = Infinity, growToPageHeight = pageHeight,
  enableZip = false, zipError = false, enableTrace = false,
  screenshotHeight = height, viewportLagAtBottom = 0,
}) {
  const draws = [];
  const created = [];
  const downloads = [];
  const buttons = [];
  const staged = new Map();
  const messages = [];
  const zipBlobs = new Map();
  let listener;

  function element(tag) {
    const item = {
      tag,
      style: makeStyle(),
      isConnected: true,
      attributes: {},
      setAttribute(name, value) {
        this.attributes[name] = value;
      },
      append() {},
      remove() {
        this.isConnected = false;
      },
      addEventListener(type, callback) {
        if (type === "click") {
          this.click = callback;
        }
      },
      attachShadow() {
        return { append() {} };
      },
      getBoundingClientRect() {
        return { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 };
      },
    };
    created.push(item);
    if (tag === "button") {
      buttons.push(item);
    }
    if (tag === "a") {
      item.click = () => downloads.push({ filename: item.download, href: item.href });
    }
    if (tag === "canvas") {
      item.getContext = () => ({
        fillRect() {},
        getImageData() {
          return { data: new Uint8ClampedArray([255, 255, 255, 255]) };
        },
        putImageData() {},
        drawImage(...args) {
          if (args[0]?.tag === "canvas") {
            // Firefox WebExtensions Bugzilla 1939291: canvas-to-canvas
            // copies can throw SecurityError, even for captured data URLs.
            throw new Error("The operation is insecure");
          }
          draws.push(args);
        },
      });
      item.toBlob = (callback, type) => callback({
        type, size: Math.ceil(item.width * item.height * 0.5),
      });
    }
    return item;
  }

  const root = element("html");
  root.scrollHeight = pageHeight;
  root.offsetHeight = pageHeight;
  root.clientHeight = layoutHeight;
  const body = element("body");
  body.scrollHeight = pageHeight;
  body.offsetHeight = pageHeight;
  let spacerHeight = 0;
  body.append = (child) => {
    if (child.attributes["data-longpage-snap-end-spacer"] !== "true") {
      return;
    }
    const height = Number.parseFloat(child.style.getPropertyValue("height"));
    assert.ok(Number.isFinite(height) && height > 0, "Recovery spacer must have a height");
    spacerHeight += height;
    root.scrollHeight += height;
    root.offsetHeight += height;
    body.scrollHeight += height;
    body.offsetHeight += height;
    const originalRemove = child.remove;
    child.remove = () => {
      spacerHeight -= height;
      root.scrollHeight -= height;
      root.offsetHeight -= height;
      body.scrollHeight -= height;
      body.offsetHeight -= height;
      originalRemove.call(child);
    };
  };
  const document = {
    documentElement: root,
    body,
    title: "Test page",
    images: [],
    createElement: element,
    querySelectorAll: () => [],
    querySelector: () => null,
  };
  const window = {
    scrollX: 0,
    scrollY: 0,
    innerWidth: width,
    innerHeight: height,
    visualViewport: null,
    location: enableTrace ? {
      hostname:"cyoann.github.io",
      pathname:"/longpage-snap/lab/fixture.html",
      search:"?case=sticky",
    } : undefined,
    setTimeout() { return 1; },
    getComputedStyle: () => ({
      position: "static",
      visibility: "visible",
      display: "block",
      opacity: "1",
    }),
    scrollTo(x, y) {
      if (typeof x === "object") {
        if (x.top >= growAtScrollY) {
          root.scrollHeight = growToPageHeight + spacerHeight;
          root.offsetHeight = growToPageHeight + spacerHeight;
          body.scrollHeight = growToPageHeight + spacerHeight;
          body.offsetHeight = growToPageHeight + spacerHeight;
        }
        this.scrollY = Math.min(Math.max(0, x.top), root.scrollHeight - layoutHeight);
      } else {
        this.scrollX = x;
        this.scrollY = y;
      }
    },
  };

  if (viewportLagAtBottom) {
    window.visualViewport = {
      width, height, scale: 1,
      get pageTop() {
        return window.scrollY >= root.scrollHeight - layoutHeight - 1
          ? window.scrollY - viewportLagAtBottom
          : window.scrollY;
      },
    };
  }

  let now = 0;
  class Image {
    naturalWidth = width;
    naturalHeight = screenshotHeight;
    set src(_value) {
      queueMicrotask(() => this.onload());
    }
  }
  class FileReader {
    readAsDataURL(blob) {
      this.result = "data:" + blob.type + ";base64,AAAA";
      queueMicrotask(() => this.onload());
    }
  }
  class MutationObserver {
    observe() {}
    disconnect() {}
  }

  const browser = {
    i18n: {
      getUILanguage() { return "en-US"; },
      getMessage(key) {
        const strings = {
          savePart: "Save image {n} of {total}",
          discard: "Discard",
          finishExport: "Close",
          saveCompleteHint: "Confirm the Firefox prompts.",
          captureProgress: "Capturing · {n}%",
          preparingImage: "Preparing image {n}",
          requestPart: "Requesting image {n} of {total}",
          requestPartNext: "Image {n} of {total} requested.",
          captureDone: "Capture complete",
          captureSingle: "Your screenshot is ready.",
          captureMultiple: "{n} images ready.",
          captureError: "Capture stopped: {error}",
          saveSingle: "Save image",
          cancel: "Cancel",
        };
        return strings[key] ?? key;
      },
    },
    runtime: {
      onMessage: { addListener(callback) { listener = callback; } },
      async sendMessage(message) {
        messages.push(message);
        switch (message.type) {
          case "stage":
            if (storageError) {
              throw new Error("The operation is insecure");
            }
            staged.set(message.index, message.image);
            return { stored: true };
          case "read":
            return { image: staged.get(message.index) };
          case "finish":
            staged.clear();
            return { finished: true };
          default:
            return { accepted: true };
        }
      },
    },
  };

  const sandbox = vm.createContext({
    browser,
    document,
    window,
    navigator: { deviceMemory: 1, language: "en-US" },
    performance: { now: () => (now += 17) },
    MutationObserver,
    Image,
    FileReader,
    URL: {
      createObjectURL(blob) {
        if (zipError) {
          throw new Error("Firefox rejected the ZIP blob");
        }
        const url = "blob:longpage-snap-test-" + (zipBlobs.size + 1);
        zipBlobs.set(url, blob);
        return url;
      },
      revokeObjectURL(url) { zipBlobs.delete(url); },
    },
    Blob, TextEncoder, atob, Uint32Array, Uint8Array, URLSearchParams,
    requestAnimationFrame: (callback) => queueMicrotask(callback),
    console,
  });
  vm.runInContext(locales, sandbox);
  vm.runInContext(viewportSource, sandbox);
  if (enableZip) {
    vm.runInContext(zipSource, sandbox);
  }
  if (enableTrace) {
    vm.runInContext(traceSource, sandbox);
  }
  vm.runInContext(script, sandbox);

  return {
    created,
    draws,
    downloads,
    staged,
    messages,
    zipBlobs,
    buttons,
    window,
    request(type, fields = {}) {
      return listener({ scope: "longpage-snap", type, ...fields });
    },
  };
}

async function runCapture(config) {
  const app = harness(config);
  const ext = config.captureSettings?.format === "jpeg" || !config.captureSettings?.format
    ? "jpg" : config.captureSettings.format;
  const filename = "longpage-snap-Test." + ext;
  await app.request("begin", { settings: config.captureSettings ?? {} });

  let covered = 0;
  let targetY = 0;
  let lastState;
  while (true) {
    const geometry = await app.request("prepare", { y: targetY });
    const state = await app.request("append", {
      geometry,
      image: "data:image/jpeg;base64,AAAA",
    });
    assert.ok(state.coveredPixels > covered, "Each screenshot must extend coverage");
    assert.equal(app.downloads.length, 0, "No downloads during scrolling");
    covered = state.coveredPixels;
    lastState = state;
    if (state.complete) {
      break;
    }
    targetY = nextScrollY(state.coveredPixels, state.scale, geometry.height);
  }

  const { parts } = await app.request("finalize");
  assert.equal(app.downloads.length, 0, "All frames are staged before export");
  assert.equal(app.staged.size, parts);
  await app.request("complete", {
    filename, parts, exportId: "test-export",
    zipEligible: Boolean(config.allowZip),
  });
  assert.equal(app.window.scrollY, 0, "Page position restored before download");

  return { ...app, parts, lastState };
}

async function clickButton(app, text) {
  const button = app.buttons.find((item) => item.textContent === text);
  assert.ok(button, "Missing button: " + text);
  button.click();
  await new Promise((resolve) => setImmediate(resolve));
}

test("single JPEG downloads automatically after complete capture", async () => {
  const app = await runCapture({ width: 100, height: 100, pageHeight: 220 });
  assert.equal(app.parts, 1);
  assert.equal(app.downloads.length, 1);
  assert.equal(app.downloads[0].filename, "longpage-snap-Test.jpg");
  assert.equal(
    app.draws.reduce((sum, entry) => sum + entry[4], 0), 220,
    "All page pixels are stitched once without gaps or duplicates",
  );
  assert.equal(app.staged.size, 0, "Temporary image is cleared after export");
});

test("multipart export waits for explicit, individually labeled saves", async () => {
  const app = await runCapture({ width: 5000, height: 300, pageHeight: 800, captureSettings: { maxWidth: 10000 } });
  assert.equal(app.parts, 2);
  assert.equal(app.downloads.length, 0, "No download until the user chooses to save");
  assert.equal(app.staged.size, 2);

  await clickButton(app, "Save image 1 of 2");
  assert.equal(app.downloads.length, 1);
  assert.equal(app.downloads[0].filename, "longpage-snap-Test-part-001.jpg");
  assert.equal(app.staged.size, 2, "Images are retained until export is dismissed");

  await clickButton(app, "Save image 2 of 2");
  assert.equal(app.downloads.length, 2);
  assert.equal(app.downloads[1].filename, "longpage-snap-Test-part-002.jpg");
  assert.ok(app.downloads.every((download) => download.href.startsWith("data:image/jpeg;base64,")));

  await clickButton(app, "Done");
  assert.equal(app.staged.size, 0, "Images are cleared after export is dismissed");
});

test("discard clears staged images without downloading", async () => {
  const app = await runCapture({ width: 5000, height: 300, pageHeight: 800, captureSettings: { maxWidth: 10000 } });
  await clickButton(app, "Discard");
  assert.equal(app.downloads.length, 0);
  assert.equal(app.staged.size, 0);
});

test("finishes at Firefox Android scroll limit when screenshots are shorter than layout viewport", async () => {
  const app = await runCapture({
    width: 100,
    height: 100,
    layoutHeight: 120,
    pageHeight: 250,
  });

  assert.equal(app.window.scrollY, 0);
  assert.equal(app.lastState.complete, true);
  assert.equal(app.lastState.remainingPixels, 0,
    "The last screenshot must include the original page bottom");
  const spacers = app.created.filter((element) =>
    element.attributes["data-longpage-snap-end-spacer"] === "true");
  assert.equal(spacers.length, 1, "Capture should extend scrolling only once");
  assert.equal(spacers[0].isConnected, false, "Temporary spacer must be removed");
  assert.equal(app.downloads.length, 1);
  assert.equal(app.downloads[0].filename, "longpage-snap-Test.jpg");
});

test("Single Image preserves its footer when the screenshot viewport is shorter than layout height", async () => {
  const app = await runCapture({
    width: 400,
    height: 160,
    layoutHeight: 260,
    pageHeight: 1100,
    captureSettings: { mode: "single", maxHeight: 2048 },
  });
  assert.ok(app.lastState.remainingPixels <= 2);
  assert.equal(app.parts, 1);
  assert.equal(app.downloads.length, 1);
  assert.equal(app.downloads[0].filename, "longpage-snap-Test.jpg");
});

test("does not terminate early when the scroll position can advance", async () => {
  const app = await runCapture({
    width: 100,
    height: 100,
    layoutHeight: 100,
    pageHeight: 350,
  });
  assert.equal(app.lastState.remainingPixels, 0);
  assert.equal(app.downloads.length, 1);
});

test("labels browser storage failures with the failing capture stage", async () => {
  const app = harness({
    width: 100,
    height: 100,
    pageHeight: 200,
    storageError: true,
  });
  await app.request("begin");
  const geometry = await app.request("prepare", { y: 0 });
  await app.request("append", {
    geometry,
    image: "data:image/jpeg;base64,AAAA",
  });
  await assert.rejects(
    app.request("finalize"),
    /Image 1 \(temporary image storage\): The operation is insecure/,
  );
  await app.request("cleanup");
  assert.equal(app.downloads.length, 0);
});

test("single-image export scales tall pages instead of splitting", async () => {
  const app = await runCapture({
    width: 1000,
    height: 500,
    pageHeight: 3000,
    captureSettings: { mode: "single", maxWidth: 4096, maxHeight: 8192 },
  });
  assert.equal(app.parts, 1);
  assert.equal(app.downloads.length, 1);
  assert.equal(app.downloads[0].filename, "longpage-snap-Test.jpg");
});

test("PNG output uses matching file extension and MIME type", async () => {
  const app = await runCapture({
    width: 400, height: 200, pageHeight: 500,
    captureSettings: { format: "png", limits: "dimensions" },
  });
  assert.equal(app.parts, 1);
  assert.equal(app.downloads[0].filename, "longpage-snap-Test.png");
  assert.match(app.downloads[0].href, /^data:image\/png;base64,/);
});

test("file-size constrained exports split oversized parts", async () => {
  const app = await runCapture({
    width: 4000, height: 400, pageHeight: 1500,
    captureSettings: {
      format: "png", mode: "split", limits: "fileSize",
      maxFileMiB: 1,
    },
  });
  assert.ok(app.parts > 1);
  assert.equal(app.downloads.length, 0);
  assert.equal(app.staged.size, app.parts);
  await clickButton(app, "Discard");
  assert.equal(app.staged.size, 0);
});

test("Single Image stays one file when lazy-loaded content increases page height", async () => {
  const app = await runCapture({
    width: 400,
    height: 160,
    pageHeight: 400,
    growAtScrollY: 120,
    growToPageHeight: 620,
    captureSettings: { mode: "single" },
  });

  assert.equal(app.lastState.complete, true);
  assert.equal(app.parts, 1, "Growing pages must not create a second image");
  assert.equal(app.downloads.length, 1);
  assert.equal(app.downloads[0].filename, "longpage-snap-Test.jpg");
  assert.equal(app.staged.size, 0);
});

test("Single Image fails instead of splitting when a growing page exceeds device limits", async () => {
  await assert.rejects(
    runCapture({
      width: 4000,
      height: 500,
      pageHeight: 1000,
      growAtScrollY: 350,
      growToPageHeight: 5000,
      captureSettings: { mode: "single" },
    }),
    /page grew beyond the available single-image memory or dimension limit/i,
  );
});

test("manual French selection localizes capture and save controls", async () => {
  const app = await runCapture({
    width: 5000,
    height: 300,
    pageHeight: 800,
    captureSettings: { language: "fr", mode: "split", maxWidth: 10000 },
  });
  assert.equal(app.parts, 2);
  await clickButton(app, "Enregistrer l’image 1 sur 2");
  assert.equal(app.downloads.length, 1);
  await clickButton(app, "Supprimer");
  assert.equal(app.staged.size, 0);
});

test("failed capture stays visible after background cleanup until Close is pressed", async () => {
  const app = harness({ width: 400, height: 200, pageHeight: 600 });
  await app.request("begin", { settings: { mode: "single" } });
  const overlay = app.created.find((element) =>
    element.tag === "div" && element.style.cssText.includes("z-index:2147483647")
  );
  assert.ok(overlay, "A capture overlay should have been created");

  const errorText = "This page grew beyond the available single-image memory or dimension limit.";
  await app.request("fail", { message: errorText });
  await app.request("cleanup");

  assert.equal(overlay.isConnected, true, "Cleanup must not dismiss a capture error");
  assert.equal(overlay.style.pointerEvents, "auto", "Error panel must accept interaction");
  assert.equal(app.buttons.some((button) => button.textContent === "Close"), true);

  await clickButton(app, "Close");
  assert.equal(overlay.isConnected, false, "Close must remove the error panel");
});

test("a new capture dismisses a previous error panel", async () => {
  const app = harness({ width: 400, height: 200, pageHeight: 600 });
  await app.request("begin");
  const overlay = app.created.find((element) =>
    element.tag === "div" && element.style.cssText.includes("z-index:2147483647")
  );
  await app.request("fail", { message: "Unable to allocate image memory." });
  await app.request("cleanup");
  await app.request("begin");
  assert.equal(overlay.isConnected, false, "Old errors must not block a new capture");
  await app.request("cleanup");
});

test("French one-time Automatic recovery appears only after cleanup", async () => {
  const app = harness({ width: 390, height: 600, pageHeight: 5000 });
  await app.request("begin", { settings: { mode: "single", language: "fr" } });
  const reason = "A readable single image cannot fit this device. Select Automatic or Multiple images.";
  await app.request("fail", { message: reason, code: "single-image-limit" });
  const retryLabel = "Réessayer en mode automatique";
  const retry = app.buttons.find((button) => button.textContent === retryLabel);
  assert.equal(retry, undefined, "Retry must not appear before cleanup");
  await app.request("cleanup");
  const result = await app.request("offer-retry", { code: "single-image-limit" });
  assert.equal(result.offered, true);
  const primary = app.buttons.find((button) => button.textContent === retryLabel);
  assert.ok(primary, "French retry action must be visible and actionable");
  assert.equal(primary.style.display, "block");
  const panel = app.created.find((element) =>
    element.tag === "p" &&
    element.textContent?.includes("une seule image lisible"));
  assert.ok(panel, "The original English memory advice must be translated");
  await clickButton(app, retryLabel);
  assert.equal(app.messages.filter((message) => message.type === "retry-automatic").length, 1);
  await clickButton(app, retryLabel);
  assert.equal(app.messages.filter((message) => message.type === "retry-automatic").length, 1,
    "Repeated taps must not request multiple captures");
});

test("non-recoverable failures do not offer Automatic retry", async () => {
  const app = harness({ width: 390, height: 600, pageHeight: 5000 });
  await app.request("begin", { settings: { mode: "single", language: "fr" } });
  await app.request("fail", { message: "The operation is insecure.", code: null });
  await app.request("cleanup");
  const result = await app.request("offer-retry", { code: "single-image-limit" });
  assert.equal(result.offered, false);
  assert.ok(!app.buttons.some((button) => button.textContent === "Réessayer en mode automatique"));
});

test("closing a failed capture releases the pending recovery offer", async () => {
  const app = harness({ width: 390, height: 600, pageHeight: 5000 });
  await app.request("begin", { settings: { mode: "single", language: "fr" } });
  await app.request("fail", {
    message: "A readable single image cannot fit this device.",
    code: "single-image-limit",
  });
  await app.request("cleanup");
  await app.request("offer-retry", { code: "single-image-limit" });
  await clickButton(app, "Fermer");
  assert.equal(
    app.messages.filter((message) => message.type === "dismiss-retry").length,
    1,
    "Closing the dialog should invalidate background retry authorization",
  );
  assert.equal(
    app.messages.filter((message) => message.type === "retry-automatic").length,
    0,
    "Dismissing the dialog must not start an automatic capture",
  );
});

test("multi-image export offers one ZIP, then retains files until Close", async () => {
  const app = await runCapture({
    width: 5000, height: 300, pageHeight: 800,
    enableZip: true, allowZip: true,
    captureSettings: { mode: "split", maxWidth: 10000 },
  });
  assert.equal(app.parts, 2);
  assert.equal(app.downloads.length, 0);
  assert.equal(app.staged.size, 2);
  await clickButton(app, "Save all as ZIP");
  assert.equal(app.downloads.length, 1,
    "A single ZIP should replace two individual Firefox download prompts");
  assert.equal(app.downloads[0].filename, "longpage-snap-Test.zip");
  assert.match(app.downloads[0].href, /^blob:longpage-snap-test-/);
  const blob = app.zipBlobs.get(app.downloads[0].href);
  assert.ok(blob, "ZIP object URL must keep the Blob available");
  assert.equal(blob.type, "application/zip");
  assert.equal(app.staged.size, 2,
    "Keep original parts until user confirms the export is finished");
  await clickButton(app, "Done");
  assert.equal(app.staged.size, 0);
});

test("ZIP mode offers separate images and does not change persisted export mode", async () => {
  const app = await runCapture({
    width: 5000, height: 300, pageHeight: 800,
    enableZip: true, allowZip: true,
    captureSettings: { mode: "split", maxWidth: 10000, language: "fr" },
  });
  await clickButton(app, "Enregistrer les images séparément");
  await clickButton(app, "Enregistrer l’image 1 sur 2");
  await clickButton(app, "Enregistrer l’image 2 sur 2");
  assert.equal(app.downloads.length, 2);
  assert.ok(app.downloads.every((part) => part.filename.includes("-part-")));
});

test("rejected ZIP downloads can fall back to normal individual saves", async () => {
  const app = await runCapture({
    width: 5000, height: 300, pageHeight: 800,
    enableZip: true, zipError: true, allowZip: true,
    captureSettings: { mode: "split", maxWidth: 10000 },
  });
  await clickButton(app, "Save all as ZIP");
  assert.equal(app.downloads.length, 0);
  assert.equal(app.staged.size, 2,
    "ZIP errors must not discard the original screenshots");
  await clickButton(app, "Save images individually");
  await clickButton(app, "Save image 1 of 2");
  assert.equal(app.downloads.length, 1);
});

test("ZIP option is absent above the memory budget", async () => {
  const app = await runCapture({
    width: 5000, height: 300, pageHeight: 800,
    enableZip: true, allowZip: false,
    captureSettings: { mode: "split", maxWidth: 10000 },
  });
  assert.equal(app.parts, 2);
  assert.ok(!app.buttons.some((button) =>
    button.textContent === "Save all as ZIP"));
  await clickButton(app, "Save image 1 of 2");
  assert.equal(app.downloads.length, 1);
});

test("controlled fixture produces opt-in JSON telemetry, no image pixels or URLs", async () => {
  const app = await runCapture({
    width: 400, height: 240, pageHeight: 1100,
    enableTrace: true, captureSettings: { mode: "single", language: "fr" },
  });
  const label = "Télécharger les diagnostics JSON";
  const button = app.buttons.find((item) => item.textContent === label);
  assert.ok(button, "The diagnostic control should be offered only on fixtures");
  assert.equal(button.style.display, "block");
  await clickButton(app, label);
  const download = app.downloads.find((item) =>
    item.filename === "longpage-snap-trace-sticky.json");
  assert.ok(download,
    "The fixture must export a diagnostic JSON file: " + JSON.stringify(app.downloads));
  const blob = app.zipBlobs.get(download.href);
  assert.equal(blob.type, "application/json");
  const report = JSON.parse(await blob.text());
  assert.equal(report.scenario, "sticky");
  assert.ok(report.events.some((entry) => entry.kind === "prepare"));
  assert.ok(report.events.some((entry) => entry.kind === "frame"));
  assert.ok(report.events.some((entry) => entry.kind === "finish"));
  assert.ok(report.events.some((entry) =>
    entry.kind === "frame" && entry.coveredAfter > 0));
  assert.ok(!JSON.stringify(report).includes("data:image/"));
  assert.ok(!JSON.stringify(report).includes("https://"));
});

test("ordinary pages do not expose or record capture diagnostics", async () => {
  const app = await runCapture({
    width: 400, height: 240, pageHeight: 800,
    captureSettings: { mode: "single" },
  });
  assert.ok(!app.buttons.some((button) =>
    button.textContent === "Download diagnostics JSON" &&
    button.style.display === "block"),
  "The diagnostics control must remain hidden outside the lab");
});

test("Android viewport height excess cannot consume unseen Zone 11 title rows", async () => {
  const app = await runCapture({
    width: 400, height: 643, screenshotHeight: 707,
    layoutHeight: 643, pageHeight: 3334, viewportLagAtBottom: 64.4,
    captureSettings: { mode: "single" },
  });
  assert.equal(app.parts, 1);
  assert.ok(app.lastState.remainingPixels <= 2);
  const draws = app.draws.filter((args) => args.length === 9);
  assert.ok(draws.length >= 6, "Viewport cropping must produce actual scroll overlap");
  const fragments = draws.map((args) => [args[6], args[6] + args[8]]);
  fragments.sort((a, b) => a[0] - b[0]);
  let covered = 0;
  for (const [from, to] of fragments) {
    assert.ok(from <= covered + 1, "Missing vertical content at Y=" + covered);
    covered = Math.max(covered, to);
  }
  assert.ok(covered >= 3332, "The footer must be covered");
  const headingTop = 2930;
  assert.ok(fragments.some(([from, to]) => from <= headingTop && to >= 2990),
    "Zone 11 heading must belong to a valid, newly drawn frame");
});
