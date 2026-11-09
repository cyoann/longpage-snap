import { screenshotFilename } from "./filename.js";
import { nextScrollY } from "./capture-plan.js";
import { clearSegments, readSegment, stageSegment } from "./segment-store.js";

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
    await clearSegments(job.id, job.parts);
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
    await browser.scripting.executeScript({
      target: { tabId },
      files: ["src/content.js"],
    });

    job.started = true;
    const page = await send(tabId, "begin");
    const filename = screenshotFilename(page.title);
    let targetY = 0;
    let coveredPixels = 0;
    let previousPageHeight = 0;
    let growthCount = 0;

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

      const image = await browser.tabs.captureVisibleTab(windowId, {
        format: "jpeg",
        quality: 95,
      });

      const state = await send(tabId, "append", { image, geometry });
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
        job.exporting = true;
        try {
          await send(tabId, "complete", { filename, parts });
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
      return stageSegment(job.id, message.index, message.image).then(() => {
        job.parts += 1;
        return { stored: true };
      });
    case "read":
      if (!job?.exporting || !Number.isInteger(message.index) ||
          message.index < 1 || message.index > job.parts) {
        return Promise.reject(new Error("Image export is unavailable."));
      }
      return readSegment(job.id, message.index).then((image) => ({ image }));
    case "finish":
      if (!job?.exporting) {
        return Promise.resolve({ finished: false });
      }
      return discard(tabId, job).then(() => ({ finished: true }));
    default:
      return undefined;
  }
});

browser.action.onClicked.addListener((tab) => {
  void capture(tab);
});
