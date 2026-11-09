export function screenshotFilename(title, timestamp = new Date()) {
  const stem = String(title || "page")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^[._-]+|[._-]+$/g, "")
    .slice(0, 64) || "page";

  const stamp = timestamp.toISOString().replace(/[:.]/g, "-");
  return `longpage-snap-${stem}-${stamp}.jpg`;
}
