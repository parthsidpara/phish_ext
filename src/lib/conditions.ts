/**
 * Warning-condition selection.
 *
 * The evaluation study runs a between-subjects comparison of warning designs:
 * each participant's browser is pinned to one condition via
 * `storage.local['phish_condition']` (defaults to 'banner'). Progressive
 * Reveal composes the banner/modal/icon renderers and is itself a selectable
 * condition.
 */

export type WarningCondition = 'banner' | 'modal' | 'tooltip' | 'icon' | 'progressive';

export const WARNING_CONDITIONS: readonly WarningCondition[] = ['banner', 'modal', 'tooltip', 'icon', 'progressive'];

export const WARNING_CONDITION_LABELS: Record<WarningCondition, string> = {
  banner: 'Banner',
  modal: 'Modal',
  tooltip: 'Tooltip',
  icon: 'Passive icon',
  progressive: 'Progressive Reveal',
};

const STORAGE_KEY = 'phish_condition';
const DEFAULT_CONDITION: WarningCondition = 'banner';

export function isWarningCondition(value: unknown): value is WarningCondition {
  return (
    typeof value === 'string' && (WARNING_CONDITIONS as readonly string[]).includes(value)
  );
}

/** Read the active warning condition. Never throws. */
export async function getActiveCondition(): Promise<WarningCondition> {
  try {
    const stored = await browser.storage.local.get(STORAGE_KEY);
    return isWarningCondition(stored[STORAGE_KEY]) ? stored[STORAGE_KEY] : DEFAULT_CONDITION;
  } catch {
    return DEFAULT_CONDITION;
  }
}

/** Persist the active warning condition (used by the popup / study setup). */
export async function setActiveCondition(condition: WarningCondition): Promise<void> {
  await browser.storage.local.set({ [STORAGE_KEY]: condition });
}
