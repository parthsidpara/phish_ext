# Architecture & Design Decisions

## Three-layer pipeline

The detector combines three independent checks. Each catches cases the others miss.

- **Layer 1: Visual similarity** (perceptual hashing in the offscreen document). Captures a screenshot, computes a DCT-based pHash via canvas, compares against pre-built brand reference hashes. Catches pixel-for-pixel clones.

- **Layer 2: Domain legitimacy** (background service worker). If the visual match says "this looks like Brand X" but the domain is not on that brand's allowlist, that is the core phishing signal. Also runs homoglyph/Levenshtein checks to catch typosquatting (e.g. `paypa1.com`).

- **Layer 3: Element localization** (content script + canvas template matching, **in progress**). Reads the actual page DOM for login forms, logo candidates, colors, and brand keywords, and runs canvas-based logo template matching against bundled brand logo images in the offscreen document. Currently only the DOM-feature extraction stub exists; it is not yet wired into the verdict.

> **Viewport sensitivity note (Layer 1):** Screenshot-based perceptual hashing is
> layout-dependent: resizing the browser window reflows the page and can shift a same-page hash by
> several bits (observed ~8 in testing), well above pure capture noise (0–4). To mitigate this, the
> dataset tooling captures each brand at three viewports (`1280x800`, `1366x768`, `1920x1080`) and
> Layer 1 compares the live capture against the *closest* of a brand's reference hashes
> (`BrandReference.phashByViewport`), so matches remain reliable when the browsing window is near one
> of those sizes. Because a clone and the real page shift identically under a resize, this never
> creates false positives — a mismatched window size only lowers Layer 1's recall, which Layers 2 and 3
> compensate for. Per-brand threshold calibration remains a possible future refinement.

### Why three layers

- pHash alone is fast but coarse (misses partial page clones).
- Domain checking alone misses pages on compromised-but-legitimate domains.
- Element localization alone is expensive and lacks brand context.

Combined, they cover more cases than any single method and produce an **explainable** verdict with concrete evidence to point at in the warning UI.

## Communication flow

```
Background SW ----> Offscreen Doc          (COMPUTE_PHASH -> PHASH_RESULT)
Background SW ----> Content Script          (DETECTED)
Content Script ---> Background SW            (PAGE_READY + DOM features, GO_BACK)
Popup ------------> Background SW            (RESCAN)
```

- pHash and logo matching run in an **offscreen document** (canvas access).
- Domain checks run in the **background service worker** (pure strings).
- DOM extraction and warning UI run in the **content script** (page access).

## Build-time dataset (Python, dev-only)

`tools/generate.py` generates the brand reference data once, offline. It captures each brand's page
with headless Chromium (Playwright) at three viewports and precomputes:

- Perceptual hashes of each capture, computed by shelling out to
  `scripts/hash-png.ts` — the *exact same* `src/utils/phash.ts` implementation the extension uses at
  runtime, so hashes transfer bit-for-bit (no separate Python hashing library).
- Brand color palettes and keywords, extracted from the live DOM.
- Domain allowlists (manual, in `tools/config.json`).

`logoTemplate` (cropped/encoded logo images) and logo template matching are deferred until the
Layer 3 logo pipeline exists. See `tools/README.md` for usage.

Output: `assets/brands/brands.json`, bundled as a static file. Python never runs at runtime.

## Key permissions

| Permission | Why |
|-----------|-----|
| `<all_urls>` host permission | `tabs.captureVisibleTab` for automatic screenshot on any page |
| `storage` | Store scan history and warning-interaction analytics |
| `tabs` | Detect tab navigation events |
| `offscreen` | Create offscreen document for canvas-based image processing |
| `webNavigation` | Detect page navigation events to trigger the pipeline |

### Why `<all_urls>` instead of `activeTab`

`activeTab` requires the user to click the extension icon to grant tab access — that means no automatic scanning on page load. A security extension can justify `<all_urls>` in its store listing.

## CLIP (stretch goal)

CLIP (by OpenAI) maps images and text into the same vector space — useful for recognizing logo variants that template matching would miss. Deferred because:

- Requires bundling `onnxruntime-web` + a ~30-150 MB model in the extension.
- CPU inference takes seconds; WebGPU is faster but adds compatibility issues.
- Layer 3 exposes a clean `logoMatcher` interface so CLIP can be swapped in later without rearchitecting.
