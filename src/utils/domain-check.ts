/**
 * Domain legitimacy checks (Layer 2).
 *
 * Runs in the background service worker. Pure string operations, no DOM needed.
 *
 * ## Checks performed
 *
 * 1. **Allowlist check** — is the current domain in the brand's list of known
 *    legitimate domains? If yes, site is considered safe for that brand.
 *
 * 2. **Homoglyph detection** — substitute visually similar characters:
 *    - 0 ↔ o, 1 ↔ l, ɑ ↔ a, í ↔ i, etc.
 *    - Then check if the transformed domain matches an allowed domain.
 *    - If yes, the original domain is a homoglyph attack.
 *
 * 3. **Levenshtein distance** — if the domain is close to an allowed domain
 *    (edit distance ≤ 2), and not on the allowlist itself, it's likely
 *    typosquatting (e.g. "paypa1.com" vs "paypal.com").
 *
 * ## Levenshtein distance
 *
 * The minimum number of single-character edits (insertions, deletions,
 * substitutions) required to change one string into another.
 *
 * Implementation: standard dynamic programming O(n·m).
 */

export {};

/**
 * Compute Levenshtein edit distance between two strings.
 */
export function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const d = new Array<number>(n + 1).fill(0);
  let prev = 0;

  for (let j = 0; j <= n; j++) d[j] = j;

  for (let i = 1; i <= m; i++) {
    prev = d[0]!;
    d[0] = i;
    for (let j = 1; j <= n; j++) {
      const temp = d[j]!;
      d[j] = a[i - 1] === b[j - 1]
        ? prev
        : 1 + Math.min(d[j]!, d[j - 1]!, prev);
      prev = temp;
    }
  }

  return d[n]!;
}

/**
 * Homoglyph character substitution map.
 * Maps visually confusable characters to their ASCII equivalent.
 *
 * TODO: Expand this map with more substitutions.
 * Reference: https://www.unicode.org/Public/security/latest/confusables.txt
 */
const HOMOGLYPH_MAP: Record<string, string> = {
  '0': 'o',
  '1': 'l',
  'ɑ': 'a',
  'а': 'a', // Cyrillic 'а'
  'е': 'e', // Cyrillic 'е'
  'о': 'o', // Cyrillic 'о'
  'р': 'p', // Cyrillic 'р'
  'с': 'c', // Cyrillic 'с'
  'í': 'i',
  'ì': 'i',
  'î': 'i',
  'ï': 'i',
  'ā': 'a',
  'á': 'a',
  'ă': 'a',
};

/**
 * Normalize a domain string by replacing homoglyph characters.
 */
export function normalizeHomoglyphs(domain: string): string {
  return domain
    .toLowerCase()
    .split('')
    .map((ch) => HOMOGLYPH_MAP[ch] ?? ch)
    .join('');
}

/**
 * Check if a candidate domain is likely a lookalike of any of the allowed domains.
 *
 * Returns the matched allowed domain if suspicious, or null if safe.
 */
export function checkDomain(
  currentDomain: string,
  allowedDomains: string[],
  maxLevenshtein: number = 2,
): { matched: string; reason: 'typosquatting' | 'homoglyph' | 'exact' } | null {
  const normalized = normalizeHomoglyphs(currentDomain);

  for (const allowed of allowedDomains) {
    if (currentDomain === allowed) {
      return null; // Exact match → safe
    }
    if (normalized === normalizeHomoglyphs(allowed)) {
      return { matched: allowed, reason: 'homoglyph' };
    }
    if (levenshtein(normalized, normalizeHomoglyphs(allowed)) <= maxLevenshtein) {
      return { matched: allowed, reason: 'typosquatting' };
    }
  }

  return null;
}
