(() => {
  const KEY = "__longPageSnapController";
  if (globalThis[KEY]) {
    return;
  }
  globalThis[KEY] = true;

  const SCOPE = "longpage-snap";
  const MIB = 1024 * 1024;
  const JPEG_QUALITY = 0.86;
  let session = null;

  function measure() {
    const root = document.documentElement;
    const body = document.body;
    const viewport = window.visualViewport;
    return {
      top: viewport?.pageTop ?? window.scrollY,
      width: viewport?.width ?? window.innerWidth,
      height: viewport?.height ?? window.innerHeight,
      pageHeight: Math.max(
        root.scrollHeight,
        root.offsetHeight,
        body?.scrollHeight ?? 0,
        body?.offsetHeight ?? 0,
      ),
    };
  }

  function nextPaint() {
    return new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(resolve));
    });
  }

  function visiblePendingImages() {
    let pending = 0;
    for (const img of document.images) {
      if (img.complete) {
        continue;
      }
      const rect = img.getBoundingClientRect();
      if (rect.bottom > 0 && rect.top < window.innerHeight &&
          rect.right > 0 && rect.left < window.innerWidth) {
        pending += 1;
      }
    }
    return pending;
  }

  async function settle() {
    const started = performance.now();
    const deadline = Math.min(5000, Math.max(850, (session.lastSettlingMs || 600) * 2.5));
    let previous = "";
    let stable = 0;

    while (performance.now() - started < deadline) {
      await nextPaint();
      const state = measure();
      const signature = [
        state.top.toFixed(1),
        state.height.toFixed(1),
        state.pageHeight,
        session.mutations,
      ].join(":");

      if (signature === previous && visiblePendingImages() === 0) {
        stable += 1;
        if (stable >= 2) {
          break;
        }
      } else {
        stable = 0;
      }
      previous = signature;
    }

    session.lastSettlingMs = Math.max(100, performance.now() - started);
  }

  function saveStyle(element, property, value) {
    const oldValue = element.style.getPropertyValue(property);
    const priority = element.style.getPropertyPriority(property);
    session.styles.push({ element, property, oldValue, priority });
    element.style.setProperty(property, value, "important");
  }

  function restoreStyles() {
    if (!session) {
      return;
    }
    for (const entry of session.styles.reverse()) {
      if (entry.oldValue) {
        entry.element.style.setProperty(entry.property, entry.oldValue, entry.priority);
      } else {
        entry.element.style.removeProperty(entry.property);
      }
    }
    session.styles.length = 0;
  }

  function showOverlay(message) {
    if (!session) {
      return;
    }
    session.panel.textContent = message;
    session.host.style.opacity = "1";
  }

  function hideOverlay() {
    session.host.style.opacity = "0";
  }

  function scanPositionedElements() {
    if (!session.positionedDirty) {
      return;
    }
    session.positionedDirty = false;
    for (const element of document.querySelectorAll("*")) {
      if (element === session.host) {
        continue;
      }
      const position = window.getComputedStyle(element).position;
      if (position === "fixed" || position === "sticky") {
        session.positioned.add(element);
      }
    }
  }

  function isPinned(element, position, style) {
    if (position === "fixed") {
      return true;
    }
    const rect = element.getBoundingClientRect();
    const top = Number.parseFloat(style.top);
    const bottom = Number.parseFloat(style.bottom);
    return (
      (Number.isFinite(top) && Math.abs(rect.top - top) <= 3) ||
      (Number.isFinite(bottom) && Math.abs(window.innerHeight - rect.bottom - bottom) <= 3)
    );
  }

  function isVisible(element, style) {
    if (style.visibility === "hidden" || style.display === "none" || style.opacity === "0") {
      return false;
    }
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 &&
      rect.bottom > 0 && rect.top < window.innerHeight &&
      rect.right > 0 && rect.left < window.innerWidth;
  }

  function restoreSuppressedElements() {
    for (const element of session.suppressed) {
      const original = session.originalVisibility.get(element);
      if (original.value) {
        element.style.setProperty("visibility", original.value, original.priority);
      } else {
        element.style.removeProperty("visibility");
      }
    }
    session.suppressed.clear();
  }

  function suppressPreviouslyCaptured() {
    restoreSuppressedElements();
    scanPositionedElements();

    for (const element of session.capturedPositioned) {
      if (!element.isConnected) {
        session.capturedPositioned.delete(element);
        session.positioned.delete(element);
        continue;
      }
      const style = window.getComputedStyle(element);
      if (isVisible(element, style) && isPinned(element, style.position, style)) {
        if (!session.originalVisibility.has(element)) {
          session.originalVisibility.set(element, {
            value: element.style.getPropertyValue("visibility"),
            priority: element.style.getPropertyPriority("visibility"),
          });
        }
        element.style.setProperty("visibility", "hidden", "important");
        session.suppressed.add(element);
      }
    }
  }

  function rememberPositionedElements() {
    scanPositionedElements();
    for (const element of session.positioned) {
      if (!element.isConnected) {
        session.positioned.delete(element);
        continue;
      }
      const style = window.getComputedStyle(element);
      if (isVisible(element, style)) {
        session.capturedPositioned.add(element);
      }
    }
  }

  function createOverlay() {
    const host = document.createElement("div");
    host.style.cssText = [
      "all:initial",
      "position:fixed",
      "inset:0",
      "z-index:2147483647",
      "display:grid",
      "place-items:center",
      "background:rgba(15,18,25,.7)",
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
      "max-width:80vw",
      "text-align:center",
    ].join(";");

    const cancel = document.createElement("button");
    cancel.textContent = "Cancel";
    cancel.style.cssText = [
      "display:block",
      "margin:12px auto 0",
      "border:1px solid #777",
      "border-radius:7px",
      "background:transparent",
      "padding:6px 14px",
      "font:inherit",
      "color:white",
    ].join(";");
    cancel.addEventListener("click", () => {
      cancel.disabled = true;
      panel.textContent = "Cancelling…";
      void browser.runtime.sendMessage({ scope: SCOPE, type: "cancel" });
    });

    const wrapper = document.createElement("div");
    wrapper.append(panel, cancel);
    shadow.append(wrapper);
    document.documentElement.append(host);
    return { host, panel };
  }

  function begin() {
    if (session) {
      dispose();
    }

    const overlay = createOverlay();
    session = {
      ...overlay,
      originalX: window.scrollX,
      originalY: window.scrollY,
      styles: [],
      positioned: new Set(),
      capturedPositioned: new Set(),
      suppressed: new Set(),
      originalVisibility: new Map(),
      positionedDirty: true,
      mutations: 0,
      lastSettlingMs: 0,
      writer: null,
      failed: false,
    };

    saveStyle(document.documentElement, "scroll-behavior", "auto");
    saveStyle(document.documentElement, "scroll-snap-type", "none");
    if (document.body) {
      saveStyle(document.body, "scroll-behavior", "auto");
      saveStyle(document.body, "scroll-snap-type", "none");
    }

    session.observer = new MutationObserver((changes) => {
      session.mutations += changes.length;
      if (changes.some((change) => change.addedNodes.length || change.removedNodes.length)) {
        session.positionedDirty = true;
      }
    });
    session.observer.observe(document.documentElement, { childList: true, subtree: true });

    return { title: document.title };
  }

  async function prepare(y) {
    if (!session) {
      throw new Error("Capture session is not active.");
    }
    if (window.visualViewport && Math.abs(window.visualViewport.scale - 1) > 0.02) {
      throw new Error("Reset page zoom before capturing.");
    }

    showOverlay("Capturing page…");
    restoreSuppressedElements();
    window.scrollTo({ left: 0, top: Math.max(0, y), behavior: "instant" });
    await settle();
    suppressPreviouslyCaptured();
    await nextPaint();

    const geometry = measure();
    hideOverlay();
    await nextPaint();
    return geometry;
  }

  function memoryBudget() {
    const gib = navigator.deviceMemory;
    if (typeof gib === "number" && Number.isFinite(gib) && gib > 0) {
      return Math.max(8 * MIB, Math.min(24 * MIB, Math.floor(gib * 1024 * MIB * 0.01)));
    }
    return 20 * MIB;
  }

  function allocateSegment(writer, remainingPixels) {
    const maxHeight = Math.floor(memoryBudget() / (4 * writer.width));
    if (maxHeight < 1) {
      throw new Error("The viewport exceeds the available canvas budget.");
    }

    let height = Math.min(maxHeight, Math.max(1, remainingPixels));
    while (height >= 1) {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = writer.width;
        canvas.height = height;
        const ctx = canvas.getContext("2d", { alpha: false });
        if (!ctx) {
          throw new Error("Canvas context unavailable.");
        }
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.getImageData(canvas.width - 1, canvas.height - 1, 1, 1);

        writer.canvas = canvas;
        writer.context = ctx;
        writer.start = writer.covered;
        return;
      } catch {
        height = Math.floor(height / 2);
      }
    }
    throw new Error("Cannot allocate an image segment on this device.");
  }

  function decodeImage(dataUrl) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("Unable to decode screenshot."));
      image.src = dataUrl;
    });
  }

  function encodeJpeg(canvas) {
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error("JPEG encoding failed."));
        }
      }, "image/jpeg", JPEG_QUALITY);
    });
  }

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error("JPEG conversion failed."));
      reader.readAsDataURL(blob);
    });
  }

  async function saveSegment(writer, filename, hasNext) {
    const filled = writer.covered - writer.start;
    if (!writer.canvas || filled <= 0) {
      return;
    }

    let source = writer.canvas;
    if (filled < source.height) {
      const cropped = document.createElement("canvas");
      cropped.width = source.width;
      cropped.height = filled;
      const context = cropped.getContext("2d", { alpha: false });
      if (!context) {
        throw new Error("Unable to crop final segment.");
      }
      context.drawImage(source, 0, 0);
      source = cropped;
    }

    showOverlay("Saving JPEG…");
    const blob = await encodeJpeg(source);
    const dataUrl = await blobToDataUrl(blob);
    writer.parts += 1;

    const suffix = hasNext || writer.parts > 1
      ? "-part-" + String(writer.parts).padStart(3, "0")
      : "";
    const outputName = filename.replace(/\.jpg$/i, suffix + ".jpg");
    const anchor = document.createElement("a");
    anchor.href = dataUrl;
    anchor.download = outputName;
    anchor.style.display = "none";
    document.documentElement.append(anchor);
    try {
      anchor.click();
    } finally {
      anchor.remove();
      writer.canvas.width = 0;
      writer.canvas.height = 0;
      writer.canvas = null;
      writer.context = null;
    }
  }

  async function append(imageUrl, geometry, filename) {
    if (!session) {
      throw new Error("Capture session is not active.");
    }

    const image = await decodeImage(imageUrl);
    let writer = session.writer;
    if (!writer) {
      const scale = image.naturalWidth / geometry.width;
      if (!Number.isFinite(scale) || scale <= 0) {
        throw new Error("Invalid screenshot scale.");
      }
      writer = {
        scale,
        width: image.naturalWidth,
        covered: 0,
        canvas: null,
        context: null,
        start: 0,
        parts: 0,
      };
      session.writer = writer;
    }

    if (Math.abs(image.naturalWidth / geometry.width - writer.scale) > writer.scale * 0.02) {
      throw new Error("Viewport width changed during capture.");
    }

    const top = Math.round(geometry.top * writer.scale);
    const pagePixels = Math.ceil(measure().pageHeight * writer.scale);
    const end = Math.min(pagePixels, top + image.naturalHeight);
    if (top > writer.covered + 2) {
      throw new Error("Screenshot alignment gap detected.");
    }

    let cursor = Math.max(writer.covered, top);
    while (cursor < end) {
      if (writer.canvas && cursor >= writer.start + writer.canvas.height) {
        await saveSegment(writer, filename, true);
      }
      if (!writer.canvas) {
        allocateSegment(writer, pagePixels - writer.covered);
      }

      const length = Math.min(end - cursor, writer.start + writer.canvas.height - cursor);
      if (length <= 0) {
        throw new Error("Invalid image segment boundary.");
      }
      writer.context.drawImage(
        image,
        0, cursor - top, image.naturalWidth, length,
        0, cursor - writer.start, writer.width, length,
      );
      cursor += length;
      writer.covered = cursor;
    }

    rememberPositionedElements();
    const progress = Math.min(100, Math.floor(100 * writer.covered / pagePixels));
    showOverlay("Capturing page… " + progress + "%");

    return {
      coveredPixels: writer.covered,
      scale: writer.scale,
      pageHeight: pagePixels / writer.scale,
      complete: writer.covered >= pagePixels,
    };
  }

  async function finalize(filename) {
    if (!session?.writer) {
      throw new Error("No frames were captured.");
    }
    await saveSegment(session.writer, filename, false);
    return { saveAttempts: session.writer.parts };
  }

  function fail(message) {
    if (!session) {
      return;
    }
    session.failed = true;
    showOverlay("Capture stopped: " + message);
    session.host.style.pointerEvents = "none";
  }

  function dispose() {
    if (!session) {
      return;
    }
    session.observer?.disconnect();
    restoreSuppressedElements();
    restoreStyles();
    window.scrollTo(session.originalX, session.originalY);
    session.writer?.canvas && (session.writer.canvas.width = 0);
    session.host.remove();
    session = null;
  }

  browser.runtime.onMessage.addListener((message) => {
    if (message?.scope !== SCOPE) {
      return undefined;
    }

    switch (message.type) {
      case "begin":
        return Promise.resolve(begin());
      case "prepare":
        return prepare(message.y);
      case "append":
        return append(message.image, message.geometry, message.filename);
      case "finalize":
        return finalize(message.filename);
      case "fail":
        fail(message.message);
        return Promise.resolve({ ok: true });
      case "cleanup":
        dispose();
        return Promise.resolve({ ok: true });
      default:
        return undefined;
    }
  });
})();
