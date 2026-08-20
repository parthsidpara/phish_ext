import type { DetectionResult, ExtensionMessage, FlaggedElement } from '@/lib/types';
import type { WarningCondition } from '@/lib/conditions';
import { logInteraction } from '@/utils/interaction-log';
import { clearHighlight, highlightFlaggedElements } from '@/utils/driver-highlight';
import { bannerRenderer } from '@/components/renderers/banner';
import { iconRenderer } from '@/components/renderers/icon';
import { modalRenderer } from '@/components/renderers/modal';
import type { Renderer, WarningActions } from '@/components/renderers';

/**
 * Progressive Reveal — the adaptive warning condition.
 *
 * Owns a stage state machine (1 → 4) driven by measured user hesitation:
 * - a dwell timer is the baseline escalator,
 * - cursor proximity to the credential field and focus/typing on it accelerate
 *   escalation to the next stage (strong intent signals).
 *
 * Each stage composes the existing static renderers and reveals one more piece
 * of the `flaggedElements`/`reasoning` evidence:
 *   Stage 1  passive icon, no evidence
 *   Stage 2  highlight + one-reason banner (highlight no-ops until flagged
 *            elements carry selectors — Layer 3)
 *   Stage 3  banner with the revealed evidence
 *   Stage 4  modal with the full reasoning, forced decision
 *
 * Every stage transition is logged (`escalated` + stage); final actions carry
 * the stage reached.
 */

/** Dwell time (ms) before escalating from stage 1→2, 2→3, 3→4. */
const STAGE_DWELL_MS = [8000, 12000, 15000] as const;
/** Cursor-to-credential-field distance (px) that counts as "approaching". */
const APPROACH_PX = 150;
/** mousemove throttle interval (ms). */
const MOVE_THROTTLE_MS = 150;
/** Minimum gap between signal-driven escalations (avoids an instant stage 4
 *  from a single hover or a few keystrokes). */
const SIGNAL_COOLDOWN_MS = 2000;

const STAGES = 4;

/** The first `stage - 1` flagged elements are the evidence revealed so far. */
function revealedFlags(flags: FlaggedElement[], stage: number): FlaggedElement[] {
  return flags.slice(0, Math.min(stage - 1, flags.length));
}

/** The credential field to watch for approach/focus signals. */
function credentialField(): HTMLElement | null {
  return document.querySelector<HTMLElement>('input[type="password"], input:not([type="hidden"])');
}

export interface ProgressiveRevealHandle {
  destroy(): void;
}

/**
 * Start a Progressive Reveal session for a detection verdict.
 * Returns a handle whose `destroy()` tears down all listeners and the active
 * renderer (call it when a new warning replaces this one).
 */
export function startProgressiveReveal(
  result: DetectionResult,
  condition: WarningCondition,
  url: string,
): ProgressiveRevealHandle {
  let stage = 1;
  let activeRenderer: Renderer | null = null;
  let dwellTimer: number | null = null;
  let disposed = false;

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    if (dwellTimer != null) {
      clearTimeout(dwellTimer);
      dwellTimer = null;
    }
    window.removeEventListener('mousemove', onMove);
    document.removeEventListener('focusin', onFocus, true);
    document.removeEventListener('keydown', onKey, true);
    activeRenderer?.destroy();
    activeRenderer = null;
    clearHighlight();
  };

  const actions: WarningActions = {
    onGoBack: () => {
      void logInteraction('went-back', result, url, condition, stage);
      dispose();
      browser.runtime
        .sendMessage({ type: 'GO_BACK' } satisfies ExtensionMessage)
        .catch(() => {});
    },
    onProceed: () => {
      void logInteraction('proceeded', result, url, condition, stage);
      dispose();
    },
    onDismiss: () => {
      void logInteraction('dismissed', result, url, condition, stage);
      dispose();
    },
  };

  function renderStage(s: number): void {
    const revealed = revealedFlags(result.flaggedElements, s);
    const partial: DetectionResult = {
      riskScore: result.riskScore,
      matchedBrand: result.matchedBrand,
      flaggedElements: revealed,
      reasoning:
        s >= STAGES
          ? result.reasoning
          : revealed
              .map((f) => [f.title, f.note].filter(Boolean).join(' — '))
              .filter(Boolean)
              .join(' ')
              .trim() || 'This page may not be safe.',
    };

    activeRenderer?.destroy();
    activeRenderer = null;
    clearHighlight();

    if (s === 1) {
      activeRenderer = iconRenderer();
      activeRenderer.show(partial, actions);
    } else if (s === 2) {
      activeRenderer = bannerRenderer();
      activeRenderer.show(partial, actions);
      // Highlight the revealed evidence; no-op until flags carry selectors (Layer 3).
      if (partial.flaggedElements.some((f) => f.selector)) {
        highlightFlaggedElements(partial);
      }
    } else if (s === 3) {
      activeRenderer = bannerRenderer();
      activeRenderer.show(partial, actions);
    } else {
      activeRenderer = modalRenderer();
      activeRenderer.show(partial, actions);
    }

    if (s < STAGES) {
      dwellTimer = window.setTimeout(() => {
        if (!disposed) escalate();
      }, STAGE_DWELL_MS[s - 1]);
    }
  }

  function escalate(): void {
    if (disposed || stage >= STAGES) return;
    stage += 1;
    void logInteraction('escalated', result, url, condition, stage);
    renderStage(stage);
  }

  let lastMoveAt = 0;
  let wasInProximity = false;
  let lastSignalEscalation = 0;

  /** Signal-driven escalation (hover-approach / focus / typing), rate-limited
   *  so a sustained hover or a few keystrokes don't jump straight to stage 4. */
  function signalEscalate(): void {
    const now = Date.now();
    if (now - lastSignalEscalation < SIGNAL_COOLDOWN_MS) return;
    lastSignalEscalation = now;
    escalate();
  }

  function onMove(e: MouseEvent): void {
    const now = Date.now();
    if (now - lastMoveAt < MOVE_THROTTLE_MS) return;
    lastMoveAt = now;

    const field = credentialField();
    if (!field) return;
    const rect = field.getBoundingClientRect();
    const dx = Math.max(rect.left - e.clientX, 0, e.clientX - rect.right);
    const dy = Math.max(rect.top - e.clientY, 0, e.clientY - rect.bottom);
    const inProximity = Math.hypot(dx, dy) <= APPROACH_PX;
    // Escalate on *entering* the approach zone, not while lingering inside it.
    const shouldEscalate = inProximity && !wasInProximity;
    wasInProximity = inProximity;
    if (shouldEscalate) signalEscalate();
  }

  function onFocus(e: FocusEvent): void {
    const t = e.target;
    if (t instanceof HTMLElement && t.matches('input[type="password"], input:not([type="hidden"])')) {
      signalEscalate();
    }
  }

  function onKey(e: KeyboardEvent): void {
    const t = document.activeElement;
    if (t instanceof HTMLElement && t.matches('input[type="password"]')) {
      signalEscalate();
    }
  }

  renderStage(1);

  window.addEventListener('mousemove', onMove, { passive: true });
  document.addEventListener('focusin', onFocus, true);
  document.addEventListener('keydown', onKey, true);

  return { destroy: dispose };
}