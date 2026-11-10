import { screenshotFilename } from "./filename.js";
import { nextScrollY } from "./capture-plan.js";
import { isFixtureTab, RUN_CASES, selectSettings, classifyCapture, newReport, completeReport } from "./qa-suite.js";
import { extensionFor, normalizeSettings, shouldRetrySingleGrowth, singleImageFallback } from "./settings.js";
import {
  clearExport,
  pruneExports,
  readSegment,
  recordExport,
  releaseExport,
  stageSegment,
  verifyExport,
} from "./segment-store.js";

const SCOPE = "longpage-snap";
const ZIP_MAX_IMAGE_BYTES = 16 * 1024 * 1024;
const ZIP_MAX_ENTRIES = 80;
const jobs = new Map();
const retryOffers = new Map();
const runningSuites = new Map();

function send(tabId, type, details = {}) {
  return browser.tabs.sendMessage(tabId, { scope: SCOPE, type, ...details });
}

async function assertActive(tabId, windowId) {
  const tab = await browser.tabs.get(tabId);
  if (!tab.active || tab.windowId !== windowId) {
    throw new Error("The capture tab is no longer active.");
  }
}

async function discard(tabId, job) {
  jobs.delete(tabId);
  try {
    await clearExport(job.id, job.parts + 1);
  } catch (error) {
    console.error("LongPage Snap: temporary image cleanup failed", error);
  }
}

async function capture(tab, temporarySettings = null, automatedCase = null) {
  const { id: tabId, windowId } = tab;
  if (!Number.isInteger(tabId) || !Number.isInteger(windowId) || jobs.has(tabId)) {
    return automatedCase ? {ok:false,error:"Another capture is already running."} : undefined;
  }

  const job = {
    id: crypto.randomUUID(),
    cancelled: false,
    started: false,
    exporting: false,
    parts: 0,
    stagedBytes: 0,
  };
  jobs.set(tabId, job);
  retryOffers.delete(tabId);
  let settings;
  let retryOffer = null;

  try {
    await pruneExports();
    await recordExport(job.id, tabId, 0);
    await browser.scripting.executeScript({
      target: { tabId },
      files: ["src/locales.js", "src/frame-registration.js", "src/zip.js", "src/capture-diagnostics.js", "src/viewport-bounds.js", "src/content.js"],
    });

    const preferences = await browser.storage.local.get("settings");
    settings = temporarySettings ?? normalizeSettings(preferences.settings);
    job.started = true;
    const page = await send(tabId, "begin", { settings });
    const filename = screenshotFilename(page.title).replace(/\.jpg$/i, "." + extensionFor(settings.format));
    let targetY = 0;
    let coveredPixels = 0;
    let previousPageHeight = 0;
    let growthCount = 0;
    let growthRetries = 0;

    while (true) {
      if (job.cancelled) {
        throw new Error("Capture cancelled.");
      }
      await assertActive(tabId, windowId);

      const geometry = await send(tabId, "prepare", { y: targetY });
      if (job.cancelled) {
        throw new Error("Capture cancelled.");
      }
      await assertActive(tabId, windowId);

      const image = await browser.tabs.captureVisibleTab(
        windowId,
        settings.format === "png" ? { format: "png" } : { format: "jpeg", quality: 95 },
      );

      let state;
      try {
        state = await send(tabId, "append", { image, geometry });
      } catch (error) {
        // A page can grow after the first canvas was sized. One fresh pass
        // starts with the now-loaded document height and recalculates scale.
        // Never retry actual out-of-memory, canvas security or storage errors.
        if (job.parts === 0 && shouldRetrySingleGrowth(settings, error, growthRetries)) {
          growthRetries += 1;
          console.info("LongPage Snap: recalculating Single Image after page growth.");
          await send(tabId, "begin", { settings });
          targetY = 0;
          coveredPixels = 0;
          previousPageHeight = 0;
          growthCount = 0;
          continue;
        }
        throw error;
      }
      if (!Number.isFinite(state.coveredPixels) || state.coveredPixels <= coveredPixels) {
        throw new Error("Scrolling made no progress.");
      }

      coveredPixels = state.coveredPixels;
      if (state.pageHeight > previousPageHeight && previousPageHeight > 0) {
        growthCount += 1;
      } else {
        growthCount = 0;
      }
      previousPageHeight = state.pageHeight;

      if (growthCount >= 20) {
        throw new Error("Continuous page growth detected; capture stopped.");
      }

      if (state.complete) {
        const { parts } = await send(tabId, "finalize");
        if (!Number.isInteger(parts) || parts !== job.parts || parts < 1) {
          throw new Error("Staged image count did not match the capture.");
        }
        // Never expose a multipart export if the user chose Single Image.
        if (settings.mode === "single" && parts !== 1) {
          throw new Error("Single Image could not fit into one file. Choose Automatic export.");
        }
        if (automatedCase) {
          // No native Android downloads, no saved settings mutations.
          // Validate the actual encoded images while they are staged.
          const audit = await send(tabId, "suite-audit", {
            exportId:job.id, parts, format:settings.format,
            scenario:automatedCase.scenario, zones:automatedCase.zones,
            mode:settings.mode, limits:settings.limits,
            maxHeight:settings.maxHeight, maxFileMiB:settings.maxFileMiB,
            checkZip:Boolean(automatedCase.checkZip), scale:state.scale,
          });
          return {ok:Boolean(audit?.valid),parts,audit};
        }
        await recordExport(job.id, tabId, parts);
        job.exporting = true;
        try {
          await send(tabId, "complete", {
            filename, parts, exportId: job.id,
            zipEligible: parts > 1 && parts <= ZIP_MAX_ENTRIES &&
              job.stagedBytes > 0 && job.stagedBytes <= ZIP_MAX_IMAGE_BYTES,
          });
        } catch (error) {
          job.exporting = false;
          throw error;
        }
        return;
      }

      targetY = nextScrollY(state.coveredPixels, state.scale, geometry.height);
    }
  } catch (error) {
    if (automatedCase) {
      return {
        ok:false,
        error:job.cancelled ? "Automated test cancelled." :
          error instanceof Error ? error.message : "Automated capture failed.",
      };
    }
    // User-initiated cancellation is not an error and should close the panel.
    if (!job.cancelled) {
      const message = error instanceof Error ? error.message : "Capture failed.";
      retryOffer = temporarySettings ? null : singleImageFallback(settings, error);
      console.error("LongPage Snap:", message);
      if (job.started) {
        await send(tabId, "fail", { message, code: retryOffer?.code ?? null }).catch(() => {});
      }
    }
  } finally {
    if (!job.exporting) {
      if (job.started) {
        await send(tabId, "cleanup").catch(() => {});
      }
      await discard(tabId, job);
      // Offer the recovery only AFTER cleanup finishes and the previous job
      // has left the jobs map, so tapping Retry can start a fresh capture.
      if (retryOffer && !job.cancelled) {
        try {
          await assertActive(tabId, windowId);
          retryOffers.set(tabId, {
            windowId,
            settings: { ...settings, mode: retryOffer.mode },
          });
          const result = await send(tabId, "offer-retry", { code: retryOffer.code });
          if (!result?.offered) {
            retryOffers.delete(tabId);
          }
        } catch {
          retryOffers.delete(tabId);
        }
      }
    }
  }
}

async function openSuiteLauncher(tab) {
  await browser.scripting.executeScript({
    target:{tabId:tab.id},
    files:["src/locales.js","src/zip.js","src/qa-audit.js","src/qa-panel.js"],
  });
  const stored = await browser.storage.local.get("settings");
  await send(tab.id,"suite-open",{
    language:normalizeSettings(stored.settings).language,
  });
}

async function runSuite(tab) {
  const tabId = tab.id;
  if (runningSuites.has(tabId) || jobs.has(tabId)) {
    return;
  }
  const run = {cancelled:false, tabId};
  runningSuites.set(tabId,run);
  const report = newReport(browser.runtime.getManifest().version);
  try {
    const saved = await browser.storage.local.get("settings");
    const base = normalizeSettings(saved.settings);
    for (const testCase of RUN_CASES) {
      if (run.cancelled) {
        break;
      }
      let outcome;
      try {
        await assertActive(tabId,tab.windowId);
        const state = await send(tabId,"suite-switch",{
          scenario:testCase.scenario,
        });
        if (!state?.ready || state.scenario !== testCase.scenario ||
            state.zones < 1) {
          throw new Error("The test fixture could not switch without navigation.");
        }
        const testSettings = selectSettings(base,testCase);
        const captureResult = await capture(tab,testSettings,testCase);
        outcome = classifyCapture(testCase,captureResult);
      } catch (error) {
        outcome = {
          status:"fail",
          reason:error instanceof Error ? error.message : "Test could not run.",
        };
      }
      report.results.push({
        id:testCase.id,scenario:testCase.scenario,
        mode:testCase.mode,format:testCase.format,
        status:outcome.status,
        reason:String(outcome.reason || "").slice(0,250),
      });
      if (run.cancelled) break;
    }
  } catch (error) {
    report.error=error instanceof Error ? error.message : "Automated suite stopped.";
  } finally {
    completeReport(report,run.cancelled);
    runningSuites.delete(tabId);
    try {
      await send(tabId,"suite-end",{report});
    } catch (error) {
      console.error("LongPage Snap: could not present suite results",error);
    }
  }
}

browser.runtime.onMessage.addListener((message, sender) => {
  if (message?.scope !== SCOPE) {
    return undefined;
  }

  if (message.type === "open-settings") {
    return browser.runtime.openOptionsPage().then(() => ({ opened: true }));
  }

  const tabId = sender.tab?.id;
  if (message.type === "suite-start") {
    if (!Number.isInteger(tabId) || runningSuites.has(tabId) ||
        !isFixtureTab(sender.tab?.url)) {
      return Promise.resolve({accepted:false});
    }
    const tab = sender.tab;
    void runSuite(tab);
    return Promise.resolve({accepted:true});
  }
  if (message.type === "suite-normal-capture") {
    if (!Number.isInteger(tabId) || runningSuites.has(tabId) ||
        !isFixtureTab(sender.tab?.url)) {
      return Promise.resolve({accepted:false});
    }
    void capture(sender.tab);
    return Promise.resolve({accepted:true});
  }
  if (message.type === "dismiss-retry") {
    retryOffers.delete(tabId);
    return Promise.resolve({ dismissed: true });
  }
  if (message.type === "retry-automatic") {
    const offer = retryOffers.get(tabId);
    if (!offer || jobs.has(tabId)) {
      return Promise.resolve({ accepted: false });
    }
    // A retry token is consumed once. No saved preference is changed.
    retryOffers.delete(tabId);
    return browser.tabs.get(tabId).then((tab) => {
      if (!tab.active || tab.windowId !== offer.windowId) {
        return { accepted: false };
      }
      void capture(tab, offer.settings);
      return { accepted: true };
    }).catch(() => ({ accepted: false }));
  }
  const job = jobs.get(tabId);

  switch (message.type) {
    case "cancel":
      if (job && !job.exporting) {
        job.cancelled = true;
      }
      return Promise.resolve({ accepted: Boolean(job && !job.exporting) });
    case "stage": {
      if (!job || job.exporting || message.index !== job.parts + 1) {
        return Promise.reject(new Error("Unexpected image segment."));
      }
      const prefix = /^data:image\/(?:jpeg|png|webp);base64,/.exec(message.image);
      if (!prefix) {
        return Promise.reject(new Error("Invalid screenshot image data."));
      }
      const length = message.image.length - prefix[0].length;
      const pad = message.image.endsWith("==") ? 2 : message.image.endsWith("=") ? 1 : 0;
      const byteLength = length / 4 * 3 - pad;
      if (!Number.isSafeInteger(byteLength) || byteLength < 1) {
        return Promise.reject(new Error("Invalid screenshot image size."));
      }
      return stageSegment(job.id, message.index, message.image).then(async () => {
        job.parts += 1;
        job.stagedBytes += byteLength;
        await recordExport(job.id, tabId, job.parts);
        return { stored: true };
      });
    }
    case "read":
      return verifyExport(message.exportId, tabId, message.index)
        .then(() => readSegment(message.exportId, message.index))
        .then((image) => ({ image }));
    case "finish":
      return releaseExport(message.exportId, tabId).then(() => {
        if (job?.id === message.exportId) {
          jobs.delete(tabId);
        }
        return { finished: true };
      });
    default:
      return undefined;
  }
});

browser.action.onClicked.addListener((tab) => {
  const run = runningSuites.get(tab.id);
  if (run) {
    // A second toolbar tap cancels the remaining test cases.
    run.cancelled = true;
    const job = jobs.get(tab.id);
    if (job) {
      job.cancelled = true;
    }
    return;
  }
  if (isFixtureTab(tab.url)) {
    void openSuiteLauncher(tab).catch((error) => {
      console.error("LongPage Snap: suite launcher unavailable",error);
      void capture(tab);
    });
    return;
  }
  void capture(tab);
});

function releaseTab(tabId) {
  retryOffers.delete(tabId);
  const suite = runningSuites.get(tabId);
  if (suite) {
    suite.cancelled = true;
  }
  const job = jobs.get(tabId);
  if (job) {
    job.cancelled = true;
    if (job.exporting) {
      jobs.delete(tabId);
    }
  }
  void pruneExports(tabId).catch((error) => {
    console.error("LongPage Snap: tab cleanup failed", error);
  });
}

browser.tabs.onRemoved.addListener(releaseTab);
browser.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === "loading") {
    releaseTab(tabId);
  }
});
