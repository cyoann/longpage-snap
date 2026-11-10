// Fixture-only visual audit. It inspects decoded, locally staged screenshots
// without downloads, uploads, OCR, or persisted image bytes.
(() => {
  const SCOPE = "longpage-snap";
  const MAX_PARTS = 80;
  const MAX_MARKERS = 80;
  const MIB = 1024 * 1024;
  const FORMAT_MIME = Object.freeze({
    jpeg:"image/jpeg", png:"image/png", webp:"image/webp",
  });
  function rgbValue(style) {
    const match = /^rgba?\(\s*(\d+)[ ,]+(\d+)[ ,]+(\d+)/i.exec(style);
    return match ? match.slice(1, 4).map(Number) : null;
  }
  function markerRect(node) {
    const rect = node.getBoundingClientRect();
    return {
      x:rect.left + window.scrollX, y:rect.top + window.scrollY,
      width:rect.width, height:rect.height,
    };
  }
  function markersForFixture(scenario, expectedZones) {
    const zones = [...document.querySelectorAll("#zones > .zone")];
    if (zones.length !== expectedZones || zones.length > MAX_MARKERS) {
      throw new Error("Fixture zone count differs from expected.");
    }
    const markers = [];
    for (let index = 0; index < zones.length; index += 1) {
      const zone = zones[index];
      const heading = zone.querySelector(".zone-number strong");
      if (!heading || zone.dataset.zone !== String(index + 1).padStart(2, "0")) {
        throw new Error("Fixture heading or zone sequence mismatch.");
      }
      const zoneBounds = markerRect(zone);
      const background = rgbValue(globalThis.getComputedStyle(zone).backgroundColor);
      if (!background) {
        throw new Error("Cannot inspect the fixture's zone colors.");
      }
      markers.push({
        id:"zone-" + String(index + 1).padStart(2, "0"),
        kind:"heading", rect:markerRect(heading),
      });
      markers.push({
        id:"color-" + String(index + 1).padStart(2, "0"),
        kind:"color",
        rect:{ x:11, y:zoneBounds.y + zoneBounds.height * 0.52,
          width:1, height:1 }, expected:background,
      });
      if (scenario === "lazy") {
        const img = zone.querySelector(".lazy-box img");
        const state = zone.querySelector(".lazy-state");
        if (!img || !img.complete || !img.naturalWidth ||
            !state?.textContent.startsWith("LOADED")) {
          throw new Error("Lazy image " + (index + 1) + " did not load.");
        }
        markers.push({
          id:"image-" + String(index + 1).padStart(2, "0"),
          kind:"blue", rect:markerRect(img),
        });
      }
    }
    const finish = document.querySelector("#finish-marker strong");
    const start = document.getElementById("start-marker");
    if (!finish || !start) {
      throw new Error("Fixture start/finish markers are missing.");
    }
    markers.push({id:"start",kind:"heading",rect:markerRect(start)});
    markers.push({id:"finish",kind:"bright",rect:markerRect(finish)});
    return markers;
  }
  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("Encoded screenshot cannot be decoded."));
      img.src = src;
    });
  }
  function visualSample(img, marker, scale, partTop, context) {
    const r = marker.rect;
    const px = r.x * scale;
    const py = r.y * scale - partTop;
    const pw = Math.max(1, r.width * scale);
    const ph = Math.max(1, r.height * scale);
    const upper = Math.max(0, py);
    const lower = Math.min(img.naturalHeight, py + ph);
    if (lower - upper < Math.min(6, ph * 0.30)) {
      return null;
    }
    const sx = marker.kind === "color" ? px : px + Math.max(0, pw * 0.05);
    const sy = marker.kind === "color" ? upper :
      Math.max(upper, py + Math.max(0, ph * 0.14));
    const sw = marker.kind === "color" ? Math.max(1, scale) : pw * 0.9;
    const sh = marker.kind === "color" ? Math.max(1, scale) :
      Math.max(1, Math.min(lower, py + ph * 0.86) - sy);
    const cw = marker.kind === "color" ? 1 : 40;
    const ch = marker.kind === "color" ? 1 : 16;
    context.canvas.width = cw;
    context.canvas.height = ch;
    context.clearRect(0, 0, cw, ch);
    context.drawImage(img, sx, sy, sw, sh, 0, 0, cw, ch);
    const values = context.getImageData(0, 0, cw, ch).data;
    if (marker.kind === "color") {
      return marker.expected.every((value, chIndex) =>
        Math.abs(value - values[chIndex]) <= 65);
    }
    let active = 0;
    for (let i = 0; i < values.length; i += 4) {
      const red = values[i], green = values[i + 1], blue = values[i + 2];
      if (marker.kind === "heading") {
        if (Math.max(red, green, blue) < 115) {
          active += 1;
        }
      } else if (marker.kind === "bright") {
        if (Math.min(red, green, blue) > 185) {
          active += 1;
        }
      } else if (marker.kind === "blue") {
        if (blue > red + 28 && blue > green + 19 && red < 160) {
          active += 1;
        }
      }
    }
    const minimum = marker.kind === "blue" ? 5 : marker.kind === "bright" ? 10 : 12;
    return active >= minimum;
  }

  async function audit({ exportId, parts, format, scenario, zones, scale,
    mode, checkZip, maxHeight, maxFileMiB, limits }) {
    if (document.documentElement.dataset.fixtureCase !== scenario ||
        !Number.isInteger(parts) || parts < 1 || parts > MAX_PARTS ||
        !Number.isFinite(scale) || scale <= 0 ||
        !Object.hasOwn(FORMAT_MIME, format)) {
      throw new Error("Invalid automated fixture result.");
    }
    const markers = markersForFixture(scenario, zones);
    const sample = document.createElement("canvas");
    const context = sample.getContext("2d", {willReadFrequently:true});
    if (!context) {
      throw new Error("Visual audit canvas is unavailable.");
    }
    const matched = new Set();

    let partTop = 0, width = 0, totalBytes = 0, zipVerified = false;
    let zipSkipped = false;
    const zip = checkZip ? new globalThis.LongPageSnapZip.StoredZip() : null;
    try {
      for (let index = 1; index <= parts; index += 1) {
        const response = await browser.runtime.sendMessage({
          scope:SCOPE, type:"read", index, exportId,
        });
        const imageUrl = response?.image;
        const prefix = /^data:image\/(jpeg|png|webp);base64,/i.exec(imageUrl);
        const actualFormat = prefix?.[1]?.toLowerCase();
        if (FORMAT_MIME[format] !== FORMAT_MIME[actualFormat]) {
          throw new Error("Image " + index + " has the wrong encoding.");
        }
        const byteSize = (imageUrl.length - prefix[0].length) / 4 * 3 -
          (imageUrl.endsWith("==") ? 2 : imageUrl.endsWith("=") ? 1 : 0);
        totalBytes += byteSize;
        const img = await loadImage(imageUrl);
        try {
          if (width && width !== img.naturalWidth) {
            throw new Error("Images have inconsistent widths.");
          }
          width = img.naturalWidth;
          if (img.naturalWidth < 1 || img.naturalHeight < 1) {
            throw new Error("Image has invalid dimensions.");
          }
          if (mode === "split" && limits !== "fileSize" &&
              maxHeight > 0 && img.naturalHeight > maxHeight) {
            throw new Error("An image exceeds the configured height.");
          }
          if (mode === "split" && limits !== "dimensions" &&
              maxFileMiB > 0 && byteSize > maxFileMiB * MIB) {
            throw new Error("An image exceeds the file-size limit.");
          }
          for (const marker of markers) {
            if (matched.has(marker.id)) {
              continue;
            }
            const y = marker.rect.y * scale;
            const lower = (marker.rect.y + marker.rect.height) * scale;
            if (lower <= partTop || y >= partTop + img.naturalHeight) {
              continue;
            }
            try {
              if (visualSample(img, marker, scale, partTop, context)) {
                matched.add(marker.id);
              } else {

              }
            } catch {

            }
          }
          partTop += img.naturalHeight;
        } finally {
          img.src = "";
        }
        if (zip && !zipSkipped) {
          if (totalBytes <= globalThis.LongPageSnapZip.MAX_IMAGE_BYTES &&
              parts <= globalThis.LongPageSnapZip.MAX_ENTRIES) {
            const ext = format === "jpeg" ? "jpg" : format;
            zip.add("test-part-" + String(index).padStart(3, "0") + "." + ext, imageUrl);
          } else {
            zipSkipped = true;
          }
        }
      }
      if (zip && !zipSkipped) {
        const archive = zip.finish();
        zipVerified = archive.type === "application/zip" && archive.size > totalBytes;
      }
      // A heading can span two images. A match in either half is valid,
      // even when the first image contained only background pixels.
      const unresolved = markers.filter((marker) => !matched.has(marker.id))
        .map((marker) => marker.id);
      if (unresolved.length) {
        return {
          valid:false, reason:"Missing visual fixture markers: " +
            unresolved.slice(0, 8).join(", ") +
            (unresolved.length > 8 ? "…" : ""),
          parts, totalBytes, markerCount:markers.length,
          matchedMarkers:matched.size, missingMarkers:unresolved,
          zipVerified, zipSkipped,
        };
      }
      return {
        valid:true, reason:markers.length + " zone, image, START/FINISH checks passed.",
        parts, totalBytes, markerCount:markers.length,
        matchedMarkers:matched.size, missingMarkers:[],
        zipVerified, zipSkipped,
      };
    } finally {
      sample.width = 0;
      sample.height = 0;
    }
  }

  globalThis.LongPageSnapQAAudit = Object.freeze({ audit, markersForFixture });
})();
