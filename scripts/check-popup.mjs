#!/usr/bin/env node
// design-taste-frontend mobile panel checker: only the user-approved 390px scale.
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, extname, join, sep } from "node:path";

const root = resolve(import.meta.dirname, "..");
const args = process.argv.slice(2);
const index = args.indexOf("--widths");
const widths = index === -1 ? "390" : args[index + 1];
const waiver = JSON.parse(readFileSync(join(root, "test/mobile-check-waiver.json"), "utf8"));
if (widths !== "390" || waiver.viewport.width !== 390 ||
    waiver.viewport.panelMaxWidth !== 380) {
  throw new Error("Only 390px is permitted for the extension panel.");
}

function browserCandidates() {
  const roots = [process.env.PROGRAMFILES, process.env["PROGRAMFILES(X86)"],
    process.env.LOCALAPPDATA].filter(Boolean);
  const windows = roots.flatMap((root) => [
    join(root, "Google", "Chrome", "Application", "chrome.exe"),
    join(root, "Microsoft", "Edge", "Application", "msedge.exe"),
    join(root, "Chromium", "Application", "chrome.exe"),
  ]);
  return [
    process.env.CHROME_PATH, ...windows,
    "/usr/bin/google-chrome", "/usr/bin/chromium",
    "/usr/bin/chromium-browser", "/usr/bin/microsoft-edge",
  ].filter(Boolean);
}
function detectBrowserBinary() {
  const known = browserCandidates().find((path) => existsSync(path));
  if (known) {
    return known;
  }
  const locator = process.platform === "win32" ? "where" : "which";
  for (const name of ["google-chrome", "chromium", "chromium-browser",
    "chrome", "msedge", "microsoft-edge"]) {
    if (spawnSync(locator, [name], {encoding:"utf8"}).status === 0) {
      return name;
    }
  }
  throw new Error("Chrome, Chromium or Microsoft Edge is required for browser QA. " +
    "Set CHROME_PATH to the browser executable if detection fails.");
}

const chrome = detectBrowserBinary();
const output = join(root, ".mobile-check");
mkdirSync(output, { recursive:true });

const options = readFileSync(join(root, "options/options.html"), "utf8")
  .replace("<html lang=\"en\"", "<html lang=\"en\" data-preview=\"options\"")
  .replace('href="./options.css"', 'href="/options/options.css"')
  .replace('src="./options.js"', 'src="/options/options.js"')
  .replace("<script src=\"../src/locales.js\"></script>",
    "<script src=\"../test/fixtures/mock-browser.js\"></script>" +
    "<script src=\"../src/locales.js\"></script>")
  .replace("</body>",
    "<script src=\"../test/fixtures/mobile-metrics.js\"></script></body>");

const previews = new Map([
  ["/__options",options],
  ["/__panel",readFileSync(join(root, "test/fixtures/panel-preview.html"), "utf8")],
  ["/__retry",readFileSync(join(root, "test/fixtures/retry-preview.html"), "utf8")],
  ["/__zip",readFileSync(join(root, "test/fixtures/zip-preview.html"), "utf8")],
]);
const types = {".html":"text/html", ".css":"text/css", ".js":"text/javascript"};
const server = createServer((request, response) => {
  const path = new URL(request.url, "http://localhost").pathname;
  if (previews.has(path)) {
    response.writeHead(200, {"Content-Type":"text/html; charset=utf-8"});
    response.end(previews.get(path));
    return;
  }
  const file = resolve(root, "." + path);
  if (!file.startsWith(root + sep) || !existsSync(file)) {
    response.writeHead(404);
    response.end("Not found");
    return;
  }
  response.writeHead(200, {"Content-Type":types[extname(file)] ?? "text/plain"});
  response.end(readFileSync(file));
});

await new Promise((done) => server.listen(0, "127.0.0.1", done));
const port = server.address().port;


// Chrome --window-size has a 500px minimum in headless mode.
// CDP Emulation.setDeviceMetricsOverride makes the tested viewport exactly 390px.
const pause = (ms) => new Promise((done) => setTimeout(done, ms));
const profile = mkdtempSync(join(tmpdir(), "longpage-chrome-"));
const child = spawn(chrome, [
  "--headless=new", "--no-sandbox", "--disable-dev-shm-usage",
  "--no-first-run", "--no-default-browser-check",
  "--remote-debugging-port=0", "--remote-allow-origins=*",
  "--user-data-dir=" + profile, "about:blank",
], { stdio:["ignore","ignore","pipe"] });

let chromeError = "";
child.stderr.setEncoding("utf8");
child.stderr.on("data", (chunk) => { chromeError += chunk.slice(-500); });

async function connect() {
  const portFile = join(profile, "DevToolsActivePort");
  let port;
  for (let i = 0; i < 150; i += 1) {
    if (existsSync(portFile)) {
      port = Number(readFileSync(portFile, "utf8").split("\n")[0]);
      break;
    }
    if (child.exitCode !== null) {
      throw new Error("Chrome exited before debugger startup: " + chromeError);
    }
    await pause(100);
  }
  if (!port) {
    throw new Error("Chrome DevTools did not start.");
  }

  const response = await fetch("http://127.0.0.1:" + port + "/json/list");
  const targets = await response.json();
  const target = targets.find((item) => item.type === "page");
  if (!target) {
    throw new Error("No Chrome page target.");
  }

  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((done, fail) => {
    socket.addEventListener("open", done, { once:true });
    socket.addEventListener("error", fail, { once:true });
  });

  const pending = new Map();
  let serial = 0;
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (!message.id || !pending.has(message.id)) {
      return;
    }
    const { done, fail, timer } = pending.get(message.id);
    clearTimeout(timer);
    pending.delete(message.id);
    if (message.error) {
      fail(new Error(message.error.message));
    } else {
      done(message.result);
    }
  });

  function command(method, params = {}) {
    return new Promise((done, fail) => {
      const id = ++serial;
      const timer = setTimeout(() => {
        pending.delete(id);
        fail(new Error("Chrome DevTools timed out: " + method));
      }, 12000);
      pending.set(id, { done, fail, timer });
      socket.send(JSON.stringify({ id, method, params }));
    });
  }
  await command("Page.enable");
  await command("Runtime.enable");
  await command("Emulation.setDeviceMetricsOverride", {
    width:390, height:844, deviceScaleFactor:1, mobile:true,
  });
  return { socket, command };
}

let failed = false;
let client;
try {
  client = await connect();
  for (const kind of ["options","panel","retry","zip"]) {
    const url = "http://127.0.0.1:" + port + "/__" + kind;
    await client.command("Page.navigate", { url });
    const expected = "/__" + kind;
    let result;
    for (let attempt = 0; attempt < 85; attempt += 1) {
      const evaluation = await client.command("Runtime.evaluate", {
        expression: "location.pathname === " + JSON.stringify(expected) +
          " ? (document.documentElement.dataset.checkResult || '') : ''",
        returnByValue:true,
      });
      const encoded = evaluation.result?.value;
      if (encoded) {
        result = JSON.parse(decodeURIComponent(encoded));
        break;
      }
      await pause(150);
    }
    if (!result) {
      console.error("FAIL " + kind + ": inspection script did not complete");
      failed = true;
      continue;
    }

    const picture = await client.command("Page.captureScreenshot", {
      format:"png", fromSurface:true, captureBeyondViewport:false,
    });
    writeFileSync(join(output, kind + "-390.png"), Buffer.from(picture.data, "base64"));
    console.log((result.passed ? "PASS " : "FAIL ") +
      "390px " + kind + " " + JSON.stringify(result));
    failed ||= !result.passed;
  }
  console.log("WAIVER: " + waiver.waived.map((entry) => entry.check).join("; "));
  console.log("VISUALS: " + output);
} finally {
  client?.socket.close();
  child.kill();
  server.close();
  await pause(300);
  rmSync(profile, { recursive:true, force:true });
}
if (failed) {
  process.exitCode = 1;
}
