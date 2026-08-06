import './style.css';

document.querySelector('#app')!;

const statusDot = document.querySelector<HTMLSpanElement>('#status-dot')!;
const statusLabel = document.querySelector<HTMLSpanElement>('#status-label')!;
const scanCount = document.querySelector<HTMLSpanElement>('#scan-count')!;
const threatCount = document.querySelector<HTMLSpanElement>('#threat-count')!;

statusDot.className = 'status-idle';
statusLabel.textContent = 'Idle';

// TODO: Load stats from browser.storage.local
// browser.storage.local.get(['scanCount', 'threatCount']).then(({ scanCount: s, threatCount: t }) => {
//   scanCount.textContent = String(s ?? 0);
//   threatCount.textContent = String(t ?? 0);
// });

// TODO: Poll background for current detection state
// - Update statusDot.className and statusLabel.textContent
// - Example: statusDot.className = 'status-threat'; statusLabel.textContent = 'Threat detected';
