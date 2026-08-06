# phish_ext — Browser extension that detects brand-impersonation phishing pages

A Chromium browser extension (Manifest V3) that detects fake login pages impersonating known brands, explains *why* it thinks a page is fake, and tests different warning designs to see which makes users stop before entering credentials.

Everything runs **inside the browser**. There is no backend server, no remote inference, and no network calls during detection. All reference data is generated once at build time and bundled into the extension.

---

## Problem

Fake login pages that copy the look of real websites (banks, email, social media) trick users into entering their passwords. Two things are usually weak:

1. **Detection** — well-made clones often slip past simple checks.
2. **Warnings** — a generic "this site might be dangerous" banner is easy to ignore.

## What We're Building

A browser extension that:

- Scans the page you're on and checks it against known real websites using a three-layer detection pipeline (below).
- If it looks like a fake, shows a warning that explains *why* — highlighting the specific elements that gave it away.
- Tests several warning designs against each other to find which one actually makes people stop and think.

## Detection Pipeline

The detector combines three independent checks. Each catches cases the others miss, and the combination produces an explainable verdict rather than a bare yes/no.

### Layer 1 — Visual similarity (perceptual hashing)

On page load, capture the visible page and generate a perceptual hash (pHash, DCT-based). Compare against a pre-built reference set of ~15 real brand login pages. A close hash match means "this looks like Brand X."

- Catches attacker pages copied pixel-for-pixel.
- Fast (<50 ms) and cheap.
- Reference hashes are generated at build time and bundled as static data.

### Layer 2 — Domain legitimacy check

If the visual match says "this looks like Brand X" but the actual domain is not on Brand X's known-domains allowlist, that is the core phishing signal.

- Also runs a homoglyph/lookalike check on the domain itself (Levenshtein distance + character substitution, e.g. `paypa1.com` vs `paypal.com`) to catch typosquatting even when visual similarity is imperfect.

### Layer 3 — Element-level localization

Determine *which* elements triggered the match so the warning can point at them:

- **DOM inspection** — read the actual page: presence and layout of login forms, logo `<img>` source vs. bundled brand logo templates, dominant color scheme, brand keywords in text.
- **Logo template matching** — canvas-based match of detected logo regions against bundled brand logo images.
- DOM inspection beats image-based analysis on screenshots because the actual elements are readable, which is what makes the result precise and explainable.

Pipeline output — not just a yes/no:

```json
{
  "riskScore": 0.0–1.0,
  "matchedBrand": "paypal" | null,
  "flaggedElements": ["logo", "form-field", "domain"],
  "reasoning": "This page's logo and layout match PayPal, but the domain paypa1.com is not an official PayPal domain."
}
```

### Why three layers

- Perceptual hashing alone is fast but coarse (misses partial clones).
- Domain checking alone misses pages hosted on compromised-but-otherwise-legitimate domains.
- Element localization alone is expensive and lacks the brand context of the other two.

Combined, they cover more cases than any single method and give the warning stage concrete evidence to point to.

## Standalone Architecture (No Backend)

The Python tools are **development-only** and never ship with the extension.

### Build time (Python, dev only)

A dataset-generation script captures the ~15 brand login pages and precomputes:

- pHash of each brand login page (using `imagehash`).
- Logo templates (cropped, downscaled, encoded as base64).
- Brand color palettes.
- Domain allowlists and lookalike/homoglyph rules.

Output: `assets/brands/brands.json` — a few MB total, bundled into the extension. No runtime dependency on Python, OpenCV, or any server.

### Runtime (100% in-extension)

- **Background service worker** — orchestrates the pipeline. On navigation to an `http(s)` page, captures a screenshot via `tabs.captureVisibleTab` and runs the domain check (pure JS).
- **Offscreen document** — canvas-based image processing: resize/grayscale, DCT pHash, and logo template matching. (WXT supports an `offscreen.html` entrypoint.)
- **Content script** — extracts DOM features (login form, logo, colors, keywords) and renders warnings with highlighted elements.
- **Packaged dataset** — `assets/brands/brands.json` loaded by the workers.

### Permissions (Manifest V3)

- `<all_urls>` host permission — required for automatic screenshot capture on any page. Install-time notice explains why a security extension needs it.
- `storage` — for scan history and warning-logging.
- `tabs` — detect tab navigation events and capture screenshots.
- `offscreen` — create offscreen document for canvas-based image processing.
- `webNavigation` — detect page navigation events.

## Warning Layer

Uses the pipeline output (`flaggedElements` + `reasoning`) to render warnings that point at the actual suspicious parts of the page.

Tested delivery formats (A/B):

- Full-screen interceptor banner.
- Popup dialog.
- Tooltip near the password field.
- Small status icon.

Logging: for each warning, record whether it was shown, dismissed, proceeded, or the user went back — the interaction data used to evaluate which format works.

## Project Structure

```
phish_ext/
  src/
    entrypoints/            # WXT entrypoints
      background.ts         # pipeline orchestrator + domain check
      content.ts            # DOM extraction + warning UI
      offscreen/            # canvas pHash + logo matching
      popup/                # status/settings UI
    lib/                    # shared types & interfaces
    utils/                  # shared code (phash, levenshtein, homoglyph)
    assets/brands/          # bundled reference dataset (generated)
    components/             # reusable UI components
  tools/                    # dev-only Python dataset generator (not shipped)
  public/                   # extension icons and static assets
  docs/                     # architecture & development docs
  wxt.config.ts
```

## Stretch Goal

CLIP-style embedding comparison (via `onnxruntime-web`, fully local) for recognizing logo/page variants that template matching misses. Deferred because of bundle size (~30–150 MB model) and CPU latency. Layer 3 will expose a clean `logoMatcher` interface so CLIP can be swapped in later without rearchitecting.

## Build Sequence

1. [done] Initialize WXT project (Vanilla TS + pnpm + `src/` layout).
2. [done] Scaffold entrypoints: `background`, `content`, `offscreen`, `popup`.
3. Implement the three-layer pipeline in TypeScript (pHash, domain check, DOM localization).
4. Write the build-time Python dataset generator in `tools/`.
5. Build warning UI with element highlighting, then add A/B variants and interaction logging.
