import { useEffect, useRef } from 'react';

import { APP } from '@/store/Store';

type MediaNavigation = 'previous' | 'next' | 'confirm' | 'browse' | 'back';
type Bindings = Record<string, { value?: string }> | undefined;

export const useMediaNavigation = (onKey: (action: MediaNavigation) => void) => {
  const keyStroke = APP((state) => state.keyStroke);
  const paused = APP((state) => state.pauseKeyBinds);
  const appBindings = APP((state) => state.settings.app_bindings as Bindings);
  const dongleBindings = APP((state) => state.settings.dongle_bindings as Bindings);
  // A newly opened player/browser must wait for the key that opened it to clear.
  const handledStroke = useRef(Boolean(keyStroke));

  useEffect(() => {
    if (!keyStroke) {
      handledStroke.current = false;
      return;
    }
    if (handledStroke.current) return;
    handledStroke.current = true;
    if (paused) return;

    if (keyStroke === appBindings?.left?.value || keyStroke === (dongleBindings?.left?.value || 'ArrowLeft')) {
      onKey('previous');
    } else if (keyStroke === appBindings?.right?.value || keyStroke === (dongleBindings?.right?.value || 'ArrowRight')) {
      onKey('next');
    } else if (keyStroke === 'Enter' || keyStroke === 'NumpadEnter' || keyStroke === dongleBindings?.selectDown?.value) {
      onKey('confirm');
    } else if (keyStroke === (dongleBindings?.down?.value || 'ArrowDown')) {
      onKey('browse');
    } else if (keyStroke === 'Escape' || keyStroke === (dongleBindings?.back?.value || 'Backspace')) {
      onKey('back');
    }
  }, [appBindings, dongleBindings, keyStroke, onKey, paused]);
};
