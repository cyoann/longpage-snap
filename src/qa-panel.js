(() => {
  const KEY = "__longPageSnapSuitePanel";
  if (globalThis[KEY]) {
    return;
  }
  const LAB = "longpage-snap";
  const HOST = "cyoann.github.io";
  if (location.hostname !== HOST ||
      location.pathname !== "/longpage-snap/lab/fixture.html") {
    return;
  }
  globalThis[KEY] = true;

  let language = "auto";
  const t = (key) => {
    const detected = browser.i18n?.getUILanguage?.() || navigator.language || "en";
    return globalThis.LongPageSnapLocales?.get(key, language, detected) || key;
  };
  const host = document.createElement("div");
  host.setAttribute("data-longpage-snap-qa", "true");
  host.style.cssText = "position:fixed;inset:0;z-index:2147483647;display:none";
  const shadow = host.attachShadow({mode:"closed"});
  const style = document.createElement("style");
  style.textContent = `
    :host{color-scheme:light dark}
    *{box-sizing:border-box}
    .backdrop{height:100%;padding:16px;display:flex;align-items:center;
      justify-content:center;overflow-y:auto;background:rgba(16,22,32,.65);
      font:14px/1.5 system-ui,sans-serif}
    .panel{background:#f8f9fb;color:#1d2630;border:1px solid #cbd3db;
      width:100%;max-width:380px;max-height:94dvh;overflow-y:auto;
      border-radius:10px;box-shadow:0 12px 35px rgba(0,0,0,.2)}
    header{padding:18px 20px;border-bottom:1px solid #dfe3e8}
    h2{margin:0;font-size:18px;letter-spacing:-.02em}
    .body{padding:18px 20px;display:grid;gap:12px}
    p{margin:0;color:#56616d}
    .summary{background:#edf1f5;border-radius:6px;padding:10px;
      font-variant-numeric:tabular-nums}
    .results{list-style:none;padding:0;margin:0;max-height:230px;overflow-y:auto}
    .results li{display:flex;align-items:baseline;justify-content:space-between;
      gap:8px;padding:8px 0;border-bottom:1px solid #e3e7ea;font-size:12px}
    .results small{font:inherit;color:#506076}
    .fail{color:#ba3737}.pass{color:#137851}.manual{color:#64718a}
    button{font:600 14px system-ui;min-height:44px;padding:10px 14px;
      border-radius:6px;border:1px solid #bbc6d2;cursor:pointer;
      background:transparent;color:inherit}
    button.primary{background:#174f91;border-color:#174f91;color:white}
    button:disabled{opacity:.5;cursor:default}
    .actions{display:grid;gap:10px}
    .note{font-size:12px}
    @media(prefers-color-scheme:dark){
      .panel{background:#1d222a;color:#f7f8fb;border-color:#424b56}
      p,.results small{color:#bbc6d5}
      header,.results li{border-color:#424b56}
      .summary{background:#29323d}
      button{border-color:#667180}
    }
  `;
  const backdrop = document.createElement("div");
  backdrop.className = "backdrop";
  const panel = document.createElement("section");
  panel.className = "panel";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-modal", "true");
  const header = document.createElement("header");
  const title = document.createElement("h2");
  header.append(title);
  const body = document.createElement("div");
  body.className = "body";
  const description = document.createElement("p");
  const summary = document.createElement("p");
  summary.className = "summary";
  summary.setAttribute("role", "status");
  summary.setAttribute("aria-live", "polite");
  const results = document.createElement("ul");
  results.className = "results";
  const actions = document.createElement("div");
  actions.className = "actions";
  const run = document.createElement("button");
  run.className = "primary";
  const normal = document.createElement("button");
  const download = document.createElement("button");
  const close = document.createElement("button");
  const note = document.createElement("p");
  note.className = "note";
  actions.append(run, normal, download, close);
  body.append(description, summary, results, actions, note);
  panel.append(header, body);
  backdrop.append(panel);
  shadow.append(style, backdrop);
  document.documentElement.append(host);
  let running = false, report = null;
  const show = () => { host.style.display = "block"; };
  const hide = () => { host.style.display = "none"; };

  function render() {
    title.textContent = t("qaTitle");
    description.textContent = report ? t("qaDoneHint") : t("qaStartHint");
    run.textContent = t("qaRun");
    normal.textContent = t("qaCaptureNormally");
    download.textContent = t("qaExport");
    close.textContent = t("qaClose");
    note.textContent = t("qaPrivacy");
    run.style.display = report || running ? "none" : "block";
    normal.style.display = report || running ? "none" : "block";
    download.style.display = report ? "block" : "none";
    close.style.display = running ? "none" : "block";
    results.replaceChildren();
    if (report) {
      const counts = report.summary || {};
      summary.textContent = t("qaSummary") + " · " +
        (counts.passed || 0) + " PASS · " +
        (counts.failed || 0) + " FAIL · " +
        (counts.manual || 0) + " MANUAL · " +
        (counts.skipped || 0) + " SKIPPED";
      for (const entry of report.results) {
        const item = document.createElement("li");
        const label = document.createElement("span");
        label.textContent = entry.id;
        const status = document.createElement("small");
        status.className = entry.status;
        status.textContent = entry.status.toUpperCase();
        status.title = entry.reason || "";
        item.append(label, status);
        results.append(item);
      }
    } else {
      summary.textContent = t("qaCaseCount");
    }
  }

  run.addEventListener("click", () => {
    if (running || report) return;
    running = true;
    hide();
    void browser.runtime.sendMessage({scope:LAB,type:"suite-start"})
      .then((response) => {
        if (!response?.accepted) {
          running = false;
          summary.textContent = t("qaStartFailed");
          render();
          show();
        }
      })
      .catch(() => {
        running = false;
        render();
        summary.textContent = t("qaStartFailed");
        show();
      });
  });
  normal.addEventListener("click", () => {
    if (running) return;
    hide();
    void browser.runtime.sendMessage({scope:LAB,type:"suite-normal-capture"});
  });
  download.addEventListener("click", () => {
    if (!report) return;
    try {
      const blob = new globalThis.Blob([JSON.stringify(report,null,2)],{
        type:"application/json",
      });
      const url = globalThis.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "longpage-snap-automated-qa-" +
        new Date().toISOString().slice(0,10) + ".json";
      document.documentElement.append(a);
      a.click();
      a.remove();
      window.setTimeout(() => globalThis.URL.revokeObjectURL(url),120000);
    } catch (error) {
      summary.textContent = t("qaExportFailed") + ": " + error.message;
    }
  });
  close.addEventListener("click", () => {
    if (!running) hide();
  });

  function settle() {
    return new Promise((resolve) => requestAnimationFrame(() =>
      requestAnimationFrame(resolve)));
  }
  browser.runtime.onMessage.addListener((message) => {
    if (message?.scope !== LAB) return undefined;
    switch (message.type) {
      case "suite-open":
        language = message.language || "auto";
        report = null;
        running = false;
        render();
        show();
        return Promise.resolve({ready:true});
      case "suite-switch":
        return (async () => {
          if (!running || typeof message.scenario !== "string") {
            return {ready:false};
          }
          document.dispatchEvent(new CustomEvent("longpage-snap:select-fixture", {
            detail:message.scenario,
          }));
          await settle();
          return {
            ready:document.documentElement.dataset.fixtureCase === message.scenario &&
              document.documentElement.dataset.fixtureReady === "true",
            scenario:document.documentElement.dataset.fixtureCase,
            zones:document.querySelectorAll("#zones>.zone").length,
          };
        })();
      case "suite-audit":
        return globalThis.LongPageSnapQAAudit.audit(message);
      case "suite-end":
        report = message.report;
        running = false;
        render();
        show();
        return Promise.resolve({shown:true});
      default:
        return undefined;
    }
  });
  render();
})();
