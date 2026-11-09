# LongPage Snap

Lightweight full-page screenshots for Firefox on Android.

One tap. The whole page.

## Status

**Development preview (0.2.1).** Full-page scrolling, JPEG stitching and Android download have been verified on a device. The deferred multipart download workflow requires device testing.

## Features

- Single-tap capture from the Firefox extension action
- Sequential scrolling with render-state synchronization and lazy-image checks
- Deduplication of previously captured fixed and pinned sticky elements
- JPEG stitching with an adaptive per-canvas memory budget
- Automatic numbered JPEG parts when a page exceeds the canvas budget
- No save prompts while scrolling; multipart exports are presented after capture with labeled save actions
- Capture cancellation and restoration of the original scroll position

Screenshots are processed and saved locally. No analytics, tracking, or external services.

## Development

Requires Node.js 22.13 or later and Android Platform Tools (ADB).

```sh
npm install
npm run check
npm test
npm run lint
npx web-ext lint
```

## Android test

Enable USB debugging and **Remote debugging via USB** in Firefox's Developer Tools settings. Connect the device, then run:

```sh
adb devices
npx web-ext run --target=firefox-android --android-device=DEVICE_SERIAL --firefox-apk=org.mozilla.firefox
```

Use `org.mozilla.fenix` for Nightly or `org.mozilla.firefox_beta` for Beta.

Open an HTTPS page with content extending below the viewport and tap **LongPage Snap** from Firefox's extension menu. Confirm that the extension scrolls, that the downloaded JPEG contains the entire finite page, and that Firefox returns to the original scroll position. A long page may produce files ending in `-part-001.jpg`, `-part-002.jpg`, etc. Once scrolling finishes, the page returns to its original position and shows **Save image 1 of N**. Confirm Firefox's save dialog, then tap **Save image 2 of N** to export the next part. Single-image captures save automatically.

Verify the result on a normal article, an image-heavy page, and a page with a fixed navigation bar. Check image alignment and gaps at viewport boundaries.

## Implementation

The background event page coordinates capture with `browser.tabs.captureVisibleTab()`. An injected content controller scrolls the page, waits for stable geometry and visible image completion, and composites each frame.

The output canvas uses a conservative 8–24 MiB pixel budget, taking `navigator.deviceMemory` into account when available. Segment height is calculated from the actual screenshot width. Canvas allocation is probed and reduced on failure; page height itself is not capped.

Finished segments are encoded with `canvas.toBlob("image/jpeg", 0.86)` and staged in extension-owned IndexedDB storage. After scrolling finishes, the output is downloaded through the Android-compatible data URL mechanism verified in the initial prototype. Captured segments are cleared when the export is dismissed or the tab navigates away. Abandoned export sessions expire after two hours and are pruned when capture next starts.

## Limitations

- Only the top-level document's vertical scroll is captured. Nested scrolling containers and horizontal overflow are not supported.
- Sticky detection is heuristic. Complex layouts, canvas animations, video, and content that changes while scrolling may produce artifacts.
- Lazy-loaded assets that never settle are bounded by an adaptive deadline; some may be omitted.
- Endless feeds are stopped after sustained growth rather than captured indefinitely.
- Multipart exports require a labeled save action per JPEG. Android may request a separate confirmation for each file.
- Temporary JPEG parts occupy local extension storage until exported or discarded.
- A programmatic save attempt does not prove that Android completed every download. Confirm the files in Downloads.
- Temporary extensions are removed when the `web-ext` debugging session ends.

## License

MIT.
