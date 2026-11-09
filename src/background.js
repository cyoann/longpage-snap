import { screenshotFilename } from "./filename.js";

const busyTabs = new Set();
const MESSAGE_SCOPE = "longpage-snap";

async function send(tabId, type, details = {}) {
  return browser.tabs.sendMessage(tabId, {
    scope: MESSAGE_SCOPE,
    type,
    ...details,
  });
}

async function capture(tab) {
  const tabId = tab.id;
  if (tabId == null || tab.windowId == null || busyTabs.has(tabId)) {
    return;
  }

  busyTabs.add(tabId);
  let injected = false;

  try {
    await browser.scripting.executeScript({
      target: { tabId },
      files: ["src/content.js"],
    });
    injected = true;

    const page = await send(tabId, "start");
    await send(tabId, "ready");

    const current = await browser.tabs.get(tabId);
    if (!current.active || current.windowId !== tab.windowId) {
      throw new Error("The page is no longer the active tab.");
    }

    const image = await browser.tabs.captureVisibleTab(tab.windowId, {
      format: "jpeg",
      quality: 88,
    });

    await send(tabId, "restore");
    await send(tabId, "save", {
      image,
      filename: screenshotFilename(page.title),
    });
  } catch (error) {
    console.error("LongPage Snap: capture failed", error);
    if (injected) {
      await send(tabId, "error", {
        message: error instanceof Error ? error.message : "Capture failed.",
      }).catch(() => {});
    }
  } finally {
    if (injected) {
      await send(tabId, "finish").catch(() => {});
    }
    busyTabs.delete(tabId);
  }
}

browser.action.onClicked.addListener((tab) => {
  void capture(tab);
});
