#!/usr/bin/env node
// Minimal dependency-free browser smoke suite for the public GitHub Pages lab.
// Uses the GitHub Actions runner's Chrome/Chromium and native Node 22 CDP client.
import { createServer } from "node:http";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { SCENARIOS } from "../docs/lab/data.js";

const root = resolve(fileURLToPath(new URL("../docs/", import.meta.url)));
const out = resolve(fileURLToPath(new URL("../.site-preview/", import.meta.url)));
mkdirSync(out, { recursive:true });

const chrome = [process.env.CHROME_PATH, "/usr/bin/google-chrome", "/usr/bin/chromium",
  "/usr/bin/chromium-browser"].find((path) => path && existsSync(path)) ||
  ["google-chrome", "chromium", "chromium-browser"].find(
    (name) => spawnSync("which", [name], {encoding:"utf8"}).status === 0
  );
if (!chrome) {
  throw new Error("Chrome / Chromium is required for site browser checks.");
}
const MIME = {".html":"text/html", ".js":"text/javascript", ".css":"text/css"};
const server = createServer((request, response) => {
  const requestPath = new URL(request.url, "http://localhost").pathname;
  const file = resolve(root, "." + (requestPath.endsWith("/") ? requestPath + "index.html" : requestPath));
  if (!file.startsWith(root + sep) || !existsSync(file)) {
    response.writeHead(404); response.end("Not found"); return;
  }
  response.writeHead(200, {"Content-Type":MIME[extname(file)] || "text/plain"});
  response.end(readFileSync(file));
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const port = server.address().port;
const profile = mkdtempSync(join(tmpdir(), "lps-site-"));
const child = spawn(chrome, ["--headless=new", "--no-sandbox", "--disable-dev-shm-usage",
  "--no-first-run", "--no-default-browser-check", "--disable-gpu",
  "--remote-debugging-port=0", "--remote-allow-origins=*",
  "--user-data-dir=" + profile, "about:blank"], {stdio:["ignore","ignore","pipe"]});
const pause = (ms) => new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
let stderr = "";
child.stderr.setEncoding("utf8");
child.stderr.on("data", (chunk) => { stderr += chunk.slice(-400); });

async function connect() {
  const portFile = join(profile, "DevToolsActivePort");
  let debugPort;
  for (let i = 0; i < 180; i += 1) {
    if (existsSync(portFile)) {
      debugPort = Number(readFileSync(portFile, "utf8").split("\n")[0]);
      break;
    }
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error("Chrome stopped: exit=" + child.exitCode + ", signal=" + child.signalCode + ", stderr=" + stderr);
    }
    await pause(100);
  }
  if (!debugPort) {
    throw new Error("Chrome DevTools timeout. Chrome=" + chrome + "; exit=" + child.exitCode + "; signal=" + child.signalCode + "; stderr=" + stderr.slice(-1200));
  }
  const targets = await (await fetch("http://127.0.0.1:" + debugPort + "/json/list")).json();
  const target = targets.find((item) => item.type === "page");
  if (!target) {
    throw new Error("No Chrome page target.");
  }

  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((done, fail) => {
    socket.addEventListener("open", done, {once:true});
    socket.addEventListener("error", fail, {once:true});
  });

  let nextId = 0;
  const pending = new Map();
  socket.addEventListener("message", (event) => {
    const reply = JSON.parse(event.data);
    if (!pending.has(reply.id)) {
      return;
    }
    const {done,fail,timeout} = pending.get(reply.id);
    clearTimeout(timeout);
    pending.delete(reply.id);
    reply.error ? fail(new Error(reply.error.message)) : done(reply.result);
  });

  function command(method, params = {}) {
    return new Promise((done, fail) => {
      const id = ++nextId;
      const timeout = setTimeout(() => {
        pending.delete(id);
        fail(new Error("CDP timeout: " + method));
      }, 12000);
      pending.set(id, {done,fail,timeout});
      socket.send(JSON.stringify({id,method,params}));
    });
  }
  await command("Page.enable");
  await command("Runtime.enable");
  await command("Emulation.setDeviceMetricsOverride", {
    width:390,height:844,deviceScaleFactor:1,mobile:true,
  });
  return {socket,command};
}

let browser;
let failures = 0;
async function evaluate(expression) {
  const result = await browser.command("Runtime.evaluate", {
    expression,returnByValue:true,awaitPromise:true,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.text);
  }
  return result.result?.value;
}

async function waitFor(expression, message) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (await evaluate(expression)) {
      return;
    }
    await pause(100);
  }
  throw new Error("Timeout waiting for " + message);
}

async function visit(path, readyExpr) {
  const url = "http://127.0.0.1:" + port + path;
  await browser.command("Page.navigate", {url});
  await waitFor(
    "location.pathname === " + JSON.stringify(path.split("?")[0]) +
    " && document.readyState === 'complete' && (" + readyExpr + ")",
    path,
  );
}

async function check(name, fn) {
  try {
    await fn();
    console.log("PASS " + name);
  } catch (error) {
    failures += 1;
    console.error("FAIL " + name + ": " + error.message);
  }
}

async function capture(name) {
  const shot = await browser.command("Page.captureScreenshot", {
    format:"png",fromSurface:true,captureBeyondViewport:false,
  });
  writeFileSync(join(out,name + ".png"), Buffer.from(shot.data,"base64"));
}

try {
  browser = await connect();
  await check("Mobile homepage (390px)", async () => {
    await visit("/", "!!document.querySelector('h1')");
    const info = await evaluate("({title:document.querySelector('h1')?.textContent, width:document.documentElement.clientWidth, overflow:document.documentElement.scrollWidth>390})");
    if (info.width !== 390 || info.overflow || !info.title.includes("full-page screenshot")) {
      throw new Error(JSON.stringify(info));
    }
    await capture("home-mobile");
  });

  await check("Mobile lab with all eight fixtures and sixteen checks", async () => {
    await visit("/lab/", "document.querySelectorAll('#scenario-cards .card').length===8");
    const info = await evaluate("({cards:document.querySelectorAll('#scenario-cards .card').length, rows:document.querySelectorAll('#checklist tr').length, width:document.documentElement.clientWidth, overflow:document.documentElement.scrollWidth>390})");
    if (info.cards !== 8 || info.rows !== 16 || info.width !== 390 || info.overflow) {
      throw new Error(JSON.stringify(info));
    }
    await capture("lab-mobile");
  });

  await check("Local image-verification controls render", async () => {
    await visit("/lab/verify.html", "!!document.querySelector('#inspect')");
    const ok = await evaluate("!!document.querySelector('input[type=file][multiple]') && !!document.querySelector('#mode') && document.documentElement.scrollWidth<=390");
    if (!ok) {
      throw new Error("Missing file input / mode selector or horizontal overflow.");
    }
  });

  for (const scenario of SCENARIOS) {
    await check("Fixture: " + scenario.id, async () => {
      await visit("/lab/fixture.html?case=" + scenario.id,
        "document.documentElement.dataset.fixtureReady==='true'");
      const info = await evaluate("({count:document.querySelectorAll('#zones>.zone').length, label:document.querySelector('#fixture-label').textContent, finish:document.querySelector('#finish-marker').textContent.includes('FINISH')})");
      if (info.count !== scenario.sections ||
          info.label !== scenario.id.toUpperCase() || !info.finish) {
        throw new Error(JSON.stringify(info));
      }

      if (scenario.id === "sticky") {
        const sticky = await evaluate("getComputedStyle(document.querySelector('.sticky-test')).position==='sticky' && getComputedStyle(document.querySelector('.fixed-test')).position==='fixed'");
        if (!sticky) {
          throw new Error("Sticky and fixed test markers are missing.");
        }
      }

      if (scenario.id === "growth") {
        await evaluate("window.scrollTo(0,900)");
        await waitFor("document.documentElement.dataset.growth==='complete'",
          "growth fixture append event");
        const count = await evaluate("document.querySelectorAll('#zones>.zone').length");
        if (count !== scenario.sections + scenario.extraSections) {
          throw new Error("Wrong number of dynamically appended zones: " + count);
        }
      }

      if (scenario.id === "lazy") {
        await evaluate("document.querySelector('.lazy-box').scrollIntoView()");
        await waitFor("document.querySelector('.lazy-box img').src.startsWith('data:image/svg+xml')",
          "lazy image source");
      }

      if (scenario.id === "nested") {
        const nested = await evaluate("document.querySelectorAll('.nested-scroller>div').length");
        if (nested !== 15) {
          throw new Error("Nested scroller has incorrect row count.");
        }
      }
      if (scenario.id === "wide") {
        const wide = await evaluate("document.documentElement.scrollWidth>390");
        if (!wide) {
          throw new Error("Horizontal overflow limitation not reproduced.");
        }
      }
      if (scenario.id === "baseline") {
        await capture("baseline-mobile");
      }
    });
  }

  console.log(failures ? "BROWSER SITE: FAIL (" + failures + ")" : "BROWSER SITE: PASS");
} finally {
  browser?.socket.close();
  child.kill();
  server.close();
  await pause(250);
  rmSync(profile, {recursive:true,force:true});
}
if (failures) {
  process.exitCode = 1;
}
