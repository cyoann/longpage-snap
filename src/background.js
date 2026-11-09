import { screenshotFilename } from "./filename.js";
import { nextScrollY } from "./capture-plan.js";

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

async function capture(tab) {
  const { id: tabId, windowId } = tab;
  if (!Number.isInteger(tabId) || !Number.isInteger(windowId) || jobs.has(tabId)) {
    return;
  }

  const job = { cancelled: false, started: false };
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

      const state = await send(tabId, "append", { image, geometry, filename });
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
        await send(tabId, "finalize", { filename });
        break;
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
    if (job.started) {
      await send(tabId, "cleanup").catch(() => {});
    }
    jobs.delete(tabId);
  }
}

browser.runtime.onMessage.addListener((message, sender) => {
  if (message?.scope !== SCOPE || message.type !== "cancel") {
    return undefined;
  }

  const tabId = sender.tab?.id;
  const job = jobs.get(tabId);
  if (job) {
    job.cancelled = true;
  }
  return Promise.resolve({ accepted: Boolean(job) });
});

browser.action.onClicked.addListener((tab) => {
  void capture(tab);
});
