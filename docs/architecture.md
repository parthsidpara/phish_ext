# Architecture & Design Decisions

## Three-layer pipeline

The detector combines three independent checks. Each catches cases the others miss.

- **Layer 1: Visual similarity** (perceptual hashing in the offscreen document). Captures a screenshot, computes a DCT-based pHash via canvas, compares against pre-built brand reference hashes. Catches pixel-for-pixel clones.

- **Layer 2: Domain legitimacy** (background service worker). If the visual match says "this looks like Brand X" but the domain is not on that brand's allowlist, that is the core phishing signal. Also runs homoglyph/Levenshtein checks to catch typosquatting (e.g. `paypa1.com`).

- **Layer 3: Element localization** (content script + canvas template matching). Reads the actual page DOM for login forms, logo candidates, colors, and brand keywords. Runs canvas-based logo template matching against bundled brand logo images in the offscreen document.

### Why three layers

- pHash alone is fast but coarse (misses partial page clones).
- Domain checking alone misses pages on compromised-but-legitimate domains.
- Element localization alone is expensive and lacks brand context.

Combined, they cover more cases than any single method and produce an **explainable** verdict with concrete evidence to point at in the warning UI.

## Communication flow

```
Background SW ----> Offscreen Doc          (COMPUTE_PHASH -> PHASH_RESULT)
Background SW ----> Content Script          (DETECTED)
Content Script ---> Background SW            (PAGE_READY + DOM features)
```

- pHash and logo matching run in an **offscreen document** (canvas access).
- Domain checks run in the **background service worker** (pure strings).
- DOM extraction and warning UI run in the **content script** (page access).

## Build-time dataset (Python, dev-only)

Python scripts in `tools/` generate the brand reference data once, offline. They capture ~15 brand login pages and precompute:

- Perceptual hashes of each login page (`imagehash`).
- Logo templates (cropped, downscaled, encoded as base64).
- Brand color palettes.
- Domain allowlists and homoglyph/lookalike rules.

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
