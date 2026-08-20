/**
 * DCT-based perceptual hashing (pHash) for screenshot comparison.
 *
 * This is Layer 1 of the detection pipeline. The algorithm itself is pure
 * TypeScript — no canvas/DOM APIs, no third-party library. It operates on an
 * already-decoded pixel buffer (RGBA, same layout as the browser's
 * `ImageData`), so it runs identically whether the pixels came from the
 * offscreen document's canvas or a plain array in a Node test script.
 *
 * Decoding the *source* image (PNG bytes -> pixels) does require canvas and
 * stays in `src/entrypoints/offscreen/worker.ts`, since that's the only
 * context in this extension with canvas access.
 *
 * ## Algorithm
 *
 * 1. Crop to a fixed top band (height = `CROP_ASPECT` x image width).
 *    A screenshot only contains what happened to be *visible*, so a tall
 *    window shows more of the page than a short one and the two images differ
 *    enormously even though it is the same page. Tying the band's height to
 *    the image's own width makes the hash independent of window height --
 *    measured: two captures of one page at 1920 wide but 1080 vs 955 tall go
 *    from 26 bits apart to 0. It also cancels display scaling, since the band
 *    scales with the image.
 *
 *    Window *width* is not normalised away, and cannot be: at different widths
 *    the page genuinely reflows (columns rewrap, elements resize). Width
 *    buckets in the reference dataset cover that; see tools/config.json.
 * 2. Convert to grayscale (ITU-R BT.601 luma weights).
 * 3. Resize down to 32x32 via box-filter (area-average) downsampling.
 *    - Grayscale is applied before resizing rather than after — mathematically
 *      equivalent (luma is a linear combination of R/G/B, and box-filter
 *      averaging commutes with linear combinations) but cheaper, since the
 *      resize pass then touches one channel instead of four.
 * 4. Compute a 2D DCT-II (separable: 1D DCT along rows, then along columns).
 * 5. Take the top-left 8x8 block of the DCT result (the lowest frequencies —
 *    the coarse structure of the image, ignoring fine detail/noise).
 * 6. Compute the median of those 64 coefficients, *excluding* the [0][0] DC
 *    term (it just encodes overall brightness and would skew the median away
 *    from the coefficients that actually describe structure).
 * 7. Threshold all 64 coefficients (DC term included) against that median:
 *    above -> 1, below -> 0. The result is a 64-bit hash, hex-encoded.
 *
 * ## Comparison
 *
 * Use `hammingDistance()` between two hashes. A distance <= 5 (out of 64
 * bits) indicates the images are perceptually very similar (potential clone).
 */

// ── Types ──

/**
 * Minimal pixel-buffer shape, structurally compatible with the browser's
 * `ImageData` (same RGBA-interleaved layout), so a canvas `getImageData()`
 * result can be passed in directly with no conversion.
 */
export interface PixelBuffer {
  width: number;
  height: number;
  /** RGBA interleaved, 4 values per pixel. */
  data: ArrayLike<number>;
}

// ── Tunables ──

/**
 * Height of the hashed band, as a fraction of the image's width.
 *
 * 0.45 was chosen empirically: small enough to still fit inside a maximised
 * 16:9 window (1920x1080 needs 864 <= 1080), which matters because the band
 * has to be fully present in *both* the reference capture and the live one
 * for their hashes to agree.
 */
export const CROP_ASPECT = 0.45;

/** Side length the image is downsampled to before the DCT. */
export const RESIZE_SIZE = 32;
/** Side length of the low-frequency block kept from the DCT result. */
export const LOW_FREQ_SIZE = 8;
/** Total hash length in bits (LOW_FREQ_SIZE^2). */
export const HASH_BITS = LOW_FREQ_SIZE * LOW_FREQ_SIZE;

// ── Step 2: grayscale (luma, ITU-R BT.601 weights) ──

export function toGrayscale(pixels: PixelBuffer, rows?: number): Float64Array {
  const { width, data } = pixels;
  const height = Math.min(pixels.height, rows ?? pixels.height);
  const gray = new Float64Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const o = i * 4;
    gray[i] = 0.299 * data[o]! + 0.587 * data[o + 1]! + 0.114 * data[o + 2]!;
  }
  return gray;
}

// ── Step 3: resize via box filter (area averaging) ──

/**
 * Downsample a single-channel grayscale buffer to `dstSize x dstSize` by
 * averaging each destination pixel's source region. Box filtering (rather
 * than nearest-neighbor) matters here: a screenshot is typically downsampled
 * by 30-60x, and averaging keeps the hash stable against the kind of
 * pixel-level noise that differs between two captures of the *same* page
 * (font antialiasing, compression artifacts) — nearest-neighbor would just
 * pick one noisy sample per destination pixel and flip hash bits on it.
 */
export function resizeGrayscale(
  gray: ArrayLike<number>,
  srcWidth: number,
  srcHeight: number,
  dstSize: number,
): number[][] {
  const out: number[][] = Array.from({ length: dstSize }, () => new Array<number>(dstSize).fill(0));

  for (let y = 0; y < dstSize; y++) {
    const ySrcStart = Math.floor((y * srcHeight) / dstSize);
    const ySrcEnd = Math.min(srcHeight, Math.max(ySrcStart + 1, Math.floor(((y + 1) * srcHeight) / dstSize)));

    for (let x = 0; x < dstSize; x++) {
      const xSrcStart = Math.floor((x * srcWidth) / dstSize);
      const xSrcEnd = Math.min(srcWidth, Math.max(xSrcStart + 1, Math.floor(((x + 1) * srcWidth) / dstSize)));

      let sum = 0;
      let count = 0;
      for (let sy = ySrcStart; sy < ySrcEnd; sy++) {
        const rowOffset = sy * srcWidth;
        for (let sx = xSrcStart; sx < xSrcEnd; sx++) {
          sum += gray[rowOffset + sx]!;
          count++;
        }
      }
      out[y]![x] = count > 0 ? sum / count : 0;
    }
  }

  return out;
}

// ── Step 4: 2D DCT-II (separable: 1D DCT on rows, then on columns) ──

/** Orthonormal 1D DCT-II. O(N^2); trivial at N=32 (~1k multiply-adds). */
export function dct1D(vector: ArrayLike<number>): number[] {
  const N = vector.length;
  const result = new Array<number>(N);

  for (let k = 0; k < N; k++) {
    let sum = 0;
    for (let n = 0; n < N; n++) {
      sum += vector[n]! * Math.cos((Math.PI / N) * (n + 0.5) * k);
    }
    const alpha = k === 0 ? Math.sqrt(1 / N) : Math.sqrt(2 / N);
    result[k] = alpha * sum;
  }

  return result;
}

/**
 * 2D DCT-II via two 1D passes (rows, then columns) — O(N^3) instead of the
 * O(N^4) a naive direct 2D formulation would need. At N=32 that's ~65k
 * multiply-adds total, well under a millisecond.
 */
export function dct2D(matrix: number[][]): number[][] {
  const size = matrix.length;
  const rowsTransformed = matrix.map((row) => dct1D(row));

  const result: number[][] = Array.from({ length: size }, () => new Array<number>(size).fill(0));
  for (let x = 0; x < size; x++) {
    const column = rowsTransformed.map((row) => row[x]!);
    const columnDct = dct1D(column);
    for (let y = 0; y < size; y++) {
      result[y]![x] = columnDct[y]!;
    }
  }

  return result;
}

// ── Steps 5-7: low-frequency block -> median (excluding DC) -> 64-bit hash ──

function medianOf(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

/**
 * Extract the hash bits from a DCT matrix: the top-left `LOW_FREQ_SIZE`
 * square, thresholded against the median of that block *excluding* the
 * [0][0] DC term (see module doc). The DC term still gets a hash bit — it's
 * only excluded from the median computation, so the output stays a full
 * `HASH_BITS`-length hash.
 */
export function extractHashBits(dct: number[][]): boolean[] {
  const values: number[] = [];
  for (let y = 0; y < LOW_FREQ_SIZE; y++) {
    for (let x = 0; x < LOW_FREQ_SIZE; x++) {
      values.push(dct[y]![x]!);
    }
  }

  const withoutDC = values.slice(1); // index 0 is [0][0] in row-major order
  const median = medianOf(withoutDC);
  return values.map((v) => v > median);
}

function bitsToHex(bits: boolean[]): string {
  let hex = '';
  for (let i = 0; i < bits.length; i += 4) {
    let nibble = 0;
    for (let j = 0; j < 4; j++) {
      nibble = (nibble << 1) | (bits[i + j] ? 1 : 0);
    }
    hex += nibble.toString(16);
  }
  return hex;
}

// ── Public API ──

/**
 * Compute a DCT-based perceptual hash from raw pixel data at any source
 * size. Returns a lowercase hex string, `HASH_BITS / 4` characters long
 * (16 chars for the default 64-bit hash).
 */
export function computePerceptualHash(pixels: PixelBuffer): string {
  // Only the top band is hashed, so window height doesn't change the result.
  // Rows below it are never even converted to grayscale.
  const bandHeight = Math.max(1, Math.min(pixels.height, Math.round(pixels.width * CROP_ASPECT)));
  const gray = toGrayscale(pixels, bandHeight);
  const resized = resizeGrayscale(gray, pixels.width, bandHeight, RESIZE_SIZE);
  const dct = dct2D(resized);
  const bits = extractHashBits(dct);
  return bitsToHex(bits);
}

/**
 * Hamming distance between two hex-encoded hashes (count of differing bits).
 * Uses BigInt since a 64-bit hash exceeds the 32-bit range JS's native
 * bitwise operators support.
 */
export function hammingDistance(hashA: string, hashB: string): number {
  if (hashA.length !== hashB.length) {
    throw new Error(`hammingDistance: hash length mismatch ("${hashA}" vs "${hashB}")`);
  }

  let xor = BigInt(`0x${hashA}`) ^ BigInt(`0x${hashB}`);
  let distance = 0;
  while (xor > 0n) {
    distance += Number(xor & 1n);
    xor >>= 1n;
  }
  return distance;
}
