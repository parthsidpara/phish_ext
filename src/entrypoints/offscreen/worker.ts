import type { ComputePHashMessage, MatchLogosMessage, ExtensionMessage } from '@/lib/types';

// ── Canvas-based perceptual hashing (Layer 1) ──

/**
 * Compute a DCT-based perceptual hash of an image.
 *
 * Algorithm outline:
 * 1. Decode the base64 PNG → ImageBitmap
 * 2. Draw onto offscreen canvas, resize to 32×32 grayscale
 * 3. Compute 2D DCT (Discrete Cosine Transform) on the 32×32 pixel matrix
 * 4. Take the top-left 8×8 of the DCT result (low-frequency coefficients)
 * 5. Compare each coefficient against the median → 64-bit binary string
 * 6. Return the hex-encoded hash
 *
 * Comparison: two hashes are "close" if Hamming distance <= threshold.
 * Typical thresholds: < 5 for 64-bit pHash, < 10 for 256-bit variants.
 */
async function computePHash(imageData: string): Promise<string> {
  // TODO: Implement DCT-based pHash
  // 1. const blob = base64ToBlob(imageData, 'image/png');
  // 2. const bitmap = await createImageBitmap(blob);
  // 3. Draw to canvas, resize to 32x32, convert to grayscale
  // 4. Compute 2D DCT (requires a DCT implementation or use FFT-based approach)
  // 5. Extract 8x8 low-frequency block
  // 6. Binary thresholding against median -> 64-bit hash
  // 7. Return hex string

  console.log('[phish_ext:offscreen] pHash requested');
  return '';
}

// ── Logo template matching (Layer 3) ──

async function matchLogoTemplates(imageData: string, brandId: string): Promise<Array<{ x: number; y: number; width: number; height: number }>> {
  // TODO: Implement logo template matching
  // 1. Look up the brand's logo data from the cached brands.json dataset
  // 2. Decode both the screenshot and the logo template to ImageBitmaps
  // 3. Run template matching: slide the logo template across the screenshot
  //    - Use a simple cross-correlation or MSE approach on the canvas pixel data
  //    - Or: use a perceptual-hash of sliding windows and compare to the logo's pHash
  // 4. Return the coordinates of the best match (if above confidence threshold)
  // 5. If no match → return empty array
  // For a simpler starting point: compare hashes of regions against the logo hash.
  console.log('[phish_ext:offscreen] Logo match requested for brand:', brandId);
  return [];
}

// ── Message handler ──

browser.runtime.onMessage.addListener(
  async (message: ExtensionMessage): Promise<ExtensionMessage | undefined> => {
    switch (message.type) {
      case 'COMPUTE_PHASH': {
        const hash = await computePHash(message.imageData);
        return { type: 'PHASH_RESULT', hash };
      }

      case 'MATCH_LOGOS': {
        const matches = await matchLogoTemplates(message.imageData, message.brandId);
        return { type: 'LOGO_MATCH_RESULT', matches };
      }

      default:
        return undefined;
    }
  },
);
