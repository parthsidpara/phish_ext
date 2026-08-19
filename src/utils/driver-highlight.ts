import { driver, type DriveStep } from 'driver.js';
import 'driver.js/dist/driver.css';

import type { DetectionResult, FlaggedElement } from '@/lib/types';

/**
 * Driver.js adapter — highlights flagged elements on the current page and
 * annotates *why* each one contributed to the phishing verdict.
 *
 * Driver.js works entirely inside the page DOM (an SVG spotlight overlay plus
 * floating "popover" bubbles). Because a content script shares the page DOM,
 * this runs from the content script context and can highlight any element the
 * detection pipeline returned via `FlaggedElement.selector`.
 *
 * The `flaggedElements` + `reasoning` shape in `DetectionResult` maps 1:1
 * onto a Driver.js tour:
 *   - one step (DriveStep) per flagged element
 *   - element target  = `FlaggedElement.selector`
 *   - popover title   = the flag reason / element label
 *   - popover body    = the human-readable reasoning
 */

let activeHighlight: ReturnType<typeof driver> | null = null;

/** Destroy any tour that is currently on screen. */
export function clearHighlight(): void {
  activeHighlight?.destroy();
  activeHighlight = null;
}

/** Humanize an internal reason enum into a fallback heading. */
function humanizeReason(reason: string): string {
  return reason
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/**
 * Build a Driver.js step for a single flagged element. Uses the per-element
 * `title` / `note` when the detector provides them, otherwise falls back to a
 * humanized reason heading and the overall reasoning summary.
 */
function stepForElement(
  flagged: FlaggedElement,
  reasoning: string,
  index: number,
  total: number,
): DriveStep {
  return {
    element: flagged.selector || undefined,
    // If an element has no usable selector, let Driver.js drive without a target
    // (it will just show the fixed popover rather than failing on a missing node).
    skipMissingElement: true,
    popover: {
      title: flagged.title ?? humanizeReason(flagged.reason),
      description: flagged.note ?? reasoning,
      side: 'right',
      align: 'start',
      popoverClass: 'phish-popover',
      progressText: `Evidence ${index + 1} of ${total}`,
    },
  };
}

/**
 * Drive a Driver.js tour over every flagged element in a detection result.
 *
 * The first flagged element (the most direct evidence) is shown first; the
 * tour can be stepped through with the arrow buttons or closed at any time.
 */
export function highlightFlaggedElements(result: DetectionResult): void {
  clearHighlight();

  const flagged = result.flaggedElements.filter((f) => f.selector);
  if (flagged.length === 0) {
    // Expected until Layer 3 supplies CSS selectors — not an error.
    console.debug('[phish_ext] No selector-bearing flagged elements to highlight:', result.matchedBrand);
    return;
  }

  const steps = flagged.map((f, i) =>
    stepForElement(f, result.reasoning, i, flagged.length),
  );

  activeHighlight = driver({
    steps,
    // Dim the rest of the page so the flagged element stands out.
    overlayColor: '#000000',
    overlayOpacity: 0.55,
    smoothScroll: true,
    stageRadius: 8,
    stagePadding: 6,
    showProgress: true,
    showButtons: ['next', 'previous', 'close'],
    allowClose: true,
    doneBtnText: 'Done',
  });

  activeHighlight.drive();
}

