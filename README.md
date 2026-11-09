# LongPage Snap

Lightweight full-page screenshots for Firefox on Android.

One tap. The whole page.

## Project website and regression lab

The public static site is stored in [`docs/`](./docs/) and is prepared for GitHub Pages publishing from `main /docs`:

- **Website:** https://cyoann.github.io/longpage-snap/
- **Test fixtures and release checklist:** https://cyoann.github.io/longpage-snap/lab/
- **Local screenshot metadata validator:** https://cyoann.github.io/longpage-snap/lab/verify.html

**Hosting must first be enabled:** Repository Settings → Pages → Deploy from a branch → `main`, `/docs`. The website and its QA fixture tests are independent of the unmerged Android extension work.

The active [Android development branch](https://github.com/cyoann/longpage-snap/tree/feat/android-capture-probe) provides the extension implementation and test install instructions.

## Status

Early development.

## Goals

- Full-page JPEG capture
- Adaptive memory management
- Lazy-loading and sticky element handling
- One-tap capture and local export
- Minimal permissions and zero runtime dependencies

## Privacy

All image processing happens locally. No analytics, tracking, or external services.
