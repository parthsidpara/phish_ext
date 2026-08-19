import type { DetectionResult, BrandReference, ExtensionMessage, FlaggedElement } from '@/lib/types';
import { loadBrands } from '@/utils/brands';
import { checkDomainLegitimacy } from '@/utils/domain-check';
import { hammingDistance } from '@/utils/phash';

export default defineBackground(() => {
  console.log('[phish_ext] Background service worker started');

  // ── Brand dataset loader ──
  // Loaded from bundled assets/brands/brands.json at startup. Fetch + caching
  // live in utils/brands (loadBrands) so they're independent of this entrypoint.

  // ── Layer 2: Domain legitimacy check ──
  // Pure string logic lives in utils/domain-check (checkDomainLegitimacy) so it
  // can be unit-tested in isolation; runPipeline below just calls it.

  // ── Layer 1 plumbing: capture screenshot, hand to offscreen for pHash ──

  /**
   * Ensure the offscreen document exists. Created once and reused across scans —
   * it's the only context with canvas access, so it does the pixel decoding and
   * pHash computation (see entrypoints/offscreen/worker.ts).
   */
  async function ensureOffscreenDocument(): Promise<boolean> {
    try {
      if (await browser.offscreen.hasDocument()) return true;
      await browser.offscreen.createDocument({
        url: browser.runtime.getURL('/offscreen.html'),
        reasons: [browser.offscreen.Reason.BLOBS],
        justification:
          'Decode captured screenshots and compute perceptual hashes for phishing detection.',
      });
      return true;
    } catch (err) {
      console.warn('[phish_ext] Failed to create offscreen document:', err);
      return false;
    }
  }

  /**
   * Capture the visible tab and compute its perceptual hash (Layer 1 input).
   * Returns null — never throws — on any failure so the pipeline can degrade
   * to a safe no-match. Offscreen is Chromium-only; Firefox skips Layer 1.
   */
  async function captureAndHash(tabId: number): Promise<string | null> {
    try {
      if (!browser.offscreen) {
        console.warn('[phish_ext] offscreen API unavailable — skipping Layer 1');
        return null;
      }
      if (!(await ensureOffscreenDocument())) return null;

      const tab = await browser.tabs.get(tabId);
      if (tab.windowId == null) {
        console.warn('[phish_ext] Tab has no window to capture:', tabId);
        return null;
      }

      // captureVisibleTab captures the visible tab of a window.
      const imageData = await browser.tabs.captureVisibleTab(tab.windowId, { format: 'png' });

      // The offscreen worker answers COMPUTE_PHASH with PHASH_RESULT directly.
      const message = { type: 'COMPUTE_PHASH', imageData } satisfies ExtensionMessage;
      let response: unknown;
      for (let attempt = 0; ; attempt++) {
        try {
          response = await browser.runtime.sendMessage(message);
          break;
        } catch (err) {
          // The offscreen doc may still be initializing on the first scan —
          // give it a moment and retry once before giving up.
          if (attempt > 0) throw err;
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
      }

      const res = response as { type?: string; hash?: string };
      return res?.type === 'PHASH_RESULT' ? res.hash || null : null;
    } catch (err) {
      console.warn('[phish_ext] Screenshot capture failed for tab:', tabId, err);
      return null;
    }
  }

  // ── Layer 1: nearest-brand comparison for a computed screenshot hash ──

  /** All reference hashes for a brand (primary + any viewport variants). */
  function brandHashes(brand: BrandReference): string[] {
    const hashes = new Set<string>();
    if (brand.phash) hashes.add(brand.phash);
    if (brand.phashByViewport) {
      for (const h of Object.values(brand.phashByViewport)) if (h) hashes.add(h);
    }
    return [...hashes];
  }

  function findVisualBrandMatch(
    hash: string,
    brands: BrandReference[],
  ): { brand: BrandReference; distance: number } | null {
    let best: { brand: BrandReference; distance: number } | null = null;
    for (const brand of brands) {
      for (const refHash of brandHashes(brand)) {
        if (refHash.length !== hash.length) continue; // hammingDistance() would throw
        const distance = hammingDistance(hash, refHash);
        if (distance <= brand.phashThreshold && (!best || distance < best.distance)) {
          best = { brand, distance };
        }
      }
    }
    return best;
  }

  // ── Pipeline orchestrator: runs when a page finishes loading ──

  async function runPipeline(tabId: number, url: string): Promise<DetectionResult> {
    const brands = await loadBrands();

    // 1. Layer 1: visual similarity — screenshot → pHash → nearest brand within
    //    its phashThreshold.
    const hash = await captureAndHash(tabId);
    const match = hash ? findVisualBrandMatch(hash, brands) : null;

    // No visual match → nothing to flag.
    if (!match) {
      if (hash) {
        // Unmatched hash — log it so it can be seeded as a brand reference
        // (see scripts/hash-png.ts).
        console.log('[phish_ext] Page pHash (no brand match):', hash);
      }
      return {
        riskScore: 0,
        matchedBrand: null,
        flaggedElements: [],
        reasoning: 'No match against known brands.',
      };
    }

    const matchedBrand = match.brand;

    // 2. Layer 2: domain legitimacy for the matched brand.
    const domain = checkDomainLegitimacy(url, matchedBrand);

    // 3. Aggregate into an explainable DetectionResult.
    const flaggedElements: FlaggedElement[] = [];
    if (domain.isSuspicious) {
      flaggedElements.push({
        element: 'domain',
        reason: domain.flagReason ?? 'domain_mismatch',
        title: domain.flagReason === 'typosquatting' ? 'Domain is a lookalike' : 'Unofficial domain',
        note: domain.reason,
      });
    }

    const riskScore = domain.isSuspicious ? 0.85 : 0.05;
    const reasoning = domain.isSuspicious
      ? `This page matches ${matchedBrand.name}'s look and branding, but the domain ` +
        `"${domain.hostname}" is not an official ${matchedBrand.name} domain. ${domain.reason}`
      : `The page matches ${matchedBrand.name} and its domain is legitimate.`;

    const result: DetectionResult = {
      riskScore,
      matchedBrand: matchedBrand.id,
      flaggedElements,
      reasoning,
    };

    // 4. Hand the verdict to the content script → warning UI.
    browser.tabs
      .sendMessage(tabId, { type: 'DETECTED', result } satisfies ExtensionMessage)
      .catch(() => {
        // No receiver (e.g. tabs where the content script isn't present) — ignore.
      });

    return result;
  }

  // ── Listen for completed page navigation ──

  browser.webNavigation?.onCompleted.addListener(
    (details) => {
      if (details.frameId !== 0) return; // Only main frame
      if (!details.url?.startsWith('http')) return;
      console.log('[phish_ext] Page loaded:', details.url);
      runPipeline(details.tabId, details.url).catch((err) => {
        console.error('[phish_ext] Pipeline failed for:', details.url, err);
      });
    },
    { url: [{ schemes: ['http', 'https'] }] },
  );

  // ── Manual re-scan: keyboard shortcut → re-run the pipeline on the active tab ──
  // Ctrl+Shift+H (see wxt.config.ts `commands`). The pipeline also auto-runs on
  // navigation; this is just a convenient way to trigger a fresh scan.

  async function rescanActiveTab(): Promise<void> {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;

    try {
      const result = await runPipeline(tab.id, tab.url ?? '');
      console.log('[phish_ext] Manual scan result:', result);
    } catch (err) {
      console.error('[phish_ext] Manual scan failed:', err);
    }
  }

  browser.commands?.onCommand.addListener((command) => {
    if (command !== 'rescan') return;
    void rescanActiveTab();
  });

  // ── Listen for messages from content script / offscreen / popup ──

  browser.runtime.onMessage.addListener((message: ExtensionMessage, sender) => {
    if (message.type === 'PAGE_READY') {
      console.log('[phish_ext] Content script ready:', message.url);
      // TODO: Use the DOM features from the content script in layer 3
    } else if (message.type === 'GO_BACK') {
      // Warning-banner action: send the user back to the previous page.
      if (sender.tab?.id != null) {
        browser.tabs.goBack(sender.tab.id).catch((err) => {
          console.warn('[phish_ext] Could not navigate back:', err);
        });
      }
    } else if (message.type === 'RESCAN') {
      // Popup condition change → re-run the pipeline so the new warning
      // condition takes effect on the current tab without navigating away.
      void rescanActiveTab();
    }
  });
});
