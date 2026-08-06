/**
 * Brand dataset loader.
 *
 * At build time, the Python tools/ directory generates a single static file:
 *   assets/brands/brands.json    # Array<BrandReference> + base64-encoded logo images
 *
 * At runtime, the loader fetches this file once and caches it.
 */

import type { BrandReference } from '@/lib/types';

/**
 * Load the full brand dataset from the bundled static file.
 *
 * TODO: Implement the loader
 * 1. Fetch /assets/brands/brands.json
 * 2. Parse as BrandReference[]
 * 3. Cache the result to avoid re-fetching on every page load
 */
export async function loadBrands(): Promise<BrandReference[]> {
  return [];
}

/**
 * Load a brand's logo as an ImageBitmap from the bundled dataset.
 * The logo image data is embedded in brands.json as a base64 data URL.
 *
 * TODO: Implement
 * 1. Look up the brand in the cached dataset by ID
 * 2. Decode the base64-encoded logo image URL
 * 3. Convert to ImageBitmap (for canvas operations)
 */
export async function loadLogoTemplate(_brandId: string): Promise<ImageBitmap | null> {
  return null;
}
