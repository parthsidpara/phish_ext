# tools/ — Build-time dataset generator

This directory contains **development-only** Python scripts that precompute the
brand reference dataset. These scripts are run once offline and their output
(brand hashes, logo templates, domain lists, colour palettes) is bundled into
the extension under `src/assets/brands/`.

The tooling is **not shipped** with the extension and has no runtime dependency.

## What it should do

Given a list of brand login page URLs, the generator:

1. **Captures** each brand's login page (e.g. via Playwright or Selenium).
2. **Computes a perceptual hash** (pHash, `imagehash` Python library) of the
   full-page screenshot.
3. **Extracts the logo** — crops the brand logo from the page (manual annotation
   or automatic via heuristics), downscales it, and encodes as a base64 data URL.
4. **Extracts the colour palette** — dominant colours from the login page
   header/body.
5. **Records the domain allowlist** — known legitimate domains for the brand,
   plus lookalike/homoglyph variants to flag.
6. **Extracts brand keywords** — distinctive text found on the real login page.
7. **Writes** `assets/brands/brands.json` containing all brand data including
   base64-encoded logo images.

## Dependencies (candidates)

- `imagehash` + `Pillow` — perceptual hashing
- `playwright` — headless browser for screenshot capture
- `colorthief` — dominant colour extraction
- `pyyaml` or `json` — brand config/URL list
