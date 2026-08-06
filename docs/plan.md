# phish_ext — Browser extension that detects brand-impersonation phishing pages

A Chromium browser extension (Manifest V3) that detects fake login pages impersonating known brands, explains *why* it thinks a page is fake, and tests different warning designs to see which makes users stop before entering credentials.

Everything runs **inside the browser**. There is no backend server, no remote inference, and no network calls during detection. All reference data is generated once at build time and bundled into the extension.

---

## Problem

Fake login pages that copy the look of real websites (banks, email, social media) trick users into entering their passwords. Two things are usually weak:

1. **Detection** — well-made clones often slip past simple checks.
2. **Warnings** — a generic "this site might be dangerous" banner is easy to ignore.

## What We're Building

A browser extension that:

- Scans the page you're on and checks it against known real websites using a three-layer detection pipeline (below).
- If it looks like a fake, shows a warning that explains *why* — highlighting the specific elements that gave it away.
- Tests **five** warning designs against each other to find which one actually makes people stop and think — including one that *progressively reveals more evidence* the longer the user seems to be ignoring it, adapting in real time to their behavior (see Progressive Reveal below). This is the project's core research contribution, not a side feature.

## Detection Pipeline

The detector combines three independent checks. Each catches cases the others miss, and the combination produces an explainable verdict rather than a bare yes/no.

### Layer 1 — Visual similarity (perceptual hashing)

On page load, capture the visible page and generate a perceptual hash (pHash, DCT-based). Compare against a pre-built reference set of ~15 real brand login pages. A close hash match means "this looks like Brand X."

- Catches attacker pages copied pixel-for-pixel.
- Fast (<50 ms) and cheap.
- Reference hashes are generated at build time and bundled as static data.

### Layer 2 — Domain legitimacy check

If the visual match says "this looks like Brand X" but the actual domain is not on Brand X's known-domains allowlist, that is the core phishing signal.

- Also runs a homoglyph/lookalike check on the domain itself (Levenshtein distance + character substitution, e.g. `paypa1.com` vs `paypal.com`) to catch typosquatting even when visual similarity is imperfect.

### Layer 3 — Element-level localization

Determine *which* elements triggered the match so the warning can point at them:

- **DOM inspection** — read the actual page: presence and layout of login forms, logo `<img>` source vs. bundled brand logo templates, dominant color scheme, brand keywords in text.
- **Logo template matching** — canvas-based match of detected logo regions against bundled brand logo images.
- DOM inspection beats image-based analysis on screenshots because the actual elements are readable, which is what makes the result precise and explainable.

Pipeline output — not just a yes/no:

```json
{
  "riskScore": 0.0–1.0,
  "matchedBrand": "paypal" | null,
  "flaggedElements": ["logo", "form-field", "domain"],
  "reasoning": "This page's logo and layout match PayPal, but the domain paypa1.com is not an official PayPal domain."
}
```

### Why three layers

- Perceptual hashing alone is fast but coarse (misses partial clones).
- Domain checking alone misses pages hosted on compromised-but-otherwise-legitimate domains.
- Element localization alone is expensive and lacks the brand context of the other two.

Combined, they cover more cases than any single method and give the warning stage concrete evidence to point to.

## Standalone Architecture (No Backend)

The Python tools are **development-only** and never ship with the extension.

### Build time (Python, dev only)

A dataset-generation script captures the ~15 brand login pages and precomputes:

- pHash of each brand login page (using `imagehash`).
- Logo templates (cropped, downscaled, encoded as base64).
- Brand color palettes.
- Domain allowlists and lookalike/homoglyph rules.

Output: `assets/brands/brands.json` — a few MB total, bundled into the extension. No runtime dependency on Python, OpenCV, or any server.

### Runtime (100% in-extension)

- **Background service worker** — orchestrates the pipeline. On navigation to an `http(s)` page, captures a screenshot via `tabs.captureVisibleTab` and runs the domain check (pure JS).
- **Offscreen document** — canvas-based image processing: resize/grayscale, DCT pHash, and logo template matching. (WXT supports an `offscreen.html` entrypoint.)
- **Content script** — extracts DOM features (login form, logo, colors, keywords), monitors user behavior once a warning is shown, and renders warnings with highlighted elements.
- **Packaged dataset** — `assets/brands/brands.json` loaded by the workers.

### Permissions (Manifest V3)

- `<all_urls>` host permission — required for automatic screenshot capture on any page. Install-time notice explains why a security extension needs it.
- `storage` — for scan history and warning-logging.
- `tabs` — detect tab navigation events and capture screenshots.
- `offscreen` — create offscreen document for canvas-based image processing.
- `webNavigation` — detect page navigation events.

## Warning Layer

Uses the pipeline output (`flaggedElements` + `reasoning`) to render warnings that point at the actual suspicious parts of the page.

### The five warning conditions

Four static formats plus one adaptive format, evaluated against each other:

| # | Condition | Behavior |
|---|---|---|
| 1 | **Banner** | Dismissible strip at the top of the page, non-blocking. |
| 2 | **Modal** | Full-screen interceptor, forces an explicit choice before proceeding. |
| 3 | **Passive Icon** | Small toolbar/badge icon change only, no interruption to the page. |
| 4 | **Contextual Tooltip** | Warning anchored directly to the password input field. |
| 5 | **Progressive Reveal** | *Adaptive.* Starts with minimal evidence, reveals more of the "why this is fake" reasoning step by step based on measured hesitation; UI container escalates alongside. |

### Progressive Reveal — how it works

This is the condition that differentiates the project from prior explainable-warning work (e.g. PhishXplain), which reveals its full reasoning at once regardless of whether the user is actually paying attention. Progressive Reveal's primary axis is **evidence depth**, not just interruption intensity — it starts with minimal explanation and reveals more of the "why this is fake" reasoning step by step, only escalating further if the user keeps showing signs of ignoring what's already been shown. The UI container (icon → highlight → banner → modal) escalates alongside the evidence as a secondary, coupled effect, but the evidence-depth progression is the core mechanism.

**Signals tracked** (once a page is flagged and the initial minimal signal is showing):
- Dwell time since the warning first appeared.
- Mouse movement toward or away from the credential input field.
- Repeated focus/typing attempts on the password field while a warning is still active.

**Escalation stages** — each stage reveals one additional piece of evidence, paired with a UI container appropriate to that amount of information:

```
Stage 1 — Minimal signal, no evidence yet
  Icon changes only. The system is still "watching" to see if the
  user notices and backs away on their own.

Stage 2 — First piece of evidence
  Highlight stage: outline the single most obvious flagged element
  (e.g. the mismatched logo), with one short reason.
  e.g. "This page's logo doesn't quite match PayPal's."

Stage 3 — Additional evidence
  Banner stage: add a second piece of reasoning alongside the first.
  e.g. "...and you're not on PayPal's actual domain
  (paypa1-secure.com instead of paypal.com)."

Stage 4 — Full evidence, hard stop
  Modal stage: reveal the complete reasoning (all flagged elements)
  and force an explicit decision before the user can proceed.
```

A user who notices and backs away at Stage 1 or 2 never sees the fuller evidence or the more intrusive container — they were never confused enough to need it. A user who keeps heading toward the password field gets progressively more explanation *and* a progressively harder-to-ignore container, in lockstep.

**Implementation:** a dedicated `behavior-monitor.ts` utility (see Project Structure below) owns the hesitation-tracking and the state machine, and calls into the same four static warning renderers to display each stage's container, parameterized by how much of the `flaggedElements`/`reasoning` payload to reveal at that stage. Progressive Reveal *composes* the other four conditions and the detection pipeline's evidence data rather than duplicating either.

**Logging:** identical to the other four conditions (`shown` / `dismissed` / `proceeded` / `went-back`), plus the specific stage reached (i.e. how much evidence the user had been shown) at the time of the final action. This is the data point that lets the evaluation study ask not just "did the warning work" but "how much explanation did it actually take before the user reacted."

## Project Structure

```
phish_ext/
  src/
    entrypoints/            # WXT entrypoints
      background.ts         # pipeline orchestrator + domain check
      content.ts             # DOM extraction + warning UI + behavior monitoring hookup
      offscreen/             # canvas pHash + logo matching
      popup/                 # status/settings UI
    lib/                     # shared types & interfaces
    utils/
      phash.ts               # Layer 1 — perceptual hashing
      domain-check.ts         # Layer 2 — homoglyph + allowlist checks
      brands.ts               # reference dataset loader
      messaging.ts             # shared message types
      behavior-monitor.ts      # Progressive Reveal — dwell/mouse tracking + escalation state machine
    assets/brands/            # bundled reference dataset (generated)
    components/               # warning renderers: banner, modal, tooltip, icon (reused by Progressive Reveal)
  tools/                      # dev-only Python dataset generator (not shipped)
  public/                     # extension icons and static assets
  docs/                       # architecture & development docs
  wxt.config.ts
```

## Stretch Goal

CLIP-style embedding comparison (via `onnxruntime-web`, fully local) for recognizing logo/page variants that template matching misses. Deferred because of bundle size (~30–150 MB model) and CPU latency. Layer 3 will expose a clean `logoMatcher` interface so CLIP can be swapped in later without rearchitecting.

## Build Sequence

1. [done] Initialize WXT project (Vanilla TS + pnpm + `src/` layout).
2. [done] Scaffold entrypoints: `background`, `content`, `offscreen`, `popup`.
3. Implement the three-layer detection pipeline in TypeScript (pHash, domain check, DOM localization).
4. Write the build-time Python dataset generator in `tools/`.
5. Build the four static warning renderers (banner, modal, tooltip, icon) with element highlighting.
6. **Build `behavior-monitor.ts` and wire up Progressive Reveal** — implement hesitation tracking and the icon → highlight → banner → modal escalation state machine, reusing the renderers from step 5. Do this in the same phase as step 5, not as a later add-on.
7. Add interaction logging across all five conditions (shown / dismissed / proceeded / went-back, plus escalation stage for Progressive Reveal).
8. Evaluation study: recruit participants, run the between-subjects comparison across all five warning conditions.