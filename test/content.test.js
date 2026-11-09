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

function harness({ width, height, pageHeight }) {
  const draws = [];
  const downloads = [];
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
      addEventListener() {},
      attachShadow() {
        return { append() {} };
      },
      getBoundingClientRect() {
        return { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 };
      },
    };
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
        this.scrollY = Math.min(Math.max(0, x.top), pageHeight - height);
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
      sendMessage: async () => ({ accepted: true }),
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
  while (true) {
    const geometry = await app.request("prepare", { y: Math.max(0, covered - 2) });
    const state = await app.request("append", {
      geometry,
      image: "data:image/jpeg;base64,AAAA",
      filename,
    });
    assert.ok(state.coveredPixels > covered, "Each screenshot must extend coverage");
    covered = state.coveredPixels;
    if (state.complete) {
      break;
    }
  }

  await app.request("finalize", { filename });
  await app.request("cleanup");
  return app;
}

test("stitches overlapping frames without repeated rows", async () => {
  const app = await runCapture({ width: 100, height: 100, pageHeight: 220 });
  assert.equal(app.downloads.length, 1);
  assert.equal(app.downloads[0].filename, "longpage-snap-Test.jpg");
  assert.deepEqual(Array.from(app.draws, (entry) => entry[4]), [100, 98, 22]);
  assert.equal(app.window.scrollY, 0);
});

test("exports separate JPEGs when the memory budget is exceeded", async () => {
  const app = await runCapture({ width: 5000, height: 300, pageHeight: 800 });
  assert.equal(app.downloads.length, 2);
  assert.deepEqual(
    app.downloads.map((download) => download.filename),
    ["longpage-snap-Test-part-001.jpg", "longpage-snap-Test-part-002.jpg"],
  );
  assert.ok(app.downloads.every((download) => download.href.startsWith("data:image/jpeg;base64,")));
});
