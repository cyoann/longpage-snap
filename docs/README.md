# LongPage Snap — GitHub Pages test site

Public site after GitHub Pages is enabled: https://cyoann.github.io/longpage-snap/

## Publish

This website is committed independently to **`main/docs`**; it does not merge the draft Android extension branch. To activate public hosting once:

1. Open **Repository → Settings → Pages**.
2. Under **Build and deployment**, select **Deploy from a branch**.
3. Choose branch **`main`** and folder **`/docs`**, then **Save**.
4. Open the repository's **Visit site** link when GitHub Pages reports a completed deployment.

No domain purchase, Pages build dependencies, API keys, backend or analytics are required. All routes are relative so the project lives under `/longpage-snap/` rather than the domain root.

## Test design

- `lab/index.html`: fixture catalog, 16-case release checklist, on-device persistence, downloadable JSON report.
- `lab/fixture.html?case=baseline|sticky|lazy|growth|long|nested|wide|motion`: one visual template with deterministic cases.
- `lab/verify.html`: select real downloaded JPEG, PNG or WebP files; inspect byte size, dimensions and multipart sequence without decoding images or transmitting content.
- `lab/data.js`: version-controlled fixture metadata and acceptance expectations.
- `lab/image-meta.js`: header-only parser; first 256 KiB, no full-resolution bitmap allocation.
- `scripts/check-site.mjs`: CI smoke tests for route integrity, fixtures, formats and acceptance rules.

**No webpage can invoke privileged extension capture APIs or confirm user acceptance of Firefox's native download prompt.** The validation UI is intentionally semi-automated: capture and visual review occur on the phone; metadata checks and the JSON release checklist are performed in the site.

## Release gate

Record the extension version and the Android/Firefox build using the report notes. Before a release, run every checklist item, including repeat attempts on the long and growing-page cases.

Pass/fail rules:

- **Required passes:** baseline JPEG, PNG/WebP encoding, Single Image, Automatic, split by dimensions, split by file size, lazy loading, sticky elements, dynamic growth, French locale, Discard.
- **Device-dependent:** Single Image may stop with a persistent, actionable resource-limit error instead of creating a file when the device cannot fit the canvas.
- **Known limitations:** nested scrollers, horizontal overflow and moving animations may be clipped, incomplete or duplicated. They should never hang Firefox or cause uncaught errors.
- **Evidence:** save the fixture identifier, page start/end markers, number of expected bands, Android build, extension commit, screenshots and the exported JSON report.

A passed CI run validates the website assets and metadata parser, **not** the extension's actual Android screenshot engine or every screenshot's visual completeness.

## Local preview

From the repository root:

```sh
python -m http.server --directory docs 8000
```

Visit `http://127.0.0.1:8000/` on your development machine. To test directly on an Android device, use the deployed GitHub Pages URL; `localhost` on the phone refers to the phone, not the development PC.

## Privacy

No remote APIs, fonts, images or tracking scripts. Fixture images are generated from inline SVG. Checklist results are stored in localStorage in the current browser profile and can be exported as JSON. The validator only accesses files explicitly selected by the user and reads the image header from each.
