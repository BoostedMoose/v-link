import { useState, useEffect, useRef, useMemo } from 'react';

import { theme } from './theme/Theme';
import styled, { ThemeProvider, StyleSheetManager } from 'styled-components';
import isPropValid from '@emotion/is-prop-valid'; // Import isPropValid

import { APP } from './store/Store';

import { useNamespaces } from './socket/Namespaces';
import { Socket } from './socket/Socket';

import Init from './app/Init';
import Splash from './app/Splash';
import Content from './app/Content';
import { Modal } from './app/components/Modal';
import { LocalMediaProvider } from './app/pages/music/LocalMediaProvider';
import { sendLocalMediaCommand } from './app/pages/music/localMediaCommands';
import { routeHardwareAction } from './mediaActions';
import { isCompactViewport, smallestViewport } from './app/helper/Layout';
import type { ViewportSize } from './app/helper/Layout';
import Carplay from './carplay/Carplay';
import Cardata from './cardata/Cardata';

import './App.css';
import './theme/fonts.module.css';

const AppContainer = styled.div`
  position: fixed;
  top: 0;
  left: 0;
  overflow: hidden;
  width: 100%;
  height: 100%;
  box-sizing: border-box;
  background: linear-gradient(180deg, #0D0D0D, #1C1C1C);
`;

const TEXT_SCALE_MAP: Record<string, number> = {
  Small: 0.85,
  Default: 1,
  Large: 1.2,
};

type SideBarsSettings = {
  topBar?: { value: boolean };
  topBarHeight?: { value: number };
};

const browserViewportSize = (): ViewportSize => smallestViewport(
  { width: window.innerWidth, height: window.innerHeight },
  window.visualViewport
    ? { width: window.visualViewport.width, height: window.visualViewport.height }
    : undefined,
  { width: window.screen.width, height: window.screen.height },
);

function App() {
  // Subscribe to store slices
  const systemSettings = APP((state) => state.system);
  const appUpdate = APP((state) => state.update);
  const setKeyStroke = APP((state) => state.setKeyStroke);
  const dongleBindings = APP((state) => state.settings.dongle_bindings) as Record<string, { value: string }> | undefined;

  const pauseKeyBinds = APP((state) => state.pauseKeyBinds);
  const audioSource = APP((state) => state.system.audioSource);
  const sideBars = APP((state) => state.settings.side_bars as SideBarsSettings | undefined);
  const topBarEnabled = sideBars?.topBar?.value ?? true;
  const topBarHeight = sideBars?.topBarHeight?.value ?? 40;

  const socket = useNamespaces();

  const textSizeValue = APP((state) => ((state.settings.general as Record<string, { value: string }> | undefined)?.textSize?.value) ?? 'Default');
  const scaledTheme = useMemo(() => {
    const scale = TEXT_SCALE_MAP[textSizeValue] ?? 1;
    if (scale === 1) return theme;
    return {
      ...theme,
      typography: Object.fromEntries(
        Object.entries(theme.typography).map(([key, val]) => {
          const match = (val.fontSize as string).match(/^([\d.]+)(.+)$/);
          const scaled = match ? `${(parseFloat(match[1]) * scale).toFixed(2)}${match[2]}` : val.fontSize;
          return [key, { ...val, fontSize: scaled }];
        })
      ) as typeof theme.typography,
    };
  }, [textSizeValue]);

  const [commandCounter, setCommandCounter] = useState(0);
  const [keyCommand, setKeyCommand] = useState('');
  const [viewportSize, setViewportSize] = useState(browserViewportSize);

  useEffect(() => {
    const updateViewportSize = () => setViewportSize(browserViewportSize());
    window.addEventListener('resize', updateViewportSize);
    window.visualViewport?.addEventListener('resize', updateViewportSize);
    return () => {
      window.removeEventListener('resize', updateViewportSize);
      window.visualViewport?.removeEventListener('resize', updateViewportSize);
    };
  }, []);

  useEffect(() => {
    const mmiKeyDown = (event: KeyboardEvent) => {
      // Store last Keystroke in store to broadcast it
      setKeyStroke(event.code);

      // If keybinds are paused, do not process further
      if (pauseKeyBinds) return;

      // If user is not switching the page, send control to CarPlay
      if (!systemSettings.switch || event.code === systemSettings.switch || !dongleBindings) return;

      // Find the action whose .value matches the key event
      const action = Object.keys(dongleBindings).find(
        (key) => dongleBindings[key].value === event.code
      );

      if (action === undefined) return;

      const route = routeHardwareAction(
        action,
        audioSource,
        systemSettings.view === 'Carplay',
      );
      if (!route) return;

      // Media controls follow the active audio source, regardless of which page is
      // visible. Other CarPlay controls remain scoped to the CarPlay page.
      if (route.target === 'local') {
        sendLocalMediaCommand(route.command);
        return;
      }

      socket.log.emit('debug', 'Emitting carplay key-command: ', route.command);
      setKeyCommand(route.command);
      setCommandCounter((c) => c + 1);

      if (route.command === 'selectDown') {
        setTimeout(() => {
          setKeyCommand('selectUp');
          setCommandCounter((c) => c + 1);
        }, 200);
      }
    };

    document.addEventListener('keydown', mmiKeyDown);
    return () => {
      document.removeEventListener('keydown', mmiKeyDown);
    };
  }, [audioSource, dongleBindings, pauseKeyBinds, setKeyStroke, socket.log, systemSettings.switch, systemSettings.view]);


  // Dimensions of the container
  const containerRef = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  /* Observe container resizing and update dimensions. */
  useEffect(() => {
    const handleResize = () => {
      const element = containerRef.current;
      if (element && systemSettings.startedUp) {
        const containerWidth  = element.offsetWidth;
        const containerHeight = element.offsetHeight;
        const compact         = isCompactViewport({ width: containerWidth, height: containerHeight });
        const carplayHeight   = !compact && topBarEnabled
          ? containerHeight - topBarHeight
          : containerHeight;

        const visualWidth = Math.floor(window.visualViewport?.width ?? window.innerWidth);
        const visualHeight = Math.floor(window.visualViewport?.height ?? window.innerHeight);
        socket.log.emit(
          'info',
          `Viewport: app=${containerWidth}x${containerHeight}, layout=${window.innerWidth}x${window.innerHeight}, visual=${visualWidth}x${visualHeight}, screen=${window.screen.width}x${window.screen.height}, dpr=${window.devicePixelRatio}; CarPlay=${containerWidth}x${carplayHeight}`,
        );

        appUpdate((state) => {
          state.system.windowSize.width  = containerWidth;
          state.system.windowSize.height = containerHeight;

          state.system.carplaySize.width  = containerWidth;
          state.system.carplaySize.height = carplayHeight;
        });

        setReady(true);
      }
    };

    const resizeObserver = new ResizeObserver(handleResize);
    if (containerRef.current) resizeObserver.observe(containerRef.current);
    return () => resizeObserver.disconnect();
  }, [appUpdate, socket.log, systemSettings.startedUp, topBarEnabled, topBarHeight]);

  return (
    <StyleSheetManager shouldForwardProp={isPropValid}>
      <AppContainer
        ref={containerRef}
        style={{ width: viewportSize.width, height: viewportSize.height }}
      >
        <Socket />

        <ThemeProvider theme={scaledTheme}>
          <LocalMediaProvider>
            <Splash />
            <Init />
            <Modal />

            {systemSettings.startedUp && ready ? (
              <>
                <Carplay
                  commandCounter={commandCounter}
                  command={keyCommand}
                />

                <Cardata />
                <Content />
              </>
            ) : (
              <></>
            )}
          </LocalMediaProvider>
        </ThemeProvider>

      </AppContainer>
    </StyleSheetManager>
  );
}

export default App;
