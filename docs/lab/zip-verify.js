// Offline ZIP inspector for STORE-only LongPage Snap screenshot archives.
// Reads the central directory and verifies each member's CRC in 64 KiB slices.
// No upload, extraction, full-file buffering, or third-party dependencies.
const MAX_ARCHIVE_BYTES = 64 * 1024 * 1024;
const MAX_ARCHIVE_ENTRIES = 80;
const CHUNK_BYTES = 64 * 1024;
const decoder = new TextDecoder("utf-8", { fatal: true });
const crcTable = new Uint32Array(256);
for (let i = 0; i < 256; i += 1) {
  let value = i;
  for (let bit = 0; bit < 8; bit += 1) {
    value = (value & 1) ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  crcTable[i] = value >>> 0;
}
const u16 = (a, p) => a[p] | (a[p + 1] << 8);
const u32 = (a, p) => (a[p] | (a[p + 1] << 8) |
  (a[p + 2] << 16) | (a[p + 3] << 24)) >>> 0;

async function readBytes(file, start, length) {
  if (start < 0 || length < 0 || start + length > file.size) {
    throw new Error("Archive metadata points outside the file.");
  }
  return new Uint8Array(await file.slice(start, start + length).arrayBuffer());
}

async function memberCrc(file, offset, length) {
  let crc = 0xffffffff;
  for (let read = 0; read < length; read += CHUNK_BYTES) {
    const chunk = await readBytes(file, offset + read,
      Math.min(CHUNK_BYTES, length - read));
    for (const value of chunk) {
      crc = crcTable[(crc ^ value) & 255] ^ (crc >>> 8);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export async function inspectZip(file) {
  if (!file || !Number.isFinite(file.size) || file.size < 22 ||
      file.size > MAX_ARCHIVE_BYTES) {
    throw new Error("ZIP must be between 22 bytes and 64 MiB.");
  }
  const tailStart = Math.max(0, file.size - (22 + 65535));
  const tail = await readBytes(file, tailStart, file.size - tailStart);
  let eocd = -1;
  for (let pos = tail.length - 22; pos >= 0; pos -= 1) {
    if (u32(tail, pos) === 0x06054b50 &&
        pos + 22 + u16(tail, pos + 20) === tail.length) {
      eocd = pos;
      break;
    }
  }
  if (eocd < 0) {
    throw new Error("ZIP end-of-central-directory record not found.");
  }
  const count = u16(tail, eocd + 10);
  const cdSize = u32(tail, eocd + 12);
  const cdOffset = u32(tail, eocd + 16);
  if (!count || count > MAX_ARCHIVE_ENTRIES ||
      count !== u16(tail, eocd + 8) ||
      u16(tail, eocd + 4) || u16(tail, eocd + 6) ||
      cdSize > 1024 * 1024 || cdOffset + cdSize > tailStart + eocd) {
    throw new Error("ZIP directory is invalid or exceeds safe inspection limits.");
  }
  const directory = await readBytes(file, cdOffset, cdSize);
  const errors = [];
  const entries = [];
  const seen = new Set();
  let cursor = 0;

  for (let index = 0; index < count; index += 1) {
    if (cursor + 46 > directory.length || u32(directory, cursor) !== 0x02014b50) {
      throw new Error("Malformed ZIP central directory.");
    }
    const flags = u16(directory, cursor + 8);
    const method = u16(directory, cursor + 10);
    const expectedCrc = u32(directory, cursor + 16);
    const compressedSize = u32(directory, cursor + 20);
    const originalSize = u32(directory, cursor + 24);
    const nameLength = u16(directory, cursor + 28);
    const extraLength = u16(directory, cursor + 30);
    const commentLength = u16(directory, cursor + 32);
    const offset = u32(directory, cursor + 42);
    const next = cursor + 46 + nameLength + extraLength + commentLength;
    if (!nameLength || next > directory.length) {
      throw new Error("Malformed ZIP entry filename.");
    }
    const name = decoder.decode(directory.subarray(cursor + 46, cursor + 46 + nameLength));
    cursor = next;
    if (seen.has(name) || name.includes("/") || name.includes("\\") ||
        name === "." || name === "..") {
      errors.push(name + ": duplicate or unsafe filename.");
    }
    seen.add(name);

    if (method !== 0 || compressedSize !== originalSize || !(flags & 0x0800) ||
        flags & 1) {
      errors.push(name + ": unsupported compression or flags.");
      entries.push({ name, size: originalSize, valid: false });
      continue;
    }

    const local = await readBytes(file, offset, 30);
    if (u32(local, 0) !== 0x04034b50 ||
        u16(local, 8) !== 0 ||
        u32(local, 14) !== expectedCrc ||
        u32(local, 18) !== compressedSize ||
        u32(local, 22) !== originalSize) {
      errors.push(name + ": local header mismatch.");
      entries.push({ name, size: originalSize, valid: false });
      continue;
    }
    const localNameSize = u16(local, 26);
    const localExtraSize = u16(local, 28);
    const payloadStart = offset + 30 + localNameSize + localExtraSize;
    if (payloadStart + compressedSize > cdOffset) {
      errors.push(name + ": payload extends beyond the image-data area.");
      entries.push({ name, size: originalSize, valid: false });
      continue;
    }
    const localName = decoder.decode(await readBytes(file, offset + 30, localNameSize));
    if (localName !== name) {
      errors.push(name + ": local filename differs from directory.");
    }
    const actualCrc = await memberCrc(file, payloadStart, compressedSize);
    const valid = actualCrc === expectedCrc && localName === name;
    if (!valid) {
      errors.push(name + ": CRC32 or name mismatch.");
    }
    entries.push({ name, size: originalSize, valid });
  }
  if (cursor !== directory.length) {
    errors.push("ZIP directory has unexpected trailing data.");
  }

  const names = entries.map((entry) =>
    /^(.*)-part-(\d{3,})\.(jpg|jpeg|png|webp)$/i.exec(entry.name));
  if (names.some((match) => !match)) {
    errors.push("Not all ZIP entries use -part-NNN image names.");
  } else {
    const bases = new Set(names.map((match) => match[1]));
    const sequence = names.map((match) => Number(match[2])).sort((a, b) => a - b);
    if (bases.size !== 1 || sequence.some((number, i) => number !== i + 1)) {
      errors.push("ZIP image parts have missing, duplicate or inconsistent numbering.");
    }
  }
  return { entries, errors, passed: errors.length === 0 };
}
