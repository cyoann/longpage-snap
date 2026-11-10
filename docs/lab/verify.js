import { analyzeFile, assessFiles } from "./image-meta.js";
import { inspectZip } from "./zip-verify.js";

const fileInput = document.getElementById("files");
const fileStatus = document.getElementById("files-status");
const verdict = document.getElementById("verdict");
const results = document.getElementById("image-results");
const warnings = document.getElementById("warnings");

function el(name, value, cls) {
  const element = document.createElement(name);
  if (value !== undefined) {
    element.textContent = value;
  }
  if (cls) {
    element.className = cls;
  }
  return element;
}

fileInput.addEventListener("change", () => {
  const count = fileInput.files.length;
  fileStatus.textContent = count + (count === 1 ? " file selected." : " files selected.");
});

document.getElementById("inspect").addEventListener("click", async () => {
  verdict.textContent = "Reading file headers locally…";
  results.replaceChildren();
  warnings.replaceChildren();
  const files = Array.from(fileInput.files);
  if (!files.length) {
    verdict.textContent = "Select one or more images or a ZIP archive first.";
    return;
  }
  const archives = files.filter((file) => /\.zip$/i.test(file.name));
  if (archives.length) {
    if (archives.length !== 1 || files.length !== 1) {
      verdict.textContent = "Select exactly one ZIP file at a time.";
      verdict.className = "bad";
      return;
    }
    try {
      verdict.textContent = "Checking ZIP members and CRC32 locally…";
      const checked = await inspectZip(archives[0]);
      for (const entry of checked.entries) {
        const item = el("li");
        item.append(el("strong", entry.name));
        item.append(el("p", (entry.size / (1024 * 1024)).toFixed(2) +
          " MiB · CRC32 " + (entry.valid ? "OK" : "FAILED"), "muted small"));
        results.append(item);
      }
      verdict.className = checked.passed ? "ok" : "bad";
      verdict.textContent = checked.passed
        ? "ZIP integrity passed: " + checked.entries.length +
          " consecutive screenshot files, all CRC32 values valid."
        : "ZIP integrity failed: " + checked.errors.length + " issue(s).";
      for (const error of checked.errors) {
        warnings.append(el("p", "FAIL · " + error, "bad"));
      }
    } catch (error) {
      verdict.className = "bad";
      verdict.textContent = "Cannot inspect this ZIP: " + error.message;
    }
    return;
  }

  const read = await Promise.all(files.map(analyzeFile));
  for (const record of read) {
    const item = el("li");
    item.append(el("strong", record.name));
    const size = (record.size / (1024 * 1024)).toFixed(2) + " MiB";
    const description = record.header
      ? record.header.format.toUpperCase() + " · " +
        record.header.width + " × " + record.header.height + " px · " + size
      : "Could not inspect header: " + record.error;
    item.append(el("p", description, "muted small"));
    results.append(item);
  }
  const number = (id) => {
    const value = document.getElementById(id).value;
    return value === "" ? 0 : Number(value);
  };
  const limit = {
    mode: document.getElementById("mode").value,
    format: document.getElementById("format").value,
    maxFileMiB: number("max-file"),
    maxWidth: number("max-width"),
    maxHeight: number("max-height"),
  };
  const outcome = assessFiles(read, limit);
  if (outcome.failures.length) {
    verdict.textContent = "Validation failed: " + outcome.failures.length +
      " issue(s) detected. File contents still require visual review.";
    verdict.className = "bad";
  } else {
    verdict.textContent = "Metadata checks passed for " + read.length +
      " file(s). Visual completeness and native downloads are not verified.";
    verdict.className = "ok";
  }
  for (const message of outcome.failures) {
    warnings.append(el("p", "FAIL · " + message, "bad"));
  }
  for (const message of outcome.warnings) {
    warnings.append(el("p", "NOTE · " + message, "muted"));
  }
});

document.getElementById("reset").addEventListener("click", () => {
  fileInput.value = "";
  fileStatus.textContent = "No files selected.";
  results.replaceChildren();
  warnings.replaceChildren();
  verdict.textContent = "Select files and press Inspect.";
  verdict.className = "";
});
