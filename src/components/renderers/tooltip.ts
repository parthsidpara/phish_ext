import type { DetectionResult } from '@/lib/types';
import { actionButtons, element } from './shared';
import type { Renderer } from './types';

/** Bubble anchored to the credential field. Falls back to any input, then top-center. */

function findAnchor(): HTMLElement | null {
  const password = document.querySelector<HTMLInputElement>('input[type="password"]');
  if (password) return password;
  const anyInput = document.querySelector<HTMLInputElement>('input:not([type="hidden"])');
  if (anyInput) return anyInput;
  return null;
}

export function tooltipRenderer(): Renderer {
  let root: HTMLElement | null = null;
  let anchor: HTMLElement | null = null;
  let reposition: (() => void) | null = null;

  return {
    show(result: DetectionResult, actions) {
      anchor = findAnchor();
      const { goBack, proceed } = actionButtons(actions, 'red');
      root = element(
        'div',
        'position:fixed;z-index:2147483647;max-width:320px;background:#b3261e;color:#fff;border-radius:8px;padding:12px 14px;box-shadow:0 4px 16px rgba(0,0,0,0.35);font:13px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;',
        element('div', 'font-weight:700;margin-bottom:6px;', 'Suspicious page detected'),
        element('div', result.reasoning),
        element('div', 'display:flex;gap:8px;margin-top:10px;justify-content:flex-end;', goBack, proceed),
      );
      document.body?.append(root);

      reposition = () => {
        if (!root || !anchor) return;
        const rect = anchor.getBoundingClientRect();
        const tw = root.offsetWidth;
        const th = root.offsetHeight;
        let left = rect.left + rect.width / 2 - tw / 2;
        left = Math.max(8, Math.min(window.innerWidth - tw - 8, left));
        let top = rect.top - th - 8;
        if (top < 8) top = rect.bottom + 8;
        root.style.left = `${left}px`;
        root.style.top = `${top}px`;
      };
      reposition();
      window.addEventListener('scroll', reposition, true);
      window.addEventListener('resize', reposition);
    },
    destroy() {
      if (reposition) {
        window.removeEventListener('scroll', reposition, true);
        window.removeEventListener('resize', reposition);
        reposition = null;
      }
      root?.remove();
      root = null;
      anchor = null;
    },
  };
}