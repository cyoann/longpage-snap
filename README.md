# LongPage Snap

Lightweight full-page screenshots for Firefox on Android.

One tap. The whole page.

## Status

**Development preview (0.2.0).** Viewport capture and Android JPEG download have been verified on a device. The full-page capture pipeline has automated tests but still requires Android integration testing.

## Features

- Single-tap capture from the Firefox extension action
- Sequential scrolling with render-state synchronization and lazy-image checks
- Deduplication of previously captured fixed and pinned sticky elements
- JPEG stitching with an adaptive per-canvas memory budget
- Automatic numbered JPEG parts when a page exceeds the canvas budget
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

Open an HTTPS page with content extending below the viewport and tap **LongPage Snap** from Firefox's extension menu. Confirm that the extension scrolls, that the downloaded JPEG contains the entire finite page, and that Firefox returns to the original scroll position. A long page may produce files ending in `-part-001.jpg`, `-part-002.jpg`, etc.

Verify the result on a normal article, an image-heavy page, and a page with a fixed navigation bar. Check image alignment and gaps at viewport boundaries.

## Implementation

The background event page coordinates capture with `browser.tabs.captureVisibleTab()`. An injected content controller scrolls the page, waits for stable geometry and visible image completion, and composites each frame.

The output canvas uses a conservative 8–24 MiB pixel budget, taking `navigator.deviceMemory` into account when available. Segment height is calculated from the actual screenshot width. Canvas allocation is probed and reduced on failure; page height itself is not capped.

Finished segments are encoded with `canvas.toBlob("image/jpeg", 0.86)` and converted to data URLs for the Android download path validated in the initial prototype.

## Limitations

- Only the top-level document's vertical scroll is captured. Nested scrolling containers and horizontal overflow are not supported.
- Sticky detection is heuristic. Complex layouts, canvas animations, video, and content that changes while scrolling may produce artifacts.
- Lazy-loaded assets that never settle are bounded by an adaptive deadline; some may be omitted.
- Endless feeds are stopped after sustained growth rather than captured indefinitely.
- Multiple downloads may be subject to browser prompts or restrictions.
- A programmatic save attempt does not prove that Android completed every download. Confirm the files in Downloads.
- Temporary extensions are removed when the `web-ext` debugging session ends.

## License

MIT.
