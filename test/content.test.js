import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const script = readFileSync(new URL("../src/content.js", import.meta.url), "utf8");

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

function harness({ width, height, pageHeight, layoutHeight = height, storageError = false }) {
  const draws = [];
  const downloads = [];
  const buttons = [];
  const staged = new Map();
  let listener;

  function element(tag) {
    const item = {
      tag,
      style: makeStyle(),
      isConnected: true,
      setAttribute() {},
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
        drawImage(...args) {
          if (args[0]?.tag === "canvas") {
            // Firefox WebExtensions Bugzilla 1939291: canvas-to-canvas
            // copies can throw SecurityError, even for captured data URLs.
            throw new Error("The operation is insecure");
          }
          draws.push(args);
        },
      });
      item.toBlob = (callback) => callback({ type: "image/jpeg" });
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
  const document = {
    documentElement: root,
    body,
    title: "Test page",
    images: [],
    createElement: element,
    querySelectorAll: () => [],
  };
  const window = {
    scrollX: 0,
    scrollY: 0,
    innerWidth: width,
    innerHeight: height,
    visualViewport: null,
    getComputedStyle: () => ({
      position: "static",
      visibility: "visible",
      display: "block",
      opacity: "1",
    }),
    scrollTo(x, y) {
      if (typeof x === "object") {
        this.scrollY = Math.min(Math.max(0, x.top), pageHeight - layoutHeight);
      } else {
        this.scrollX = x;
        this.scrollY = y;
      }
    },
  };

  let now = 0;
  class Image {
    naturalWidth = width;
    naturalHeight = height;
    set src(_value) {
      queueMicrotask(() => this.onload());
    }
  }
  class FileReader {
    readAsDataURL() {
      this.result = "data:image/jpeg;base64,AAAA";
      queueMicrotask(() => this.onload());
    }
  }
  class MutationObserver {
    observe() {}
    disconnect() {}
  }

  const browser = {
    runtime: {
      onMessage: { addListener(callback) { listener = callback; } },
      async sendMessage(message) {
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

  vm.runInNewContext(script, {
    browser,
    document,
    window,
    navigator: { deviceMemory: 1 },
    performance: { now: () => (now += 17) },
    MutationObserver,
    Image,
    FileReader,
    requestAnimationFrame: (callback) => queueMicrotask(callback),
    console,
  });

  return {
    draws,
    downloads,
    staged,
    buttons,
    window,
    request(type, fields = {}) {
      return listener({ scope: "longpage-snap", type, ...fields });
    },
  };
}

async function runCapture(config) {
  const app = harness(config);
  const filename = "longpage-snap-Test.jpg";
  await app.request("begin");

  let covered = 0;
  let lastState;
  while (true) {
    const geometry = await app.request("prepare", { y: Math.max(0, covered - 2) });
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
  }

  const { parts } = await app.request("finalize");
  assert.equal(app.downloads.length, 0, "All frames are staged before export");
  assert.equal(app.staged.size, parts);
  await app.request("complete", { filename, parts, exportId: "test-export" });
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
  assert.deepEqual(Array.from(app.draws, (entry) => entry[4]), [100, 98, 22]);
  assert.equal(app.staged.size, 0, "Temporary image is cleared after export");
});

test("multipart export waits for explicit, individually labeled saves", async () => {
  const app = await runCapture({ width: 5000, height: 300, pageHeight: 800 });
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

  await clickButton(app, "Close");
  assert.equal(app.staged.size, 0, "Images are cleared after export is dismissed");
});

test("discard clears staged images without downloading", async () => {
  const app = await runCapture({ width: 5000, height: 300, pageHeight: 800 });
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
  assert.equal(app.lastState.remainingPixels, 20);
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
