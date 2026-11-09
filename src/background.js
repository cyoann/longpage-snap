import { screenshotFilename } from "./filename.js";
import { nextScrollY } from "./capture-plan.js";
import { extensionFor, normalizeSettings, shouldRetrySingleGrowth } from "./settings.js";
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
const jobs = new Map();

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

async function capture(tab) {
  const { id: tabId, windowId } = tab;
  if (!Number.isInteger(tabId) || !Number.isInteger(windowId) || jobs.has(tabId)) {
    return;
  }

  const job = {
    id: crypto.randomUUID(),
    cancelled: false,
    started: false,
    exporting: false,
    parts: 0,
  };
  jobs.set(tabId, job);

  try {
    await pruneExports();
    await recordExport(job.id, tabId, 0);
    await browser.scripting.executeScript({
      target: { tabId },
      files: ["src/locales.js", "src/content.js"],
    });

    const preferences = await browser.storage.local.get("settings");
    const settings = normalizeSettings(preferences.settings);
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
        await recordExport(job.id, tabId, parts);
        job.exporting = true;
        try {
          await send(tabId, "complete", { filename, parts, exportId: job.id });
        } catch (error) {
          job.exporting = false;
          throw error;
        }
        return;
      }

      targetY = nextScrollY(state.coveredPixels, state.scale);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Capture failed.";
    console.error("LongPage Snap:", message);
    if (job.started) {
      await send(tabId, "fail", { message }).catch(() => {});
    }
  } finally {
    if (!job.exporting) {
      if (job.started) {
        await send(tabId, "cleanup").catch(() => {});
      }
      await discard(tabId, job);
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
  const job = jobs.get(tabId);

  switch (message.type) {
    case "cancel":
      if (job && !job.exporting) {
        job.cancelled = true;
      }
      return Promise.resolve({ accepted: Boolean(job && !job.exporting) });
    case "stage":
      if (!job || job.exporting || message.index !== job.parts + 1) {
        return Promise.reject(new Error("Unexpected image segment."));
      }
      return stageSegment(job.id, message.index, message.image).then(async () => {
        job.parts += 1;
        await recordExport(job.id, tabId, job.parts);
        return { stored: true };
      });
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
  void capture(tab);
});

function releaseTab(tabId) {
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
