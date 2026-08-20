import type { DOMFeatures, DetectedMessage, ExtensionMessage } from '@/lib/types';
import { logInteraction } from '@/utils/interaction-log';
import { clearHighlight, highlightFlaggedElements } from '@/utils/driver-highlight';
import { startProgressiveReveal, type ProgressiveRevealHandle } from '@/utils/behavior-monitor';
import { renderers, type Renderer } from '@/components/renderers';
import { getActiveCondition } from '@/lib/conditions';

export default defineContentScript({
  matches: ['*://*/*'],
  excludeMatches: ['*://localhost/*'],

  main() {
    console.log('[phish_ext] Content script loaded on:', window.location.href);

    // ── DOM feature extraction (Layer 3 data source) ──

    /**
     * Stop words excluded from page keywords. Mirrors the list in
     * tools/generate.py so a page's keywords are drawn from the same
     * vocabulary as the brand keywords stored in brands.json.
     */
    const STOP_WORDS = new Set([
      'the', 'a', 'an', 'and', 'or', 'for', 'to', 'in', 'on', 'of', 'at', 'is', 'are', 'you', 'your',
      'we', 'our', 'this', 'that', 'it', 'with', 'by', 'from', 'as', 'please', 'new', 'get', 'use',
      'using', 'more', 'all', 'menu', 'search', 'login', 'log', 'out', 'sign', 'up', 'not',
      'if', 'have', 'has', 'had', 'been', 'will', 'can', 'may', 'www', 'http', 'https', 'com',
    ]);

    /**
     * Most frequent content words on the page. Same algorithm as
     * `DOM_EXTRACT_JS` in tools/generate.py (title + first 1500 chars of
     * visible text, words of 3+ letters, stop words removed, top 12 by
     * frequency) so these are directly comparable to `BrandReference.keywords`.
     */
    function extractKeywords(): string[] {
      const title = (document.title || '').toLowerCase();
      const body = ((document.body && document.body.innerText) || '').toLowerCase().slice(0, 1500);
      const freq = new Map<string, number>();
      for (const word of `${body} ${title}`.match(/[a-z]{3,}/g) ?? []) {
        if (STOP_WORDS.has(word)) continue;
        freq.set(word, (freq.get(word) ?? 0) + 1);
      }
      return [...freq.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 12)
        .map(([word]) => word);
    }

    function extractDOMFeatures(): DOMFeatures {
      // TODO (Layer 3, remaining): logo candidates and dominant colours.
      //  - Logo: <img>/<svg> whose class/id contains "logo"/"brand"/"header"
      //  - Colours: computed background-colour of header/nav/main/body
      const passwordFields = document.querySelectorAll('input[type="password"]');
      return {
        url: window.location.href,
        hasLoginForm: passwordFields.length > 0,
        passwordFieldCount: passwordFields.length,
        logoCandidates: [],
        dominantColors: [],
        pageKeywords: extractKeywords(),
        title: document.title,
      };
    }

    // ── Warning rendering (condition dispatch) ──
    // Renders the active warning condition (banner/modal/tooltip/icon) or the
    // adaptive Progressive Reveal session, and logs every user action.

    let activeRenderer: Renderer | null = null;
    let activeMonitor: ProgressiveRevealHandle | null = null;

    /** Remove whatever warning UI is on screen: the active renderer, any
     *  Progressive Reveal session, and the Driver.js spotlight (which lives
     *  outside the renderers' own DOM, so it needs clearing separately). */
    function teardownWarning(): void {
      activeRenderer?.destroy();
      activeRenderer = null;
      activeMonitor?.destroy();
      activeMonitor = null;
      clearHighlight();
    }

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

      teardownWarning();

      // Progressive Reveal is a session (state machine + listeners), not a
      // single renderer.
      if (condition === 'progressive') {
        activeMonitor = startProgressiveReveal(result, condition, window.location.href);
        return;
      }

      activeRenderer = renderers[condition]();
      activeRenderer.show(result, {
        onGoBack: () => {
          teardownWarning();
          void logInteraction('went-back', result, window.location.href, condition);
          browser.runtime
            .sendMessage({ type: 'GO_BACK' } satisfies ExtensionMessage)
            .catch(() => {});
        },
        onProceed: () => {
          teardownWarning();
          void logInteraction('proceeded', result, window.location.href, condition);
        },
        onDismiss: () => {
          teardownWarning();
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
      // Background pulls DOM features when it runs the pipeline, rather than
      // relying on the PAGE_READY push (which can race the navigation event).
      if (message.type === 'GET_FEATURES') {
        return Promise.resolve({
          type: 'FEATURES_RESULT',
          features: extractDOMFeatures(),
        } satisfies ExtensionMessage);
      }
    });
  },
});
