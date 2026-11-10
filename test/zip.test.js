import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { TextEncoder, TextDecoder } from "node:util";
import vm from "node:vm";
import { inspectZip } from "../docs/lab/zip-verify.js";

const source = readFileSync(new URL("../src/zip.js", import.meta.url), "utf8");
const sandbox = vm.createContext({
  Uint32Array, Uint8Array, TextEncoder, Blob, atob,
});
vm.runInContext(source, sandbox);
const { StoredZip, MAX_IMAGE_BYTES } = sandbox.LongPageSnapZip;
const decoder = new TextDecoder();
const payload = (bytes) => "data:image/jpeg;base64," + Buffer.from(bytes).toString("base64");
const u16 = (data, offset) => data[offset] | (data[offset + 1] << 8);
const u32 = (data, offset) => (data[offset] | (data[offset + 1] << 8) |
  (data[offset + 2] << 16) | (data[offset + 3] << 24)) >>> 0;

test("creates a standards-compliant, uncompressed, multi-file ZIP", async () => {
  const writer = new StoredZip();
  const binary = Uint8Array.from([0, 255, 0, 9, 10, 42]);
  writer.add("capture-part-001.jpg", payload(Buffer.from("123456789")));
  writer.add("capture-part-002.jpg", payload(binary));
  const blob = writer.finish();
  assert.equal(blob.type, "application/zip");
  const zip = new Uint8Array(await blob.arrayBuffer());
  assert.equal(u32(zip, 0), 0x04034b50);
  assert.equal(u16(zip, 8), 0, "Stored ZIP entries must not recompress images");
  assert.equal(u32(zip, 14), 0xcbf43926, "Standard CRC32 for 123456789");
  assert.equal(u32(zip, 18), 9);
  const firstNameLen = u16(zip, 26);
  assert.equal(decoder.decode(zip.slice(30, 30 + firstNameLen)),
    "capture-part-001.jpg");
  const firstFile = 30 + firstNameLen;
  assert.equal(decoder.decode(zip.slice(firstFile, firstFile + 9)), "123456789");

  const secondOffset = firstFile + 9;
  assert.equal(u32(zip, secondOffset), 0x04034b50);
  const secondNameLen = u16(zip, secondOffset + 26);
  const secondFile = secondOffset + 30 + secondNameLen;
  assert.deepEqual(Array.from(zip.slice(secondFile, secondFile + binary.length)),
    Array.from(binary), "ZIP must preserve exact JPEG/PNG/WebP bytes");

  const end = zip.length - 22;
  assert.equal(u32(zip, end), 0x06054b50);
  assert.equal(u16(zip, end + 10), 2);
  const directoryOffset = u32(zip, end + 16);
  const directoryLength = u32(zip, end + 12);
  assert.equal(directoryOffset + directoryLength, end);
  assert.equal(u32(zip, directoryOffset), 0x02014b50);
  assert.equal(u32(zip, directoryOffset + 42), 0);
});

test("supports UTF-8 filenames, formats and 64KiB base64 chunk boundaries", async () => {
  const writer = new StoredZip();
  const bytes = Buffer.alloc(125000);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = i & 255;
  }
  writer.add("Épreuve-part-001.webp",
    "data:image/webp;base64," + bytes.toString("base64"));
  const zip = new Uint8Array(await writer.finish().arrayBuffer());
  const n = u16(zip, 26);
  assert.equal(decoder.decode(zip.slice(30, 30 + n)), "Épreuve-part-001.webp");
  assert.equal(u16(zip, 6), 0x0800, "EFS flag must identify UTF-8 names");
  assert.deepEqual(Array.from(zip.slice(30 + n, 30 + n + bytes.length)),
    Array.from(bytes));
});

test("refuses empty ZIPs, path traversal, duplicates and malformed input", () => {
  assert.throws(() => new StoredZip().finish(), /empty/i);
  const writer = new StoredZip();
  assert.throws(() => writer.add("../private.jpg", payload([1, 2])), /name/i);
  assert.throws(() => writer.add("a\\b.jpg", payload([1, 2])), /name/i);
  assert.throws(() => writer.add("missing.jpg", "javascript:alert(1)"), /unsupported/i);
  assert.throws(() => writer.add("invalid.jpg", "data:image/jpeg;base64,?"), /base64/i);
  writer.add("good.png", "data:image/png;base64," + Buffer.from([1, 2]).toString("base64"));
  assert.throws(() => writer.add("good.png", payload([5])), /duplicate/i);
});

test("enforces Android memory budget before decoding oversized entries", () => {
  assert.equal(MAX_IMAGE_BYTES, 16 * 1024 * 1024);
  const writer = new StoredZip();
  const maxEncoded = "A".repeat(Math.ceil((MAX_IMAGE_BYTES + 1) / 3) * 4);
  assert.throws(() => writer.add("huge.jpg", "data:image/jpeg;base64," + maxEncoded),
    /memory budget/i);
});

test("GitHub Pages ZIP validator accepts intact multi-image output", async () => {
  const writer = new StoredZip();
  writer.add("snap-part-001.jpg", payload(Buffer.from("123456789")));
  writer.add("snap-part-002.jpg", payload(Buffer.from([0, 255, 23, 99])));
  const outcome = await inspectZip(writer.finish());
  assert.equal(outcome.passed, true);
  assert.equal(outcome.errors.length, 0);
  assert.equal(outcome.entries.length, 2);
  assert.ok(outcome.entries.every((entry) => entry.valid));
});

test("GitHub Pages ZIP validator detects corrupted screenshot bytes", async () => {
  const writer = new StoredZip();
  writer.add("snap-part-001.jpg", payload(Buffer.from("123456789")));
  writer.add("snap-part-002.jpg", payload(Buffer.from("test")));
  const bytes = new Uint8Array(await writer.finish().arrayBuffer());
  const payloadOffset = 30 + "snap-part-001.jpg".length;
  bytes[payloadOffset + 3] ^= 0x55;
  const outcome = await inspectZip(new Blob([bytes], { type:"application/zip" }));
  assert.equal(outcome.passed, false);
  assert.match(outcome.errors.join(" "), /CRC32/i);
});

test("GitHub Pages ZIP validator rejects missing and repeated part numbers", async () => {
  const writer = new StoredZip();
  writer.add("snap-part-001.jpg", payload([1, 2, 3]));
  writer.add("snap-part-003.jpg", payload([4, 5, 6]));
  const outcome = await inspectZip(writer.finish());
  assert.equal(outcome.passed, false);
  assert.match(outcome.errors.join(" "), /numbering/i);
});
