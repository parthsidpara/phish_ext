/**
 * Typed messaging helpers for background ↔ content ↔ offscreen communication.
 *
 * In Manifest V3, the three extension contexts communicate via
 * `browser.runtime.sendMessage` / `browser.runtime.onMessage`.
 *
 * Communication flows:
 *
 *   Background ──────────────────► Offscreen
 *     COMPUTE_PHASH                    → PHASH_RESULT
 *     MATCH_LOGOS                      → LOGO_MATCH_RESULT
 *
 *   Background ──────────────────► Content
 *     DETECTED
 *
 *   Content ─────────────────────► Background
 *     PAGE_READY
 *
 * All message types are defined in src/lib/types.ts.
 */

export type { ExtensionMessage } from '@/lib/types';
