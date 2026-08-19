import type { DetectionResult } from '@/lib/types';

/** Action callbacks wired by the content script (logging + GO_BACK messaging). */
export interface WarningActions {
  onGoBack: () => void;
  onProceed: () => void;
  onDismiss: () => void;
}

/**
 * A warning renderer. `show` mounts the UI for a verdict; `destroy` removes it
 * and cleans up any listeners. One instance per warning.
 */
export interface Renderer {
  show(result: DetectionResult, actions: WarningActions): void;
  destroy(): void;
}

export type RendererFactory = () => Renderer;
