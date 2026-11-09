// Image metadata only; never decodes full-resolution pixels or sends data off-device.
const MIME = Object.freeze({
  jpeg: "image/jpeg", png: "image/png", webp: "image/webp",
});

function u16be(bytes, index) {
  return (bytes[index] << 8) | bytes[index + 1];
}
function u32be(bytes, index) {
  return ((bytes[index] * 0x1000000) + (bytes[index + 1] << 16) +
    (bytes[index + 2] << 8) + bytes[index + 3]) >>> 0;
}

export function readImageHeader(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 24) {
    throw new Error("File header is incomplete.");
  }
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e &&
      bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a &&
      bytes[6] === 0x1a && bytes[7] === 0x0a) {
    if (String.fromCharCode(...bytes.slice(12, 16)) !== "IHDR") {
      throw new Error("Invalid PNG IHDR.");
    }
    return { format:"png", mime:MIME.png, width:u32be(bytes, 16), height:u32be(bytes, 20) };
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    let index = 2;
    while (index + 8 < bytes.length) {
      while (index < bytes.length && bytes[index] === 0xff) {
        index += 1;
      }
      const marker = bytes[index++];
      if (marker === 0xd9 || marker === 0xda) {
        break;
      }
      if (marker === 0xd8 || marker === 0x01 ||
          (marker >= 0xd0 && marker <= 0xd7)) {
        continue;
      }
      const length = u16be(bytes, index);
      if (length < 2 || index + length > bytes.length) {
        break;
      }
      if ([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker)) {
        return {
          format:"jpeg", mime:MIME.jpeg,
          width:u16be(bytes,index + 5), height:u16be(bytes,index + 3),
        };
      }
      index += length;
    }
    throw new Error("JPEG image dimensions not found in the first 256 KiB.");
  }
  const ascii = (start, end) => String.fromCharCode(...bytes.subarray(start, end));
  if (bytes.length >= 30 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") {
    const chunk = ascii(12, 16);
    if (chunk === "VP8X") {
      return {
        format:"webp", mime:MIME.webp,
        width: 1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16),
        height: 1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16),
      };
    }
    if (chunk === "VP8 " && bytes[23] === 0x9d &&
        bytes[24] === 0x01 && bytes[25] === 0x2a) {
      return {
        format:"webp", mime:MIME.webp,
        width: (bytes[26] | (bytes[27] << 8)) & 0x3fff,
        height: (bytes[28] | (bytes[29] << 8)) & 0x3fff,
      };
    }
    if (chunk === "VP8L" && bytes[20] === 0x2f) {
      return {
        format:"webp", mime:MIME.webp,
        width: 1 + bytes[21] + ((bytes[22] & 0x3f) << 8),
        height: 1 + (bytes[22] >> 6) + (bytes[23] << 2) + ((bytes[24] & 0x0f) << 10),
      };
    }
    throw new Error("Unsupported WebP header.");
  }
  throw new Error("Unrecognized file format (expected JPEG, PNG or WebP).");
}

export function filenamePart(name) {
  const match = /^(.*)-part-(\d{3,})\.(jpe?g|png|webp)$/i.exec(name);
  if (match) {
    return {
      base: match[1], part: Number(match[2]),
      extension: match[3].toLowerCase().replace("jpeg", "jpg"),
    };
  }
  const single = /^(.*)\.(jpe?g|png|webp)$/i.exec(name);
  if (!single) {
    return null;
  }
  return {
    base:single[1], part:null,
    extension:single[2].toLowerCase().replace("jpeg", "jpg"),
  };
}

export function assessFiles(records, limits = {}) {
  const warnings = [];
  const failures = [];
  if (!records.length) {
    return { failures:["No images selected."], warnings };
  }
  const names = records.map((record) => filenamePart(record.name));
  if (names.some((name) => !name)) {
    failures.push("At least one filename has an unsupported extension.");
  }
  const comparable = names.filter(Boolean);
  if (new Set(comparable.map((name) => name.base)).size > 1) {
    warnings.push("Files do not have a common base name. They may be from different captures.");
  }
  if (records.length > 1) {
    const parts = comparable.map((name) => name.part);
    if (parts.some((part) => part === null)) {
      failures.push("Multiple images selected without consistent -part-NNN filenames.");
    } else {
      const sorted = parts.slice().sort((a,b) => a-b);
      for (let n = 0; n < sorted.length; n += 1) {
        if (sorted[n] !== n + 1) {
          failures.push("Part numbers are missing, duplicated, or do not start at 001.");
          break;
        }
      }
    }
  } else if (comparable[0]?.part !== null && comparable[0]?.part !== 1) {
    warnings.push("Only part " + comparable[0].part + " was selected.");
  }

  if (limits.mode === "single" && records.length !== 1) {
    failures.push("Single Image expects exactly one file.");
  }
  for (const record of records) {
    if (!record.header) {
      failures.push(record.name + ": " + (record.error || "Cannot read dimensions."));
      continue;
    }
    const { width, height, format } = record.header;
    if (!width || !height) {
      failures.push(record.name + ": invalid image dimensions.");
    }
    if (limits.format && limits.format !== "any" && format !== limits.format) {
      failures.push(record.name + ": " + format.toUpperCase() +
        " differs from expected " + limits.format.toUpperCase() + ".");
    }
    if (limits.maxWidth > 0 && width > limits.maxWidth) {
      failures.push(record.name + ": width " + width + " exceeds " + limits.maxWidth + " px.");
    }
    if (limits.maxHeight > 0 && height > limits.maxHeight) {
      failures.push(record.name + ": height " + height + " exceeds " + limits.maxHeight + " px.");
    }
    if (limits.maxFileMiB > 0 && record.size > limits.maxFileMiB * 1024 * 1024) {
      failures.push(record.name + ": file size exceeds " + limits.maxFileMiB + " MiB.");
    }
    const parsed = filenamePart(record.name);
    const expectedExt = format === "jpeg" ? "jpg" : format;
    if (parsed && parsed.extension !== expectedExt) {
      warnings.push(record.name + ": extension differs from actual " + format.toUpperCase() + " encoding.");
    }
  }
  return { failures, warnings };
}

export async function analyzeFile(file) {
  try {
    // Read only the header to avoid decoding or loading large bitmaps in RAM.
    const header = readImageHeader(new Uint8Array(await file.slice(0, 262144).arrayBuffer()));
    return { name:file.name, size:file.size, header };
  } catch (error) {
    return { name:file.name, size:file.size, error:error.message || String(error) };
  }
}
