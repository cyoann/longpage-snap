// In-browser STORE-only ZIP writer for already-compressed screenshots.
// Deliberately capped to avoid assembling oversized archives on Firefox Android.
// No network, no compression dependencies and no full-page canvas allocations.
(() => {
  const MAX_IMAGE_BYTES = 16 * 1024 * 1024;
  const MAX_ENTRIES = 80;
  const CHUNK_CHARS = 65536; // Base64: divisible by 4; ~48 KiB decoded.
  const encoder = new TextEncoder();
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let value = n;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : value >>> 1;
    }
    table[n] = value >>> 0;
  }

  function u16(bytes, offset, value) {
    bytes[offset] = value & 255;
    bytes[offset + 1] = (value >>> 8) & 255;
  }
  function u32(bytes, offset, value) {
    bytes[offset] = value & 255;
    bytes[offset + 1] = (value >>> 8) & 255;
    bytes[offset + 2] = (value >>> 16) & 255;
    bytes[offset + 3] = (value >>> 24) & 255;
  }

  function entryName(name) {
    if (typeof name !== "string" || name.length < 1 ||
        name === "." || name === ".." ||
        name.includes("/") || name.includes("\\") ||
        /[\x00-\x1f]/.test(name)) {
      throw new TypeError("Invalid archive entry name.");
    }
    const bytes = encoder.encode(name);
    if (bytes.length > 240) {
      throw new RangeError("Archive filename is too long.");
    }
    return bytes;
  }

  class StoredZip {
    constructor() {
      this.pieces = [];
      this.central = [];
      this.bytes = 0;
      this.imageBytes = 0;
      this.names = new Set();
    }

    add(name, dataUrl) {
      if (this.central.length >= MAX_ENTRIES || this.names.has(name)) {
        throw new RangeError("Too many or duplicate archive files.");
      }
      const filename = entryName(name);
      const prefix = /^data:image\/(?:jpeg|png|webp);base64,/i.exec(dataUrl);
      if (!prefix) {
        throw new TypeError("Unsupported image data for ZIP.");
      }
      const encoded = dataUrl.slice(prefix[0].length);
      if (!encoded.length || encoded.length % 4) {
        throw new TypeError("Invalid base64 image data.");
      }
      const padding = encoded.endsWith("==") ? 2 : encoded.endsWith("=") ? 1 : 0;
      const size = encoded.length / 4 * 3 - padding;
      if (!Number.isSafeInteger(size) || size < 1 ||
          this.imageBytes + size > MAX_IMAGE_BYTES) {
        throw new RangeError("ZIP memory budget exceeded. Save images individually.");
      }

      const pieces = [];
      let crc = 0xffffffff;
      let actualSize = 0;
      for (let offset = 0; offset < encoded.length; offset += CHUNK_CHARS) {
        const decoded = atob(encoded.slice(offset, offset + CHUNK_CHARS));
        const chunk = new Uint8Array(decoded.length);
        for (let i = 0; i < decoded.length; i += 1) {
          const value = decoded.charCodeAt(i);
          chunk[i] = value;
          crc = table[(crc ^ value) & 255] ^ (crc >>> 8);
        }
        actualSize += chunk.length;
        pieces.push(chunk);
      }
      if (actualSize !== size) {
        throw new Error("Unexpected ZIP image size.");
      }
      crc = (crc ^ 0xffffffff) >>> 0;

      const local = new Uint8Array(30);
      u32(local, 0, 0x04034b50);
      u16(local, 4, 20);
      u16(local, 6, 0x0800); // UTF-8 entry names
      u16(local, 8, 0); // STORE: source bytes already compressed
      u16(local, 10, 0);
      u16(local, 12, 33); // 1980-01-01, deterministic timestamp
      u32(local, 14, crc);
      u32(local, 18, size);
      u32(local, 22, size);
      u16(local, 26, filename.length);
      u16(local, 28, 0);

      this.central.push({ filename, size, crc, offset: this.bytes });
      this.pieces.push(local, filename, ...pieces);
      this.bytes += local.length + filename.length + size;
      this.imageBytes += size;
      this.names.add(name);
      return { count: this.central.length, totalBytes: this.imageBytes };
    }

    finish() {
      if (!this.central.length) {
        throw new Error("Cannot create an empty screenshot ZIP.");
      }
      const start = this.bytes;
      for (const item of this.central) {
        const header = new Uint8Array(46);
        u32(header, 0, 0x02014b50);
        u16(header, 4, 20);
        u16(header, 6, 20);
        u16(header, 8, 0x0800);
        u16(header, 10, 0);
        u16(header, 12, 0);
        u16(header, 14, 33);
        u32(header, 16, item.crc);
        u32(header, 20, item.size);
        u32(header, 24, item.size);
        u16(header, 28, item.filename.length);
        u16(header, 30, 0);
        u16(header, 32, 0);
        u16(header, 34, 0);
        u16(header, 36, 0);
        u32(header, 38, 0);
        u32(header, 42, item.offset);
        this.pieces.push(header, item.filename);
        this.bytes += header.length + item.filename.length;
      }

      const end = new Uint8Array(22);
      u32(end, 0, 0x06054b50);
      u16(end, 4, 0);
      u16(end, 6, 0);
      u16(end, 8, this.central.length);
      u16(end, 10, this.central.length);
      u32(end, 12, this.bytes - start);
      u32(end, 16, start);
      u16(end, 20, 0);
      this.pieces.push(end);

      return new Blob(this.pieces, { type: "application/zip" });
    }
  }

  globalThis.LongPageSnapZip = Object.freeze({
    StoredZip, MAX_IMAGE_BYTES, MAX_ENTRIES,
  });
})();
