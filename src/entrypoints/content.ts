import type { DOMFeatures, DetectedMessage, ExtensionMessage } from '@/lib/types';
import { demoHighlight, highlightFlaggedElements } from '@/utils/driver-highlight';

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

    // ── Warning overlay renderer ──

    function renderWarning(result: DetectedMessage['result']): void {
      // TODO: Render the warning UI based on DetectionResult
      // 1. Create an overlay/banner element
      // 2. Display the reasoning text prominently
      // 3. For each flaggedElement with a selector, highlight that element
      //    (e.g. add a red border, or dim the rest of the page)
      // 4. Provide action buttons: "Go Back", "Proceed Anyway", "Report as Safe"
      // 5. Log the interaction (shown → dismissed/proceeded/went-back)
      //    → store in browser.storage.local for later analysis
      // 6. Different warning variants to test:
      //    - Full-page interceptor banner
      //    - Modal dialog
      //    - Tooltip near the password field
      //    - Small icon in the corner
      //
      // Driver.js approach: spotlight every flagged element and annotate why it
      // was flagged, driven off the same `flaggedElements` + `reasoning` payload.
      console.log('[phish_ext] Warning triggered:', result);
      highlightFlaggedElements(result);
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
      // Demo trigger — lets us test Driver.js highlighting on the local
      // `demo.html` target site before the detection pipeline is built.
      if (message.type === 'DEMO_HIGHLIGHT') {
        console.log('[phish_ext] Running Driver.js highlight demo');
        demoHighlight();
      }
    });
  },
});
