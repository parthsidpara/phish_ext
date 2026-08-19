import type { WarningCondition } from '@/lib/conditions';
import { bannerRenderer } from './banner';
import { iconRenderer } from './icon';
import { modalRenderer } from './modal';
import { tooltipRenderer } from './tooltip';
import type { Renderer, RendererFactory } from './types';

/** Renderer factories for the static conditions (Progressive Reveal is handled
 *  separately by `utils/behavior-monitor`). */
export const renderers: Record<Exclude<WarningCondition, 'progressive'>, RendererFactory> = {
  banner: bannerRenderer,
  modal: modalRenderer,
  tooltip: tooltipRenderer,
  icon: iconRenderer,
};

export type { Renderer, RendererFactory, WarningActions } from './types';