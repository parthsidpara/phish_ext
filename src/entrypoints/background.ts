import type { DetectionResult, BrandReference, ExtensionMessage } from '@/lib/types';

export default defineBackground(() => {
  console.log('[phish_ext] Background service worker started');

  // ── Brand dataset loader ──
  // Loaded from bundled assets/brands/brands.json at startup.

  async function loadBrandDataset(): Promise<BrandReference[]> {
    // TODO: Fetch /assets/brands/brands.json, parse as BrandReference[], cache
    console.log('[phish_ext] Brand dataset loader not yet implemented');
    return [];
  }

  // ── Layer 2: Domain legitimacy check (runs in background) ──

  function checkDomainLegitimacy(url: string, brand: BrandReference): { isSuspicious: boolean; reason?: string } {
    // TODO: Implement domain allowlist + homoglyph/Levenshtein checks
    // 1. Parse the hostname from the URL
    // 2. Check if the hostname matches any entry in brand.allowedDomains
    //    - If yes → legitimate, return { isSuspicious: false }
    // 3. Run homoglyph substitution check (e.g. paypa1.com → paypal.com)
    //    - Map: 0→o, 1→l, ä→a, etc. — check if transformed domain matches an allowedDomain
    // 4. Run Levenshtein distance check against allowedDomains
    //    - If distance <= 2 and domain not in allowed list → typosquatting
    // 5. If any check triggers → return { isSuspicious: true, reason: "..." }
    console.log('[phish_ext] Domain check for:', url, 'against brand:', brand.id);
    return { isSuspicious: false };
  }

  // ── Layer 1 plumbing: capture screenshot, hand to offscreen for pHash ──

  async function captureAndHash(tabId: number): Promise<string | null> {
    // TODO: Implement screenshot capture → offscreen document pHash computation
    // 1. Ensure offscreen document is created: chrome.offscreen.createDocument(...)
    // 2. Capture visible tab: browser.tabs.captureVisibleTab(tabId, { format: 'png' })
    // 3. Send COMPUTE_PHASH message to offscreen document
    // 4. Wait for PHASH_RESULT response
    // 5. Close offscreen document when done (optional, to save memory)
    console.log('[phish_ext] Screenshot capture for tab:', tabId);
    return null;
  }

  // ── Pipeline orchestrator: runs when a page finishes loading ──

  async function runPipeline(tabId: number, url: string): Promise<DetectionResult> {
    // TODO: Full pipeline coordination
    // 1. Load brand dataset (cached after first load)
    // 2. Layer 1: Capture screenshot → compute pHash → compare against each brand reference
    //    - If no brand within threshold → return { riskScore: 0, ... }
    // 3. Layer 2: For matched brand(s), run checkDomainLegitimacy()
    //    - Domain on allowlist? → safe. Otherwise → suspicious.
    // 4. Layer 3: Request content script to extract DOM features (PageReadyMessage)
    //    - Match logo candidates, form layout, color scheme, keywords against brand refs
    // 5. Aggregate → compute riskScore, build flaggedElements, generate reasoning
    // 6. Send DETECTED message to content script → triggers warning UI
    console.log('[phish_ext] Running pipeline for:', url);
    return {
      riskScore: 0,
      matchedBrand: null,
      flaggedElements: [],
      reasoning: 'Pipeline not yet implemented',
    };
  }

  // ── Listen for completed page navigation ──

  browser.webNavigation?.onCompleted.addListener(
    (details) => {
      if (details.frameId !== 0) return; // Only main frame
      if (!details.url?.startsWith('http')) return;
      console.log('[phish_ext] Page loaded:', details.url);
      runPipeline(details.tabId, details.url);
    },
    { url: [{ schemes: ['http', 'https'] }] },
  );

  // ── Demo trigger: keyboard shortcut → highlight current page ──
  // Ctrl+Shift+H (see wxt.config.ts `commands`) runs the Driver.js highlight
  // demo against whatever page is active (e.g. the local demo.html portal).

  browser.commands?.onCommand.addListener(async (command) => {
    if (command !== 'run-highlight-demo') return;

    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;

    await browser.tabs.sendMessage(tab.id, { type: 'DEMO_HIGHLIGHT' } satisfies ExtensionMessage);
  });

  // ── Listen for messages from content script / offscreen ──

  browser.runtime.onMessage.addListener((message: ExtensionMessage) => {
    if (message.type === 'PAGE_READY') {
      console.log('[phish_ext] Content script ready:', message.url);
      // TODO: Use the DOM features from the content script in layer 3
    }
  });
});
