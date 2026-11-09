(() => {
  const KEY = "__longPageSnapController";
  if (globalThis[KEY]) {
    return;
  }
  globalThis[KEY] = true;

  const SCOPE = "longpage-snap";
  let session = null;

  function dispose() {
    session?.host.remove();
    session = null;
  }

  function begin() {
    dispose();

    const host = document.createElement("div");
    host.style.cssText = [
      "all:initial",
      "position:fixed",
      "inset:0",
      "z-index:2147483647",
      "display:grid",
      "place-items:center",
      "background:rgba(16,19,26,.70)",
      "pointer-events:auto",
    ].join(";");

    const shadow = host.attachShadow({ mode: "closed" });
    const panel = document.createElement("div");
    panel.setAttribute("role", "status");
    panel.setAttribute("aria-live", "polite");
    panel.style.cssText = [
      "font:600 15px/1.4 system-ui,sans-serif",
      "color:#fff",
      "background:#252a36",
      "padding:18px 22px",
      "border-radius:12px",
      "box-shadow:0 6px 24px #0004",
    ].join(";");
    panel.textContent = "Capturing page…";
    shadow.append(panel);
    document.documentElement.append(host);

    session = { host, panel, failed: false };
    return { title: document.title };
  }

  function nextPaint() {
    return new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(resolve));
    });
  }

  async function prepareFrame() {
    if (!session) {
      throw new Error("Capture session was not initialized.");
    }

    // Keep the interaction blocker active without including it in the image.
    session.host.style.opacity = "0";
    await nextPaint();
    return { ready: true };
  }

  function restoreOverlay() {
    if (session) {
      session.host.style.opacity = "1";
    }
  }

  function save(image, filename) {
    if (!session || !image?.startsWith("data:image/jpeg;base64,")) {
      throw new Error("Invalid capture data.");
    }

    restoreOverlay();
    session.panel.textContent = "Saving JPEG…";

    const anchor = document.createElement("a");
    anchor.href = image;
    anchor.download = filename;
    anchor.style.display = "none";
    document.documentElement.append(anchor);
    try {
      anchor.click();
    } finally {
      anchor.remove();
    }
    return { attempted: true };
  }

  function reportError(message) {
    if (!session) {
      return;
    }

    restoreOverlay();
    session.failed = true;
    session.host.style.pointerEvents = "none";
    session.panel.textContent = `Capture failed: ${message}`;
    const failedSession = session;
    setTimeout(() => {
      if (session === failedSession) {
        dispose();
      }
    }, 5000);
  }

  browser.runtime.onMessage.addListener((message) => {
    if (message?.scope !== SCOPE) {
      return undefined;
    }

    switch (message.type) {
      case "start":
        return Promise.resolve(begin());
      case "ready":
        return prepareFrame();
      case "restore":
        restoreOverlay();
        return Promise.resolve({ ok: true });
      case "save":
        return Promise.resolve(save(message.image, message.filename));
      case "error":
        reportError(message.message);
        return Promise.resolve({ ok: true });
      case "finish":
        if (!session?.failed) {
          dispose();
        }
        return Promise.resolve({ ok: true });
      default:
        return undefined;
    }
  });
})();
