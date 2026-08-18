import './style.css';

const statusDot = document.querySelector<HTMLSpanElement>('#status-dot')!;
const statusLabel = document.querySelector<HTMLSpanElement>('#status-label')!;
const scanCount = document.querySelector<HTMLSpanElement>('#scan-count')!;
const threatCount = document.querySelector<HTMLSpanElement>('#threat-count')!;
const conditionSelect = document.querySelector<HTMLSelectElement>('#condition-select')!;

import {
  WARNING_CONDITIONS,
  WARNING_CONDITION_LABELS,
  getActiveCondition,
  setActiveCondition,
} from '@/lib/conditions';
import type { ExtensionMessage } from '@/lib/types';

// ── Condition selector ──

for (const condition of WARNING_CONDITIONS) {
  const option = document.createElement('option');
  option.value = condition;
  option.textContent = WARNING_CONDITION_LABELS[condition];
  conditionSelect.append(option);
}

conditionSelect.addEventListener('change', () => {
  const value = conditionSelect.value;
  if (WARNING_CONDITIONS.includes(value as (typeof WARNING_CONDITIONS)[number])) {
    void setActiveCondition(value as (typeof WARNING_CONDITIONS)[number]);
    // Re-run the pipeline so the new condition takes effect on the current tab
    // immediately instead of on the next navigation.
    browser.runtime.sendMessage({ type: 'RESCAN' } satisfies ExtensionMessage).catch(() => {});
  }
});

// ── Stats from the interaction log ──

function summarize(events: Array<{ riskScore?: number; url?: string }>): { scans: number; threats: number } {
  const threats = new Set<string>();
  for (const e of events) {
    if (typeof e.riskScore === 'number' && e.riskScore > 0.5 && typeof e.url === 'string') {
      threats.add(e.url);
    }
  }
  return { scans: events.length, threats: threats.size };
}

async function refreshStats(): Promise<void> {
  try {
    const stored = await browser.storage.local.get('phish_interactions');
    const events = Array.isArray(stored.phish_interactions) ? stored.phish_interactions : [];
    const { scans, threats } = summarize(events);

    scanCount.textContent = String(scans);
    threatCount.textContent = String(threats);

    if (threats > 0) {
      statusDot.className = 'status-threat';
      statusLabel.textContent = 'Threats flagged';
    } else if (scans > 0) {
      statusDot.className = 'status-safe';
      statusLabel.textContent = 'No threats';
    } else {
      statusDot.className = 'status-idle';
      statusLabel.textContent = 'Idle';
    }
  } catch {
    statusDot.className = 'status-idle';
    statusLabel.textContent = 'Idle';
  }
}

async function init(): Promise<void> {
  const condition = await getActiveCondition();
  conditionSelect.value = condition;
  await refreshStats();
}

void init();