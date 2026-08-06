# Development Guide

## Prerequisites

- Node.js >= 20
- pnpm >= 9

## Setup

```bash
git clone https://github.com/Sakshee21/phish_ext.git
cd phish_ext
pnpm install   # install deps + run wxt prepare (postinstall)
pnpm dev       # start dev mode, opens Chromium with extension loaded
```

## Project structure

```
phish_ext/
  src/
    entrypoints/
      background.ts      # Pipeline orchestrator + domain check (Layer 2)
      content.ts         # DOM extraction (Layer 3) + warning UI
      offscreen/
        index.html       # Canvas pHash (Layer 1) + logo matching entrypoint
        worker.ts        # Offscreen document script
      popup/             # Extension popup — status & stats
    lib/
      types.ts           # Shared TypeScript interfaces
    utils/
       phash.ts           # pHash algorithm docs (DCT-based perceptual hashing)
      domain-check.ts    # Levenshtein + homoglyph checks (implemented)
      brands.ts          # Brand dataset loader stub
      messaging.ts       # Message type re-export
    assets/brands/       # Bundled reference dataset (generated at build time)
    components/          # Reusable UI components (future)
  tools/                 # Build-time Python dataset generator
  docs/                  # Architecture & development docs
  public/                # Static files copied as-is (icons, etc.)
  wxt.config.ts          # WXT configuration
```

## How the pipeline works

1. **Page loaded** — `background.ts` detects navigation via `webNavigation.onCompleted`.
2. **Screenshot** — background calls `tabs.captureVisibleTab` and sends the image to the offscreen document.
3. **pHash** — offscreen document runs DCT-based perceptual hash, returns the hash.
4. **Domain check** — background compares the URL against brand allowlists using
   Levenshtein distance and homoglyph substitution (only runs when a visual
   match is found).
5. **DOM extraction** — content script extracts form fields, logo candidates, colors, and keywords from the page DOM.
6. **Aggregation** — background combines all three layers into a `DetectionResult{ riskScore, matchedBrand, flaggedElements, reasoning }`.
7. **Warning** — background sends the result to the content script, which renders the warning overlay with highlighted elements.

## Where to start implementing

1. **`src/utils/domain-check.ts`** — already has `levenshtein()` and `checkDomain()` implemented. Wire these into `background.ts`'s `checkDomainLegitimacy()`.

2. **`src/entrypoints/offscreen/worker.ts`** — implement `computePHash()` using DCT-based pHash:

3. **`src/entrypoints/content.ts`** — implement `extractDOMFeatures()` to actually read login forms, logo candidates, and page colors.

4. **`src/utils/brands.ts`** — implement the brand dataset loader once the `tools/` generator produces the initial dataset.

5. **`tools/`** — write the Python dataset generator using `imagehash` + Playwright to precompute brand hashes and extract logo templates.

## Building for production

```bash
pnpm build              # Chrome/Chromium
pnpm build:firefox      # Firefox
pnpm zip                # Creates .zip for store submission
```

## Testing in Firefox

```bash
pnpm dev:firefox
```
