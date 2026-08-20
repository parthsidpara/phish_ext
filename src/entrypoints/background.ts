import type { DetectionResult, BrandReference, DOMFeatures, ExtensionMessage, FlaggedElement } from '@/lib/types';
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

      // captureVisibleTab grabs whatever tab is active in the window *at the
      // moment of the call*, not the tab we were asked about. If the user
      // switched tabs while we waited for the page to settle, capturing now
      // would either hash the wrong page or fail outright (a restricted page
      // like chrome:// reports the permission as not in effect). Skip Layer 1
      // instead -- the text layer still identifies the brand without it.
      if (!tab.active) {
        console.debug('[phish_ext] Tab not foreground at capture time, skipping Layer 1:', tabId);
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

  /**
   * How long to let a page settle after `onCompleted` before screenshotting.
   *
   * The reference hashes in brands.json are taken by tools/generate.py *after*
   * a settle step (network-idle + DOM-stability polling). Capturing the live
   * page the instant navigation completes can catch it mid-render — images not
   * yet painted, fonts still swapping — which produces a hash that will not
   * match a reference taken of the same page fully rendered.
   */
  const CAPTURE_SETTLE_MS = 1200;

  const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  // ── Layer 3 (text): DOM features pulled from the content script ──

  /**
   * Ask the content script for the page's DOM features. Pulled on demand
   * rather than read from the PAGE_READY push, which races the navigation
   * event. Returns null if the content script isn't reachable (e.g. a
   * restricted page) — the pipeline then degrades to Layer 1 only.
   */
  async function fetchDOMFeatures(tabId: number): Promise<DOMFeatures | null> {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = (await browser.tabs.sendMessage(tabId, {
          type: 'GET_FEATURES',
        } satisfies ExtensionMessage)) as { type?: string; features?: DOMFeatures };
        if (res?.type === 'FEATURES_RESULT' && res.features) return res.features;
      } catch {
        // Content script not injected yet — retry once.
      }
      await delay(300);
    }
    return null;
  }

  /**
   * Identify which brand a page is presenting itself as, from its title and
   * content words alone.
   *
   * This is the viewport-independent counterpart to Layer 1: a screenshot hash
   * only matches when the window size is close to a captured reference, but
   * page *text* is the same at any window size. Keywords come from the same
   * extraction algorithm the dataset generator uses, so they're comparable to
   * `BrandReference.keywords`.
   *
   * Requires a credential field: a page merely mentioning a brand isn't
   * impersonation, but a login form claiming to be that brand is exactly the
   * threat model — and requiring it keeps false positives down.
   */
  function identifyBrandByText(
    features: DOMFeatures,
    brands: BrandReference[],
  ): { brand: BrandReference; matchedKeywords: string[] } | null {
    if (!features.hasLoginForm) return null;

    const pageWords = new Set<string>([
      ...features.pageKeywords.map((k) => k.toLowerCase()),
      ...(features.title.toLowerCase().match(/[a-z]{3,}/g) ?? []),
    ]);

    let best: { brand: BrandReference; matchedKeywords: string[] } | null = null;
    for (const brand of brands) {
      // Tokens that identify the brand by name, e.g. "vtop", or
      // ["idfc","first","bank"] for a multi-word name.
      const nameTokens = [...new Set(
        brand.name.toLowerCase().split(/\s+/).map((t) => t.replace(/[^a-z]/g, '')).filter((t) => t.length >= 3),
      )];
      const idToken = brand.id.toLowerCase();

      // Either the brand id itself appears, or at least two words of a
      // multi-word brand name do — one generic word like "bank" isn't enough.
      const hits = nameTokens.filter((t) => pageWords.has(t));
      if (!pageWords.has(idToken) && hits.length < 2) continue;

      const matchedKeywords = brand.keywords.filter((k) => pageWords.has(k.toLowerCase()));
      if (!best || matchedKeywords.length > best.matchedKeywords.length) {
        best = { brand, matchedKeywords };
      }
    }
    return best;
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

    // Layer 1 (visual): screenshot -> pHash -> nearest brand within threshold.
    // Viewport-dependent: only matches when the window is close in size to one
    // of the captured references.
    const hash = await captureAndHash(tabId);
    const visual = hash ? findVisualBrandMatch(hash, brands) : null;

    // Layer 3 (text): identify the brand from page text. Deliberately runs
    // independently of Layer 1 -- a viewport mismatch or a failed screenshot
    // must not blind the whole pipeline, which is what happens if the visual
    // match is treated as a gate.
    const features = await fetchDOMFeatures(tabId);
    const textual = features ? identifyBrandByText(features, brands) : null;

    const matchedBrand = visual?.brand ?? textual?.brand ?? null;

    if (!matchedBrand) {
      if (hash) {
        // Unmatched hash - log it so it can be seeded as a brand reference
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

    const signals = [
      visual ? `visual (hamming ${visual.distance})` : null,
      textual ? `text (${textual.matchedKeywords.length} keywords)` : null,
    ].filter(Boolean).join(' + ');
    console.log(`[phish_ext] Brand "${matchedBrand.id}" identified by: ${signals}`);

    // Layer 2 (domain): is this host legitimate for the identified brand?
    const domain = checkDomainLegitimacy(url, matchedBrand);

    const flaggedElements: FlaggedElement[] = [];
    if (domain.isSuspicious) {
      flaggedElements.push({
        element: 'domain',
        reason: domain.flagReason ?? 'domain_mismatch',
        title: domain.flagReason === 'typosquatting' ? 'Domain is a lookalike' : 'Unofficial domain',
        note: domain.reason,
      });
      if (visual) {
        flaggedElements.push({
          element: 'page layout',
          reason: 'visual_similarity',
          title: `Layout copies ${matchedBrand.name}`,
          note:
            `The page's layout is a close perceptual match for ${matchedBrand.name}'s real ` +
            `page (${visual.distance} bits different out of 64).`,
        });
      }
      if (textual?.matchedKeywords.length) {
        flaggedElements.push({
          element: 'page text',
          reason: 'brand_keywords',
          title: `Text reuses ${matchedBrand.name} wording`,
          note:
            `Wording from ${matchedBrand.name}'s real page appears here: ` +
            `${textual.matchedKeywords.slice(0, 6).join(', ')}.`,
        });
      }
    }

    // Two independent signals agreeing is stronger than either alone. Text
    // alone is weakest (no visual confirmation) but still worth warning about.
    let riskScore = 0.05;
    if (domain.isSuspicious) {
      if (visual && textual) riskScore = 0.9;
      else if (visual) riskScore = 0.85;
      else riskScore = 0.7;
    }

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

    // Hand the verdict to the content script -> warning UI.
    browser.tabs
      .sendMessage(tabId, { type: 'DETECTED', result } satisfies ExtensionMessage)
      .catch(() => {
        // No receiver (e.g. tabs where the content script isn't present) - ignore.
      });

    return result;
  }

  // ── Listen for completed page navigation ──

  browser.webNavigation?.onCompleted.addListener(
    (details) => {
      if (details.frameId !== 0) return; // Only main frame
      if (!details.url?.startsWith('http')) return;
      console.log('[phish_ext] Page loaded:', details.url);
      delay(CAPTURE_SETTLE_MS)
        .then(() => runPipeline(details.tabId, details.url))
        .catch((err) => {
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
