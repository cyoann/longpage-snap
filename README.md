# LongPage Snap

Lightweight full-page screenshots for Firefox on Android.

**One tap. The whole page.**

## Status

**Development preview 0.3.0.** Full-page capture and Android JPEG saving were tested on a physical device in earlier builds. The redesigned interface, localization, settings, PNG/WebP export, size constraints, and single-image mode have passed automated tests but **are not yet verified on Android hardware**.

## Features

- **Capture:** one-tap full-page scrolling and stitching, with lazy-image synchronization and duplicate sticky-element suppression
- **Export:** JPEG, PNG, or WebP (subject to browser encoder availability); adjustable JPEG/WebP quality
- **Mode:** Automatic (split only when necessary), Single image (downscale to fit), or Multiple images (split at the configured limits)
- **Limits:** maximum image dimensions, maximum actual encoded file size, or both
- **Accessibility:** responsive capture dialog with progress, prominent download actions, separated destructive controls, and dark/light system themes
- **Languages:** English and French via Firefox WebExtensions `_locales` and `browser.i18n`; follows Firefox's UI language
- **Settings:** local, persistent options page; accessible through the Firefox add-on settings or the capture dialog
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

## Using settings

Open Firefox's Add-ons manager, select LongPage Snap, and choose **Settings**. The capture panel also contains a Settings link.

| Setting | Behavior |
| --- | --- |
| JPEG | Lossy compression; adjustable quality |
| PNG | Lossless viewport capture and PNG encoding; quality slider disabled |
| WebP | WebP output when supported by Firefox; adjustable quality |
| Automatic | Use configured limits and hardware memory budget, split only when needed |
| Single image | Downscale the entire finite page to fit one safe canvas, preserving content order |
| Multiple images | Cut at the configured dimensions and/or encoded file-size limits |
| Maximum dimensions | Constrain width and height in pixels |
| Maximum file size | Re-encode at lower quality where applicable, then split oversized images based on **actual Blob size** |

**Single-image limitations:** One image cannot have unlimited dimensions. Long pages may need significant downscaling. If the resulting width would be too small to read, or a single JPEG cannot meet the selected file-size limit, capture stops with an explanation rather than silently changing to multipart output. For long pages where fidelity matters, use Automatic or Multiple images.

**Multipart exports:** No native download prompt appears before capture is complete. After scrolling, the extension restores the original page position and presents **Save image 1 of N**, followed by separately labeled actions for the remaining parts. Confirm Firefox's native download dialogs as needed. Every part is required to reconstruct the entire page.

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
