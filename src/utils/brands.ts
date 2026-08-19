/**
 * Brand dataset loader.
 *
 * At build time, the Python tools/ directory generates a single static file:
 *   assets/brands/brands.json    # Array<BrandReference> + base64-encoded logo images
 *
 * At runtime, the loader fetches this file once and caches it.
 */

import type { BrandReference } from '@/lib/types';

// Vite resolves the `?url` import to the emitted asset URL — in `wxt dev` a
// dev-server URL, in a built extension a `chrome-extension://...` URL. The
// file stays in src/assets/ (the path the Python tools/ generator writes to)
// and is emitted as a static asset rather than inlined into the SW bundle.
import brandsUrl from '@/assets/brands/brands.json?url';

let cachedBrands: BrandReference[] | null = null;

/**
 * Load the full brand dataset from the bundled static file.
 *
 * Cached after the first load so we don't re-fetch on every page load.
 */
export async function loadBrands(): Promise<BrandReference[]> {
  if (cachedBrands) return cachedBrands;

  const res = await fetch(brandsUrl);
  if (!res.ok) {
    throw new Error(`[phish_ext] Failed to load brands.json: HTTP ${res.status}`);
  }
  cachedBrands = (await res.json()) as BrandReference[];
  return cachedBrands;
}

/**
 * Load a brand's logo as an ImageBitmap from the bundled dataset.
 * The logo image data is embedded in brands.json as a base64 data URL.
 *
 * TODO: Implement once the logo-template pipeline exists (Layer 3)
 * 1. Look up the brand in the cached dataset by ID
 * 2. Decode the base64-encoded logo image URL
 * 3. Convert to ImageBitmap (for canvas operations)
 */
export async function loadLogoTemplate(_brandId: string): Promise<ImageBitmap | null> {
  return null;
}
