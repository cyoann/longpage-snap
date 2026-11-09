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
  let uiLanguage = "auto";
  const t = (key, vars = {}) => {
    const detected = browser.i18n?.getUILanguage?.() || navigator.language || "en";
    if (globalThis.LongPageSnapLocales) {
      return globalThis.LongPageSnapLocales.get(key, uiLanguage, detected, vars);
    }
    const raw = browser.i18n?.getMessage?.(key) || key;
    return raw.replace(/\{(\w+)\}/g, (_match, name) => String(vars[name] ?? ""));
  };
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
    const progress = message.match(/(\d+)\s*%/);
    if (progress) {
      session.fill.style.width = progress[1] + "%";
    }
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
      "position:fixed", "inset:0", "z-index:2147483647",
      "display:grid", "place-items:center",
      "padding:12px", "pointer-events:auto",
      "background:rgba(0,0,0,.35)",
    ].join(";");

    const shadow = host.attachShadow({ mode: "closed" });
    const styles = document.createElement("style");
    // Scoped design-taste system.css tokens for a software/product utility.
    // Only the 380px panel rules apply: no desktop hero, site nav or closing footer.
    styles.textContent = `
      :host {
        color-scheme:light dark;
        --p-bg:#fff; --p-surface:#f4f4f4; --p-ink:#111;
        --p-muted:#5c626b; --p-accent:#1a4be0;
        --p-action:#1a4be0; --p-action-ink:#fff;
        --stroke:#dadde2;
        --font-text:system-ui,-apple-system,"Segoe UI",sans-serif;
        --s-1:4px; --s-2:8px; --s-3:12px; --s-4:16px; --s-5:24px;
        --t-label:13px; --t-small:14px; --t-body:16px;
        --r-sm:4px; --r-btn:5px; --btn-h:44px;
      }
      *,*::before,*::after { box-sizing:border-box; }
      .dialog {
        width:min(100%,380px); min-width:0;
        background:var(--p-bg); color:var(--p-ink);
        border:1px solid var(--stroke);
        border-radius:8px;
        box-shadow:0 6px 22px rgba(0,0,0,.14);
        font:400 var(--t-small)/1.5 var(--font-text);
        overflow:hidden;
      }
      .header {
        min-height:54px; padding:var(--s-3) var(--s-4);
        display:flex; align-items:center; justify-content:space-between;
        border-bottom:1px solid var(--stroke);
        gap:var(--s-3);
      }
      .identity {font-size:14px; font-weight:650; letter-spacing:-.02em;}
      .settings {
        appearance:none; border:0; border-radius:var(--r-sm);
        background:none; color:var(--p-muted);
        padding:var(--s-2); text-decoration:none;
        font:500 var(--t-label)/1.2 var(--font-text);
        cursor:pointer; min-height:44px;
      }
      .settings:hover {background:var(--p-surface);color:var(--p-ink);}
      .body { padding:var(--s-5) var(--s-4); }
      .title { margin:0; font:650 18px/1.3 var(--font-text); letter-spacing:-.02em; }
      .description {
        margin:var(--s-2) 0 0; font-size:var(--t-small);
        line-height:1.5; color:var(--p-muted); overflow-wrap:anywhere;
      }
      .status {
        margin:var(--s-5) 0 var(--s-2);
        color:var(--p-ink); font-size:var(--t-label);
        font-variant-numeric:tabular-nums;
      }
      .track { height:4px; background:var(--p-surface); overflow:hidden; }
      .fill { height:100%; width:0; background:var(--p-accent); transition:width .2s ease; }
      .actions {margin-top:var(--s-5);}
      button {cursor:pointer; font:550 var(--t-small)/1.4 var(--font-text);}
      button:focus-visible {outline:2px solid var(--p-accent);outline-offset:2px;}
      button:disabled {opacity:.55; cursor:default;}
      .primary {
        display:none; width:100%; min-height:var(--btn-h);
        padding:var(--s-2) var(--s-3);
        background:var(--p-action); color:var(--p-action-ink);
        border:1px solid var(--p-action); border-radius:var(--r-btn);
      }
      .primary:hover {filter:brightness(.95);}
      .primary:active {transform:translateY(1px);}
      .danger-row {
        display:flex; justify-content:center;
        margin-top:var(--s-5); padding-top:var(--s-4);
        border-top:1px solid var(--stroke);
      }
      .secondary {
        min-height:44px; padding:var(--s-2) var(--s-4);
        border:0; border-radius:var(--r-btn);
        background:none; color:var(--p-muted);
      }
      .secondary:hover {background:var(--p-surface); color:var(--p-ink);}
      .privacy {display:none;}
      @media (prefers-color-scheme:dark) {
        :host {
          --p-bg:#202124; --p-surface:#2b2d31;
          --p-ink:#f4f4f5; --p-muted:#b9bdc5;
          --p-accent:#91b1ff; --p-action:#91b1ff;
          --p-action-ink:#131722; --stroke:#44474d;
        }
      }
      @media (prefers-reduced-motion:reduce) {
        *,*::before,*::after {transition:none!important; transform:none!important;}
      }
    `;

    const card = document.createElement("section");
    card.className = "dialog";
    card.setAttribute("role", "dialog");
    card.setAttribute("aria-label", "LongPage Snap");
    card.setAttribute("aria-modal", "true");

    const header = document.createElement("div");
    header.className = "header";
    const identity = document.createElement("span");
    identity.className = "identity";
    identity.textContent = "LongPage Snap";

    const settingsButton = document.createElement("button");
    settingsButton.className = "settings";
    settingsButton.textContent = t("settingsOpen");
    settingsButton.addEventListener("click", () => {
      void browser.runtime.sendMessage({ scope: SCOPE, type: "open-settings" });
    });
    header.append(identity, settingsButton);

    const body = document.createElement("div");
    body.className = "body";
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
      if (session?.failed) {
        dispose();
        return;
      }
      if (session?.export) {
        void finishExport();
        return;
      }
      cancel.disabled = true;
      panel.textContent = t("cancel");
      void browser.runtime.sendMessage({ scope: SCOPE, type: "cancel" });
    });

    const dangerRow = document.createElement("div");
    dangerRow.className = "danger-row";
    dangerRow.append(cancel);
    actions.append(save, dangerRow);
    body.append(title, description, panel, track, actions);
    card.append(header, body);
    shadow.append(styles, card);
    document.documentElement.append(host);
    return { host, panel, title, description, fill, track, save, cancel, dangerRow };
  }

  function begin(settings = {}) {
    if (session) {
      dispose();
    }

    uiLanguage = settings.language || "auto";
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

    if (writer.settings.mode === "single" && writer.parts !== 0) {
      throw new Error("Single Image cannot create multiple image parts.");
    }
    if (writer.settings.mode === "single" && remainingPixels > maxHeight) {
      throw new Error("The page grew beyond the single-image canvas limit. Select Automatic export.");
    }
    let height = writer.settings.mode === "single"
      ? maxHeight
      : Math.min(maxHeight, Math.max(1, remainingPixels));
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
        if (writer.settings.mode === "single") {
          throw new Error("A single image cannot fit this device's canvas. Choose Automatic export.");
        }
        height = Math.floor(height / 2);
      }
    }
    throw new Error("Cannot allocate an image segment on this device.");
  }

  function growSingleCanvas(writer, neededHeight) {
    if (writer.settings.mode !== "single" || !writer.canvas || writer.parts !== 0) {
      throw new Error("Cannot extend the current image canvas.");
    }
    if (neededHeight > writer.safeHeight) {
      throw new Error(
        "This page grew beyond the available single-image memory or dimension limit. " +
        "Choose Automatic or Split by custom limits.",
      );
    }

    const nextHeight = Math.min(
      writer.safeHeight,
      Math.max(neededHeight, Math.ceil(writer.canvas.height * 1.35)),
    );
    const usedHeight = writer.covered - writer.start;
    const pixels = writer.context.getImageData(0, 0, writer.width, usedHeight);
    const expanded = document.createElement("canvas");
    expanded.width = writer.width;
    expanded.height = nextHeight;
    const context = expanded.getContext("2d", { alpha: false });
    if (!context) {
      throw new Error("Unable to extend the single-image canvas.");
    }
    context.fillStyle = "#fff";
    context.fillRect(0, 0, writer.width, nextHeight);
    context.putImageData(pixels, 0, 0);

    writer.canvas.width = 0;
    writer.canvas.height = 0;
    writer.canvas = expanded;
    writer.context = context;
    writer.maxSegmentHeight = nextHeight;
  }

  function decodeImage(dataUrl) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("Unable to decode screenshot."));
      image.src = dataUrl;
    });
  }

  function encodeImage(canvas, settings, quality) {
    const type = MIME[settings.format] || MIME.jpeg;
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (!blob) {
          reject(new Error("Image encoding failed."));
        } else if (blob.type && blob.type !== type) {
          reject(new Error("The selected image format is not supported by this Firefox version."));
        } else {
          resolve(blob);
        }
      }, type, settings.format === "png" ? undefined : quality);
    });
  }

  function copyCanvasRows(canvas, offset, height) {
    const data = canvas.getContext("2d").getImageData(0, offset, canvas.width, height);
    const copy = document.createElement("canvas");
    copy.width = canvas.width;
    copy.height = height;
    const context = copy.getContext("2d", { alpha: false });
    if (!context) {
      throw new Error("Cannot allocate a smaller image part.");
    }
    context.putImageData(data, 0, 0);
    return copy;
  }

  async function stagePixels(writer, canvas, depth = 0) {
    let phase = "image encoding";
    let quality = writer.settings.quality / 100;
    try {
      let blob = await encodeImage(canvas, writer.settings, quality);
      const limited = writer.settings.mode !== "automatic" &&
        writer.settings.limits !== "dimensions";
      const maxBytes = writer.settings.maxFileMiB * MIB;

      if (limited && writer.settings.format !== "png") {
        while (blob.size > maxBytes && quality > 0.42) {
          quality = Math.max(0.4, quality - 0.12);
          blob = await encodeImage(canvas, writer.settings, quality);
        }
      }

      if (limited && blob.size > maxBytes) {
        if (writer.settings.mode === "single") {
          throw new Error("The single image exceeds the file-size limit. Raise the limit or select Automatic export.");
        }
        if (depth >= 12 || canvas.height < 32) {
          throw new Error("The file-size limit is too small for an image part.");
        }
        const middle = Math.floor(canvas.height / 2);
        const top = copyCanvasRows(canvas, 0, middle);
        try {
          await stagePixels(writer, top, depth + 1);
        } finally {
          top.width = 0;
          top.height = 0;
        }
        const bottom = copyCanvasRows(canvas, middle, canvas.height - middle);
        try {
          await stagePixels(writer, bottom, depth + 1);
        } finally {
          bottom.width = 0;
          bottom.height = 0;
        }
        return;
      }

      phase = "image conversion";
      const image = await blobToDataUrl(blob);
      phase = "temporary image storage";
      await browser.runtime.sendMessage({
        scope: SCOPE, type: "stage", index: writer.parts + 1, image,
      });
      writer.parts += 1;
    } catch (error) {
      const reason = typeof error?.message === "string" ? error.message : String(error);
      throw new Error("Image " + (writer.parts + 1) + " (" + phase + "): " + reason);
    }
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
    if (!writer.canvas || writer.covered <= writer.start) {
      return;
    }
    if (writer.settings.mode === "single" && writer.parts !== 0) {
      throw new Error("Single Image cannot export more than one part.");
    }

    let exportCanvas = writer.canvas;
    try {
      showOverlay(t("preparePart", { n: writer.parts + 1 }));
      // Preserve Firefox's restriction against canvas-to-canvas drawImage.
      // In Single Image mode, remove the reserved blank bottom using pixel
      // buffers instead. If trimming is too expensive, keep the full canvas.
      const usedHeight = writer.covered - writer.start;
      if (writer.settings.mode === "single" && usedHeight < writer.canvas.height) {
        try {
          exportCanvas = copyCanvasRows(writer.canvas, 0, usedHeight);
        } catch (error) {
          console.warn("LongPage Snap: could not trim single image", error);
        }
      }
      await stagePixels(writer, exportCanvas);
      if (writer.settings.mode === "single" && writer.parts !== 1) {
        throw new Error("Single Image did not produce exactly one file.");
      }
    } finally {
      if (exportCanvas !== writer.canvas) {
        exportCanvas.width = 0;
        exportCanvas.height = 0;
      }
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
      const dimensionLimits = settings.mode !== "automatic" && settings.limits !== "fileSize";
      const maxWidth = dimensionLimits ? settings.maxWidth : 8192;
      const maxHeight = dimensionLimits ? settings.maxHeight : 16384;
      let scale = Math.min(sourceScale, maxWidth / geometry.width);
      if (settings.mode === "single") {
        // Reserve space for content revealed by scrolling (lazy images, feeds).
        // A single-image capture must never turn into multiple JPEG files.
        const reserve = 1.3;
        scale = Math.min(
          scale,
          maxHeight / (pageHeight * reserve),
          16384 / (pageHeight * reserve),
          Math.sqrt(memoryBudget() / (4 * geometry.width * pageHeight * reserve)),
        );
        if (Math.floor(geometry.width * scale) < 240) {
          throw new Error("A readable single image cannot fit this device. Select Automatic or Multiple images.");
        }
      }
      const width = Math.max(1, Math.floor(geometry.width * scale));
      const safeHeight = Math.min(
        maxHeight, 16384, Math.floor(memoryBudget() / (4 * width)),
      );
      const maxSegmentHeight = settings.mode === "single"
        ? Math.min(safeHeight, Math.ceil(pageHeight * scale * 1.3))
        : safeHeight;
      writer = {
        settings, sourceScale, scale, width, maxSegmentHeight,
        safeHeight, covered: 0, canvas: null, context: null, start: 0, parts: 0,
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
        if (writer.settings.mode === "single") {
          growSingleCanvas(writer, end - writer.start);
        } else {
          await stageSegment(writer);
        }
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
    if (session.writer.settings.mode === "single" && session.writer.parts !== 1) {
      throw new Error("Single Image must produce exactly one image.");
    }
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
      showOverlay(t("requestPart", { n: index, total: state.parts }));
      const { image } = await browser.runtime.sendMessage({
        scope: SCOPE,
        type: "read",
        index,
        exportId: state.exportId,
      });
      if (!session || session.export !== state ||
          typeof image !== "string" || !/^data:image\/(?:jpeg|png|webp);base64,/.test(image)) {
        throw new Error("Image data unavailable.");
      }

      const suffix = state.parts === 1
        ? ""
        : "-part-" + String(index).padStart(3, "0");
      const anchor = document.createElement("a");
      anchor.href = image;
      anchor.download = state.filename.replace(/\.(jpg|png|webp)$/i, (_match, ext) => suffix + "." + ext);
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

        session.panel.textContent = t("saveCompleteHint");
        session.title.textContent = t("saveComplete");
        session.save.textContent = t("finishExport");
        session.dangerRow.style.display = "none";
      } else {
        session.panel.textContent = t("requestPartNext", { n: index, total: state.parts });
        session.save.textContent = t("savePart", { n: state.next, total: state.parts });
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
    session.cancel.textContent = t("discard");
    session.title.textContent = t("captureDone");
    session.description.textContent = parts === 1
      ? t("captureSingle")
      : t("captureMultiple", { n: parts });
    session.fill.style.width = "100%";
    showOverlay(parts === 1 ? t("savingLabel") : t("exportingLabel"));
    if (parts === 1) {
      await downloadNext();
      return { ready: true };
    }
    session.save.textContent = t("savePart", { n: 1, total: parts });
    session.save.style.display = "block";
    return { ready: true };
  }

  function fail(message) {
    if (!session) {
      return;
    }
    session.failed = true;
    restorePage();
    // Release the image buffer, but keep the error dialog until the user
    // explicitly closes it. Android screen recording may need time to read it.
    session.writer = null;
    session.title.textContent = t("captureFailedTitle");
    session.description.textContent = t("captureFailedHint");
    showOverlay(message);
    session.track.style.display = "none";
    session.save.style.display = "none";
    session.cancel.textContent = t("close");
    session.cancel.disabled = false;
    session.dangerRow.style.display = "flex";
    session.host.style.pointerEvents = "auto";
  }

  function dispose() {
    if (!session) {
      return;
    }
    restorePage();
    session.host.remove();
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
        // Background has already cleared the temporary export records.
        // Do not dismiss the error panel as part of automatic cleanup.
        if (session?.failed) {
          restorePage();
        } else {
          dispose();
        }
        return Promise.resolve({ ok: true });
      default:
        return undefined;
    }
  });
})();
