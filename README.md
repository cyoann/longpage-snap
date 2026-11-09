# LongPage Snap

Lightweight full-page screenshots for Firefox on Android.

**One tap. The whole page.**

## Project website and regression lab

The public static site is stored in [`docs/`](./docs/) and is prepared for GitHub Pages publishing from `main /docs`:

- **Website:** https://cyoann.github.io/longpage-snap/
- **Test fixtures and release checklist:** https://cyoann.github.io/longpage-snap/lab/
- **Local screenshot metadata validator:** https://cyoann.github.io/longpage-snap/lab/verify.html

**Website is live:** GitHub Pages serves `main /docs`. Site fixtures and screenshot checks remain independently tested.

The Android extension is merged into [`main`](https://github.com/cyoann/longpage-snap/tree/main). See the installation instructions below to test it on Firefox Android.

## Status

**Development preview 0.3.4.** Full-page capture and Android JPEG saving were tested on a physical device in earlier builds. The redesigned interface and export modes have passed automated checks and user-reported Android capture tests. The newly hosted test lab still needs full device acceptance testing.

## Features

- **Capture:** one-tap full-page scrolling and stitching, with lazy-image synchronization and duplicate sticky-element suppression
- **Export:** JPEG, PNG, or WebP (subject to browser encoder availability); adjustable JPEG/WebP quality
- **Mode:** Automatic (hardware limits only), Single image (downscale to fit), or Split by custom limits (explicit output thresholds)
- **Limits:** maximum image dimensions, maximum actual encoded file size, or both
- **Accessibility:** minimalist 380px capture dialog with progress, separated destructive actions, 44px touch targets, and system light/dark themes
- **Languages:** English and French; follows Firefox by default, or choose a language explicitly in Settings (independent of Firefox UI language)
- **Settings:** local, persistent options page; changing the export mode saves automatically (the Save button is also available)
- **Privacy:** no uploads, network services, analytics, or tracking

## Install for development

Requirements: Node.js 22.13+, Android Platform Tools, and Firefox Android 142+.

```sh
npm install
npm run check
npm test
npm run lint
npx web-ext lint
```

Enable USB debugging on Android and **Remote debugging via USB** in Firefox's Developer Tools settings:

```sh
adb devices
npx web-ext run --target=firefox-android --android-device=DEVICE_SERIAL --firefox-apk=org.mozilla.firefox
```

For Firefox Nightly, use `org.mozilla.fenix`; for Beta, `org.mozilla.firefox_beta`. The temporary add-on is removed when the debugging session ends.

## Public test lab

The [LongPage Snap test lab](https://cyoann.github.io/longpage-snap/lab/) is hosted from the repository's `main/docs` GitHub Pages source. Until Pages is enabled in repository settings, the link may be unavailable.

The extension's **Settings → Test capture → Open test lab** link opens the lab directly in Firefox. The site includes eight deterministic capture fixtures, a 16-case release acceptance checklist (local results, exportable JSON), and an offline JPEG/PNG/WebP metadata validator.

The website cannot launch privileged extension actions, verify screenshot pixel completeness, or detect native Android download confirmation. These remain manual on-device acceptance checks; CI validates website routes, test fixture behavior and metadata parsing.

## Using settings

Open Firefox's Add-ons manager, select LongPage Snap, and choose **Settings**. The capture panel also contains a Settings link.

| Setting | Behavior |
| --- | --- |
| JPEG | Lossy compression; adjustable quality |
| PNG | Lossless viewport capture and PNG encoding; quality slider disabled |
| WebP | WebP output when supported by Firefox; adjustable quality |
| Automatic | Preserve source resolution; split only for safe device canvas and memory limits. Ignores custom dimension/file-size thresholds |
| Single image | Downscale the entire finite page to fit one safe canvas, preserving content order |
| Split by custom limits | Intentionally apply the maximum dimensions and/or encoded file-size limits even when the device could fit a larger image |
| Maximum dimensions | Constrain width and height in pixels |
| Maximum file size | Re-encode at lower quality where applicable, then split oversized images based on **actual Blob size** |

**Single-image limitations:** When lazy loading grows a page beyond its estimated capacity, Single Image automatically restarts capture **once** with the updated height and recomputed scale; no extra file is created. A second failure stops with a persistent error rather than looping. One image cannot have unlimited dimensions. The capture reserves approximately 30% capacity for lazy-loaded page growth and can extend the single canvas using pixel buffers when safe. It never silently switches a Single Image capture into multipart output. Long pages may need significant downscaling. If the resulting width would be too small to read, the page grows beyond the safe canvas limit, or a single JPEG cannot meet the selected file-size limit, capture stops with an explanation rather than silently changing to multipart output. For long pages where fidelity matters, use Automatic or Split by custom limits.

**Capture failures:** The extension restores the original scroll position, clears temporary capture storage and **keeps the error dialog visible until Close is pressed**. The Settings link remains accessible. Manually cancelled captures close without showing an error.

**Multipart exports:** No native download prompt appears before capture is complete. After scrolling, the extension restores the original page position and presents **Save image 1 of N**, followed by separately labeled actions for the remaining parts. Confirm Firefox's native download dialogs as needed. Every part is required to reconstruct the entire page.

## UI and browser checks

The redesign applies the **design-taste-frontend** system.css palette, type, spacing and control tokens directly to a browser-utility interface. Desktop website hero layouts, full-screen sections and closing footers are intentionally not used.

The mobile checker is restricted to **390px viewport / max 380px panel**. Its explicit waiver is in `test/mobile-check-waiver.json`, and the adapted Chromium checker is `scripts/check-popup.mjs`. Both production UI components are rendered by the checker, with browser-only test facades. It verifies horizontal overflow, minimum control size, French language selection and primary-versus-destructive action spacing.

Run the checker in an environment with Chrome or Chromium installed:

```sh
npm run check:mobile
```

Screenshots are saved under `.mobile-check/` and, on GitHub Actions, uploaded as a visual artifact.

## Implementation and safety

The Firefox Manifest V3 event page coordinates `browser.tabs.captureVisibleTab()` and a content-script capture controller. Images are stitched incrementally using an adaptive canvas memory budget (8–24 MiB of raw RGBA pixels per segment, when possible).

Image parts exceeding the optional encoded file-size limit are divided using pixel buffers (`getImageData`/`putImageData`), avoiding Firefox's canvas-to-canvas drawing security regression. This process can use additional temporary memory. All output segments are staged locally in extension-owned IndexedDB while capture runs and are cleared after export or dismissal. Stale records are pruned.

`browser.downloads.download()` is unavailable on Firefox for Android. This extension uses a local HTML download link, so it cannot reliably detect whether a native download prompt was accepted or whether the file was saved. Existing filenames may trigger Firefox's “Download again?” prompt.

## Known limitations

- Only the top-level document's vertical scrolling is supported; nested scrollers and horizontal overflow are excluded.
- Fixed/sticky detection is heuristic; videos, animation, dynamically changing content, and very long/infinite feeds may produce incomplete or duplicated areas.
- Canvas allocation, browser-specific file encoders, and large IndexedDB messages require Android integration testing.
- Some captures end with a small blank margin when the scroll boundary precedes the reported document height; this avoids a known Firefox canvas-copy security issue.
- Displayed completion indicates that download requests were initiated, **not verified Android file writes**.
- If the capture tab closes or navigates, temporary image parts are discarded.

## License

MIT.
