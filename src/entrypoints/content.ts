import type { DOMFeatures, DetectedMessage, ExtensionMessage } from '@/lib/types';
import { logInteraction } from '@/utils/interaction-log';
import { highlightFlaggedElements } from '@/utils/driver-highlight';
import { startProgressiveReveal, type ProgressiveRevealHandle } from '@/utils/behavior-monitor';
import { renderers, type Renderer } from '@/components/renderers';
import { getActiveCondition } from '@/lib/conditions';

export default defineContentScript({
  matches: ['*://*/*'],
  excludeMatches: ['*://localhost/*'],

  main() {
    console.log('[phish_ext] Content script loaded on:', window.location.href);

    // ── DOM feature extraction (Layer 3 data source) ──

    function extractDOMFeatures(): DOMFeatures {
      // TODO: Extract relevant DOM features for brand matching
      // 1. Detect login forms:
      //    - Look for input[type="password"] fields → if present, mark hasLoginForm = true
      //    - Count password fields
      // 2. Detect logo candidates:
      //    - Query <img> elements with class/id containing "logo", "brand", "header"
      //    - Also check <svg> with logo-like class names
      //    - Return their src attributes
      // 3. Extract dominant colors:
      //    - Sample background-colors of header, nav, main elements
      //    - Also the page body's computed background-color
      // 4. Extract keywords:
      //    - Grab the first 500 chars of visible text content
      //    - Use document.title
      //    - Look for brand-specific terms (sign in, login, account, etc.)
      return {
        url: window.location.href,
        hasLoginForm: document.querySelectorAll('input[type="password"]').length > 0,
        passwordFieldCount: document.querySelectorAll('input[type="password"]').length,
        logoCandidates: [],
        dominantColors: [],
        pageKeywords: [],
        title: document.title,
      };
    }

    // ── Warning rendering (condition dispatch) ──
    // Renders the active warning condition (banner/modal/tooltip/icon) or the
    // adaptive Progressive Reveal session, and logs every user action.

    let activeRenderer: Renderer | null = null;
    let activeMonitor: ProgressiveRevealHandle | null = null;

    function renderWarning(result: DetectedMessage['result']): void {
      console.log('[phish_ext] Warning triggered:', result);
      if (result.riskScore > 0.5) {
        void showWarning(result);
      }
    }

    async function showWarning(result: DetectedMessage['result']): Promise<void> {
      const condition = await getActiveCondition();
      console.log('[phish_ext] Rendering warning (condition:', condition + ')');
      await logInteraction('shown', result, window.location.href, condition);

      activeRenderer?.destroy();
      activeRenderer = null;
      activeMonitor?.destroy();
      activeMonitor = null;

      // Progressive Reveal is a session (state machine + listeners), not a
      // single renderer.
      if (condition === 'progressive') {
        activeMonitor = startProgressiveReveal(result, condition, window.location.href);
        return;
      }

      activeRenderer = renderers[condition]();
      activeRenderer.show(result, {
        onGoBack: () => {
          activeRenderer?.destroy();
          void logInteraction('went-back', result, window.location.href, condition);
          browser.runtime
            .sendMessage({ type: 'GO_BACK' } satisfies ExtensionMessage)
            .catch(() => {});
        },
        onProceed: () => {
          activeRenderer?.destroy();
          void logInteraction('proceeded', result, window.location.href, condition);
        },
        onDismiss: () => {
          activeRenderer?.destroy();
          void logInteraction('dismissed', result, window.location.href, condition);
        },
      });

      // The Driver.js evidence tour complements banner/icon; modal and tooltip
      // anchor their own elements. Skips the no-op until flags carry selectors
      // (Layer 3).
      if (
        (condition === 'banner' || condition === 'icon') &&
        result.flaggedElements.some((f) => f.selector)
      ) {
        highlightFlaggedElements(result);
      }
    }

    // ── Send DOM features to background on load ──

    const features = extractDOMFeatures();
    browser.runtime.sendMessage<ExtensionMessage>({
      type: 'PAGE_READY',
      url: window.location.href,
      features,
    });

    // ── Listen for detection results from background ──

    browser.runtime.onMessage.addListener((message: ExtensionMessage) => {
      if (message.type === 'DETECTED') {
        renderWarning(message.result);
      }
    });
  },
});
