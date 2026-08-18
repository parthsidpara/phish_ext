import type { DetectionResult } from '@/lib/types';
import { actionButtons, element } from './shared';
import type { Renderer } from './types';

/** Passive: a small corner indicator. No overlay, no interruption — clicking
 *  the badge expands a card with the reasoning + actions. */
export function iconRenderer(): Renderer {
  let root: HTMLElement | null = null;
  let card: HTMLElement | null = null;

  return {
    show(result: DetectionResult, actions) {
      const badge = element(
        'button',
        'width:44px;height:44px;border-radius:50%;border:none;background:#b3261e;color:#fff;font-size:20px;font-weight:700;cursor:pointer;box-shadow:0 2px 10px rgba(0,0,0,0.4);display:flex;align-items:center;justify-content:center;',
        '⚠',
      );
      badge.title = 'Suspicious page detected — click for details';
      badge.addEventListener('click', () => {
        if (!card) return;
        card.style.display = card.style.display === 'none' ? 'block' : 'none';
      });

      const { goBack, proceed, dismiss } = actionButtons(actions, 'card');
      card = element(
        'div',
        'position:fixed;bottom:70px;right:16px;z-index:2147483647;width:300px;display:none;background:#fff;color:#1c1c1c;border-radius:10px;padding:14px;box-shadow:0 6px 24px rgba(0,0,0,0.35);font:13px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;',
        element('div', 'font-weight:700;margin-bottom:8px;color:#b3261e;', 'Suspicious page detected'),
        element('div', result.reasoning),
        element('div', 'display:flex;gap:8px;margin-top:12px;justify-content:flex-end;', goBack, proceed, dismiss),
      );

      root = element('div', 'position:fixed;bottom:16px;right:16px;z-index:2147483647;', badge, card);
      document.body?.append(root);
    },
    destroy() {
      root?.remove();
      root = null;
      card = null;
    },
  };
}