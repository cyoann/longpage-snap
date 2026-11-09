(() => {
  const KEY = "__longPageSnapController";
  if (globalThis[KEY]) {
    return;
  }
  globalThis[KEY] = true;

  const SCOPE = "longpage-snap";
  const MIB = 1024 * 1024;
  const DEFAULT_OPTIONS = { format: "jpeg", mode: "automatic", limits: "dimensions", maxWidth: 4096, maxHeight: 8192, maxFileMiB: 8, quality: 86 };
  const MIME = { jpeg: "image/jpeg", png: "image/png", webp: "image/webp" };
  const t = (key, vars = {}) => { const raw = browser.i18n?.getMessage(key) || key; return raw.replace(/\{(\w+)\}/g, (_match, name) => String(vars[name] ?? "")); };
  let session = null;

  function measure() {
    const root = document.documentElement;
    const body = document.body;
    const viewport = window.visualViewport;
    const scroller = document.scrollingElement ?? root;
    const layoutHeight = scroller.clientHeight || window.innerHeight;
    const maxScrollY = Math.max(0, scroller.scrollHeight - layoutHeight);
    const scrollY = Number.isFinite(scroller.scrollTop)
      ? scroller.scrollTop
      : window.scrollY;

    return {
      top: viewport?.pageTop ?? window.scrollY,
      scrollY,
      maxScrollY,
      atScrollEnd: scrollY >= maxScrollY - 1,
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
      "all:initial", "position:fixed", "inset:0", "z-index:2147483647",
      "display:grid", "place-items:center", "padding:20px",
      "background:rgba(13,18,28,.46)", "pointer-events:auto",
    ].join(";");

    const shadow = host.attachShadow({ mode: "closed" });
    const styles = document.createElement("style");
    styles.textContent = `
      :host { color-scheme: light dark; }
      *, *::before, *::after { box-sizing: border-box; }
      .dialog {
        width: min(100%, 340px);
        background: #fff; color: #1b2432;
        border: 1px solid rgba(12, 19, 29, .10);
        border-radius: 19px;
        box-shadow: 0 22px 70px rgba(7, 17, 35, .22);
        padding: 22px;
        font: 14px/1.5 system-ui, -apple-system, sans-serif;
      }
      .header { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
      .identity { display:flex; align-items:center; gap:11px; font-size:13px; font-weight:760; letter-spacing:-.01em; }
      .icon { width:32px; height:32px; border-radius:10px; display:grid; place-items:center; background:#e7f0ff; color:#1362da; font-size:20px; }
      .settings { background:none; border:none; font:inherit; font-size:12px; color:#51657e; padding:9px 2px; text-decoration:underline; text-underline-offset:3px; cursor:pointer; }
      .title { margin:24px 0 4px; font-size:19px; font-weight:760; line-height:1.35; letter-spacing:-.025em; }
      .description { margin:0; font-size:13px; color:#627083; line-height:1.55; }
      .status { margin:20px 0 12px; color:#34465c; font-size:13px; font-weight:650; }
      .track { height:5px; border-radius:99px; background:#e6ecf4; overflow:hidden; }
      .fill { height:100%; width:0%; background:#1362da; border-radius:99px; transition:width .2s ease; }
      .actions { margin-top:26px; border-top:1px solid #e6eaf0; padding-top:20px; display:grid; gap:16px; }
      button { min-height:44px; cursor:pointer; border-radius:10px; font:inherit; font-weight:650; }
      button:focus-visible { outline:3px solid #1362da; outline-offset:3px; }
      button:disabled { opacity:.6; cursor:default; }
      .primary { display:none; width:100%; padding:11px 16px; background:#1362da; border:1px solid #1362da; color:#fff; }
      .primary:hover { background:#084eb8; }
      .secondary { margin:0 auto; border:0; color:#6c3642; background:transparent; padding:8px 14px; }
      .secondary:hover { background:#f7edf0; }
      .privacy { margin:16px 0 0; font-size:11px; text-align:center; color:#7b8798; }
      @media (prefers-color-scheme: dark) {
        .dialog { background:#222a35; color:#f4f6fa; border-color:#394453; }
        .icon { background:#29466c; color:#93c3ff; }
        .settings { color:#b0c8e7; }
        .description,.privacy { color:#abb8ca; }
        .status { color:#d6e0ed; }
        .track { background:#414d5d; }
        .fill,.primary { background:#82baff; }
        .primary { color:#102033; border-color:#82baff; }
        .primary:hover { background:#a9d0ff; }
        .actions { border-color:#394453; }
        .secondary { color:#f8acb5; }
        .secondary:hover { background:#4b323b; }
      }
    `;

    const card = document.createElement("section");
    card.className = "dialog";
    card.setAttribute("role", "dialog");
    card.setAttribute("aria-label", "LongPage Snap");
    card.setAttribute("aria-modal", "true");

    const header = document.createElement("div");
    header.className = "header";
    const identity = document.createElement("div");
    identity.className = "identity";
    const mark = document.createElement("span");
    mark.className = "icon";
    mark.textContent = "▣";
    mark.setAttribute("aria-hidden", "true");
    const brand = document.createElement("span");
    brand.textContent = "LongPage Snap";
    identity.append(mark, brand);
    const settingsButton = document.createElement("button");
    settingsButton.className = "settings";
    settingsButton.textContent = t("settingsOpen");
    settingsButton.addEventListener("click", () => {
      void browser.runtime.sendMessage({ scope: SCOPE, type: "open-settings" });
    });
    header.append(identity, settingsButton);

    const title = document.createElement("h2");
    title.className = "title";
    title.textContent = t("captureTitle");
    const description = document.createElement("p");
    description.className = "description";
    description.textContent = t("captureSubtitle");
    const panel = document.createElement("p");
    panel.className = "status";
    panel.setAttribute("role", "status");
    panel.setAttribute("aria-live", "polite");
    panel.textContent = t("captureTitle");

    const track = document.createElement("div");
    track.className = "track";
    const fill = document.createElement("div");
    fill.className = "fill";
    track.append(fill);

    const actions = document.createElement("div");
    actions.className = "actions";
    const save = document.createElement("button");
    save.className = "primary";
    save.textContent = t("saveSingle");
    save.addEventListener("click", () => {
      if (session?.export?.done) {
        void finishExport();
      } else {
        void downloadNext();
      }
    });
    const cancel = document.createElement("button");
    cancel.className = "secondary";
    cancel.textContent = t("cancel");
    cancel.addEventListener("click", () => {
      if (session?.export) {
        void finishExport();
        return;
      }
      cancel.disabled = true;
      panel.textContent = t("cancel");
      void browser.runtime.sendMessage({ scope: SCOPE, type: "cancel" });
    });
    actions.append(save, cancel);

    const privacy = document.createElement("p");
    privacy.className = "privacy";
    privacy.textContent = t("privacyNote");
    card.append(header, title, description, panel, track, actions, privacy);
    shadow.append(styles, card);
    document.documentElement.append(host);
    return { host, panel, title, description, fill, track, save, cancel };
  }

  function begin(settings = {}) {
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
      settings: { ...DEFAULT_OPTIONS, ...settings },
      failed: false,
      restored: false,
      saving: false,
      export: null,
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
    const maxHeight = Math.min(Math.floor(memoryBudget() / (4 * writer.width)), writer.maxSegmentHeight);
    if (maxHeight < 1) {
      throw new Error("The viewport exceeds the available canvas budget.");
    }

    if (writer.settings.mode === "single" && remainingPixels > maxHeight) {
      throw new Error("The page grew beyond the single-image canvas limit. Select Automatic export.");
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

  async function stageSegment(writer) {
    const filled = writer.covered - writer.start;
    if (!writer.canvas || filled <= 0) {
      return;
    }

    const index = writer.parts + 1;
    let phase = "JPEG encoding";
    try {
      // On Firefox, drawing one extension-owned canvas into another can
      // taint the destination (Bugzilla 1939291). Encode the original canvas
      // directly, even when the last segment has a small white margin.
      showOverlay("Preparing image " + index + "…");
      const blob = await encodeJpeg(writer.canvas);

      phase = "JPEG conversion";
      const image = await blobToDataUrl(blob);

      phase = "temporary image storage";
      await browser.runtime.sendMessage({
        scope: SCOPE,
        type: "stage",
        index,
        image,
      });
      writer.parts += 1;
    } catch (error) {
      const reason = typeof error?.message === "string" ? error.message : String(error);
      throw new Error("Image " + index + " (" + phase + "): " + reason);
    } finally {
      writer.canvas.width = 0;
      writer.canvas.height = 0;
      writer.canvas = null;
      writer.context = null;
    }
  }

  async function append(imageUrl, geometry) {
    if (!session) {
      throw new Error("Capture session is not active.");
    }

    const image = await decodeImage(imageUrl);
    let writer = session.writer;
    if (!writer) {
      const sourceScale = image.naturalWidth / geometry.width;
      if (!Number.isFinite(sourceScale) || sourceScale <= 0) {
        throw new Error("Invalid screenshot scale.");
      }
      const settings = session.settings;
      const pageHeight = measure().pageHeight;
      const dimensionLimits = settings.limits !== "fileSize";
      const maxWidth = dimensionLimits ? settings.maxWidth : 8192;
      const maxHeight = dimensionLimits ? settings.maxHeight : 16384;
      let scale = Math.min(sourceScale, maxWidth / geometry.width);
      if (settings.mode === "single") {
        scale = Math.min(
          scale, maxHeight / pageHeight, 16384 / pageHeight,
          Math.sqrt(memoryBudget() / (4 * geometry.width * pageHeight)),
        );
        if (Math.floor(geometry.width * scale) < 240) {
          throw new Error("A readable single image cannot fit this device. Select Automatic or Multiple images.");
        }
      }
      const width = Math.max(1, Math.floor(geometry.width * scale));
      const maxSegmentHeight = settings.mode === "single"
        ? Math.ceil(pageHeight * scale)
        : Math.min(maxHeight, 16384, Math.floor(memoryBudget() / (4 * width)));
      writer = {
        settings, sourceScale, scale, width, maxSegmentHeight,
        covered: 0, canvas: null, context: null, start: 0, parts: 0,
      };
      session.writer = writer;
    }

    if (Math.abs(image.naturalWidth / geometry.width - writer.sourceScale) > writer.sourceScale * 0.02) {
      throw new Error("Viewport width changed during capture.");
    }

    const top = Math.round(geometry.top * writer.scale);
    const pagePixels = Math.ceil(measure().pageHeight * writer.scale);
    const end = Math.min(pagePixels, top + Math.floor(image.naturalHeight * writer.scale / writer.sourceScale));
    if (top > writer.covered + 2) {
      throw new Error("Screenshot alignment gap detected.");
    }

    let cursor = Math.max(writer.covered, top);
    while (cursor < end) {
      if (writer.canvas && cursor >= writer.start + writer.canvas.height) {
        await stageSegment(writer);
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
        0, (cursor - top) * writer.sourceScale / writer.scale,
        image.naturalWidth, length * writer.sourceScale / writer.scale,
        0, cursor - writer.start, writer.width, length,
      );
      cursor += length;
      writer.covered = cursor;
    }

    rememberPositionedElements();
    const progress = Math.min(100, Math.floor(100 * writer.covered / pagePixels));
    showOverlay(t("captureProgress", { n: progress }));

    return {
      coveredPixels: writer.covered,
      scale: writer.scale,
      pageHeight: pagePixels / writer.scale,
      // Firefox Android may expose less of the document in a screenshot than
      // the layout viewport can scroll. The scroll extent is authoritative.
      complete: writer.covered >= pagePixels || geometry.atScrollEnd,
      remainingPixels: Math.max(0, pagePixels - writer.covered),
    };
  }

  async function finalize() {
    if (!session?.writer) {
      throw new Error("No frames were captured.");
    }
    await stageSegment(session.writer);
    return { parts: session.writer.parts };
  }

  function restorePage() {
    if (!session || session.restored) {
      return;
    }
    session.observer?.disconnect();
    restoreSuppressedElements();
    restoreStyles();
    window.scrollTo(session.originalX, session.originalY);
    session.restored = true;
    if (session.writer?.canvas) {
      session.writer.canvas.width = 0;
      session.writer.canvas.height = 0;
    }
  }

  async function finishExport() {
    if (!session?.export || session.saving) {
      return;
    }
    session.cancel.disabled = true;
    session.save.disabled = true;
    try {
      const result = await browser.runtime.sendMessage({
        scope: SCOPE,
        type: "finish",
        exportId: session.export.exportId,
      });
      if (!result?.finished) {
        throw new Error("Unable to release temporary images.");
      }
      dispose();
    } catch (error) {
      session.panel.textContent = "Cleanup failed: " + error.message;
      session.cancel.disabled = false;
      session.save.disabled = false;
    }
  }

  async function downloadNext() {
    if (!session?.export || session.saving || session.export.done) {
      return;
    }
    session.saving = true;
    session.save.disabled = true;
    const state = session.export;
    const index = state.next;

    try {
      showOverlay("Requesting image " + index + " of " + state.parts + "…");
      const { image } = await browser.runtime.sendMessage({
        scope: SCOPE,
        type: "read",
        index,
        exportId: state.exportId,
      });
      if (!session || session.export !== state ||
          typeof image !== "string" || !image.startsWith("data:image/jpeg;base64,")) {
        throw new Error("Image data unavailable.");
      }

      const suffix = state.parts === 1
        ? ""
        : "-part-" + String(index).padStart(3, "0");
      const anchor = document.createElement("a");
      anchor.href = image;
      anchor.download = state.filename.replace(/\.jpg$/i, suffix + ".jpg");
      anchor.style.display = "none";
      document.documentElement.append(anchor);
      try {
        anchor.click();
      } finally {
        anchor.remove();
      }

      state.next += 1;
      if (state.next > state.parts) {
        state.done = true;
        if (state.parts === 1) {
          session.saving = false;
          await finishExport();
          return;
        }

        session.panel.textContent =
          "All " + state.parts + " download requests sent. Confirm each Firefox prompt and check Downloads.";
        session.save.textContent = "Close";
        session.cancel.style.display = "none";
      } else {
        session.panel.textContent =
          "Image " + index + " of " + state.parts +
          " requested. Confirm the Firefox dialog, then save the next image.";
        session.save.textContent = "Save image " + state.next + " of " + state.parts;
      }
    } catch (error) {
      if (session) {
        session.panel.textContent = "Download could not start: " + error.message;
      }
    } finally {
      if (session) {
        session.saving = false;
        session.save.disabled = false;
      }
    }
  }

  async function complete({ parts, filename, exportId }) {
    if (!session || !Number.isInteger(parts) || parts < 1 ||
        typeof exportId !== "string" || !exportId) {
      throw new Error("Invalid capture result.");
    }

    restorePage();
    session.export = { parts, filename, exportId, next: 1, done: false };
    session.cancel.textContent = "Discard";
    showOverlay(parts === 1
      ? "Capture complete. Saving JPEG…"
      : "Capture complete: " + parts +
        " JPEG images. Save every part to keep the complete page.");
    if (parts === 1) {
      await downloadNext();
      return { ready: true };
    }
    session.save.textContent = "Save image 1 of " + parts;
    session.save.style.display = "block";
    return { ready: true };
  }

  function fail(message) {
    if (!session) {
      return;
    }
    session.failed = true;
    restorePage();
    showOverlay("Capture stopped: " + message);
    session.host.style.pointerEvents = "none";
  }

  function dispose() {
    if (!session) {
      return;
    }
    restorePage();
    const failed = session.failed;
    const host = session.host;
    if (failed) {
      window.setTimeout(() => host.remove(), 5000);
    } else {
      host.remove();
    }
    session = null;
  }

  browser.runtime.onMessage.addListener((message) => {
    if (message?.scope !== SCOPE) {
      return undefined;
    }

    switch (message.type) {
      case "begin":
        return Promise.resolve(begin(message.settings));
      case "prepare":
        return prepare(message.y);
      case "append":
        return append(message.image, message.geometry, message.filename);
      case "finalize":
        return finalize();
      case "complete":
        return complete(message);
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
