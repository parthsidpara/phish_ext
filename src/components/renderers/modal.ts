import type { DetectionResult } from '@/lib/types';
import { actionButtons, element } from './shared';
import type { Renderer } from './types';

/** Full-screen interceptor: forces an explicit choice before the user proceeds. */
export function modalRenderer(): Renderer {
  let root: HTMLElement | null = null;

  return {
    show(result: DetectionResult, actions) {
      const { goBack, proceed } = actionButtons(actions, 'card');
      const card = element(
        'div',
        'max-width:440px;width:calc(100% - 48px);background:#fff;color:#1c1c1c;border-radius:12px;padding:24px;box-shadow:0 10px 40px rgba(0,0,0,0.45);font:13px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;',
        element('div', 'font-size:16px;font-weight:700;margin-bottom:8px;color:#b3261e;', 'Phishing warning'),
        element('p', 'margin:0 0 16px;', result.reasoning),
        element('div', 'display:flex;gap:8px;justify-content:flex-end;', goBack, proceed),
      );
      root = element(
        'div',
        'position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.6);padding:24px;box-sizing:border-box;',
        card,
      );
      document.body?.append(root);
      document.documentElement.style.overflow = 'hidden';
    },
    destroy() {
      document.documentElement.style.overflow = '';
      root?.remove();
      root = null;
    },
  };
}
