#!/usr/bin/env node
// design-taste-frontend mobile panel checker: only the user-approved 390px scale.
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
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

function chromeBinary() {
  const paths = [
    process.env.CHROME_PATH,
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ].filter(Boolean);
  for (const path of paths) {
    if (existsSync(path)) {
      return path;
    }
  }
  for (const name of ["google-chrome", "chromium", "chromium-browser"]) {
    if (spawnSync("which", [name], { encoding:"utf8" }).status === 0) {
      return name;
    }
  }
  throw new Error("Chrome/Chromium is required for the mobile browser check.");
}

const chrome = chromeBinary();
const output = join(root, ".mobile-check");
mkdirSync(output, { recursive:true });

const options = readFileSync(join(root, "options/options.html"), "utf8")
  .replace("<html lang=\"en\"", "<html lang=\"en\" data-preview=\"options\"")
  .replace("<script src=\"../src/locales.js\"></script>",
    "<script src=\"../test/fixtures/mock-browser.js\"></script>" +
    "<script src=\"../src/locales.js\"></script>")
  .replace("</body>",
    "<script src=\"../test/fixtures/mobile-metrics.js\"></script></body>");

const previews = new Map([
  ["/__options",options],
  ["/__panel",readFileSync(join(root, "test/fixtures/panel-preview.html"), "utf8")],
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

async function run(kind, screenshot) {
  const url = "http://127.0.0.1:" + port + "/__" + kind;
  const cmd = [
    "--headless=new", "--no-sandbox", "--disable-dev-shm-usage",
    "--no-first-run", "--hide-scrollbars",
    "--force-device-scale-factor=1", "--window-size=390,844",
    "--virtual-time-budget=2500",
    "--user-data-dir=" + join(output, "chrome-" + kind),
    screenshot ? "--screenshot=" + join(output, kind + "-390.png") : "--dump-dom",
    url,
  ];
  return new Promise((done, fail) => {
    const child = spawn(chrome, cmd, {stdio:["ignore","pipe","pipe"]});
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    const timeout = setTimeout(() => child.kill(), 45000);
    child.on("error", fail);
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (code !== 0) {
        fail(new Error("Chrome exited " + code + ": " + stderr.slice(-600)));
      } else {
        done(stdout);
      }
    });
  });
}

let failed = false;
try {
  for (const kind of ["options","panel"]) {
    const html = await run(kind, false);
    const match = html.match(/data-check-result="([^"]+)"/);
    if (!match) {
      console.error("FAIL " + kind + ": Chrome did not return inspection metrics");
      failed = true;
      continue;
    }
    const result = JSON.parse(decodeURIComponent(match[1]));
    await run(kind, true);
    console.log((result.passed ? "PASS " : "FAIL ") + "390px " +
      kind + " " + JSON.stringify(result));
    failed ||= !result.passed;
  }
  console.log("WAIVER: " + waiver.waived.map((entry) => entry.check).join("; "));
  console.log("VISUALS: " + output);
} finally {
  server.close();
}
if (failed) {
  process.exitCode = 1;
}
