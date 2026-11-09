# LongPage Snap

Lightweight page screenshots for Firefox on Android.

One tap. The whole page.

## Status

**Android compatibility probe.** The current implementation captures the visible viewport as a JPEG, attempts a local download through an HTML anchor, and cleans up its interaction overlay. Full-page scrolling and stitching are **not implemented yet**.

## Requirements

- Node.js 22 or later
- Firefox for Android 142 or later
- Android Platform Tools (ADB) for on-device testing

## Development

```sh
npm install
npm run check
npm test
npm run lint
```

Load the extension temporarily on a connected Android device:

```sh
adb devices
npx web-ext run --target=firefox-android --firefox-apk=org.mozilla.firefox
```

Use `org.mozilla.fenix` for Nightly or `org.mozilla.firefox_beta` for Beta. Enable USB debugging and Firefox's remote debugging option. See [Mozilla's Android extension guide](https://extensionworkshop.com/documentation/develop/developing-extensions-for-firefox-for-android/).

## Device validation

1. Open a regular HTTPS page in Firefox for Android.
2. Trigger **LongPage Snap** from the extension action.
3. Confirm that the overlay appears briefly and that the webpage remains unchanged afterward.
4. Check Android Downloads for a JPEG named `longpage-snap-*.jpg`.
5. Record the Firefox version, Android version, whether the download succeeded, and any browser console errors.

A successful `anchor.click()` call does **not** prove the download completed. The export path remains unverified until a real-device test passes.

## Privacy

Screenshots stay on the device. The extension makes no network requests and collects no data.

## License

MIT.
