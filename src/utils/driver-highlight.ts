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
    console.warn('[phish_ext] No flagable elements to highlight.', result);
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

/**
 * Demo mode — fabricates a sample verdict against `demo.html` (the local
 * target portal site) so we can see Driver.js highlighting in action before
 * the real detection pipeline exists.
 *
 * Targets real elements by their stable selectors on the demo page.
 */
export function demoHighlight(): void {
  const flagged: FlaggedElement[] = [
    {
      element: 'brand-logo',
      reason: 'logo_match',
      selector: '#brand-logo',
      title: 'Logo appears copied',
      note:
        'This logo closely matches DummyBank\u2019s official mark, but it is being served ' +
        'from this page rather than from DummyBank.com. Copying a familiar logo is one of ' +
        'the most common ways a fake login page builds trust.',
    },
    {
      element: 'sign-in-form',
      reason: 'form_layout',
      selector: '#login-form',
      title: 'Familiar sign-in layout',
      note:
        'The arrangement of the logo, the username and password fields, and the blue Sign In ' +
        'button reproduces DummyBank\u2019s real login page layout. Layout imitation on its own ' +
        'is not conclusive, but combined with the other signals it raises the risk score.',
    },
    {
      element: 'brand-phrase',
      reason: 'brand_keywords',
      selector: '#brand-phrase',
      title: 'Brand-specific wording reused',
      note:
        'This exact wording — naming \u201CS-Shield\u201D, DummyBank\u2019s one-time security code ' +
        'program — appears on official DummyBank pages. Finding DummyBank-unique phrasing here ' +
        'is a strong signal the page reused the target brand\u2019s own text.',
    },
  ];

  highlightFlaggedElements({
    riskScore: 0.82,
    matchedBrand: 'DummyBank',
    flaggedElements: flagged,
    reasoning:
      'This page reproduces DummyBank\u2019s logo, sign-in layout, and sign-in wording, ' +
      'but the domain DummyBank-login.xyz is not an official DummyBank domain.',
  });
}

