/**
 * DCT-based perceptual hashing (pHash) for screenshot comparison.
 *
 * This module provides the core algorithm for Layer 1 of the detection pipeline.
 * It runs in the offscreen document (canvas access required).
 *
 * ## Algorithm
 *
 * 1. Resize image to 32x32 pixels and convert to grayscale.
 * 2. Compute the 2D Discrete Cosine Transform (DCT-II) on the pixel matrix.
 * 3. Extract the top-left 8x8 of the DCT result (lowest frequencies).
 * 4. Compare each coefficient to the median value.
 *    - Above median -> 1, below median -> 0.
 * 5. The resulting 64-bit string is the pHash.
 *
 * ## Comparison
 *
 * Use Hamming distance between two hashes. A distance <= 5 indicates the
 * images are perceptually very similar (potential clone).
 */
export {};

// TODO: Implement DCT-based pHash algorithm
// This will be called from src/entrypoints/offscreen/worker.ts
