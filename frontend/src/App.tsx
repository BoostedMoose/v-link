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


import Carplay from './carplay/Carplay';
import Cardata from './cardata/Cardata';

import './App.css';
import './theme/fonts.module.css';

const AppContainer = styled.div`
  position: absolute;
  overflow: hidden;
  width: 100%;
  height: 100%;
  background: linear-gradient(180deg, #0D0D0D, #1C1C1C);
`;

function App() {
  // Subscribe to store slices
  const systemSettings = APP((state) => state.system);
  const appUpdate = APP((state) => state.update);
  const setKeyStroke = APP((state) => state.setKeyStroke);
  const dongleBindings = APP((state) => state.settings.dongle_bindings) as Record<string, { value: string }> | undefined;

  const keyStroke = APP((state) => state.keyStroke);
  const switchPage = APP((state) => state.switchPage);
  const pauseKeyBinds = APP((state) => state.pauseKeyBinds);

  const socket = useNamespaces();

  const textSizeValue = APP((state) => ((state.settings.general as Record<string, { value: string }> | undefined)?.textSize?.value) ?? 'Default');
  const textScaleMap: Record<string, number> = { Small: 0.85, Default: 1, Large: 1.2 };
  const scaledTheme = useMemo(() => {
    const scale = textScaleMap[textSizeValue] ?? 1;
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

  useEffect(() => {
    document.addEventListener('keydown', mmiKeyDown);
    return () => {
      document.removeEventListener('keydown', mmiKeyDown);
    };
  }, [systemSettings.view, systemSettings.switch, pauseKeyBinds]);

const mmiKeyDown = (event: KeyboardEvent) => {
  // Store last Keystroke in store to broadcast it
  setKeyStroke(event.code);

  // If keybinds are paused, do not process further
  
  if(pauseKeyBinds) return;

  // Only process Carplay key commands when in Carplay view
  if (systemSettings.view !== 'Carplay') return;

  // If user is not switching the page, send control to CarPlay
  if (systemSettings.switch && event.code !== systemSettings.switch) {
    if (dongleBindings) {
      // Find the action whose .value matches the key event
      const action = Object.keys(dongleBindings).find(
        (key) => dongleBindings[key].value === event.code
      );
      socket.log.emit('debug', 'Emitting carplay key-command: ', action);

      if (action !== undefined) {
          setKeyCommand(action);
          setCommandCounter((c) => c + 1);

        if (action === "selectDown") {
          setTimeout(() => {
            setKeyCommand("selectUp");
            setCommandCounter((c) => c + 1);
          }, 200);
        }
      }
    }
  }
};


  // Dimensions of the container
  const containerRef = useRef(null);
  const [ready, setReady] = useState(false);
  /* Observe container resizing and update dimensions. */
  useEffect(() => {
    const handleResize = () => {
      if (containerRef.current)
        if (containerRef.current && systemSettings.startedUp) {
          const store         = APP.getState() as any;
          const topBarEnabled = store.settings.side_bars.topBar.value as boolean;
          const topBarHeight  = store.settings.side_bars.topBarHeight.value as number;
          const el            = containerRef.current as HTMLDivElement;
          const containerWidth  = el.offsetWidth;
          const containerHeight = el.offsetHeight;
          const carplayHeight   = topBarEnabled ? containerHeight - topBarHeight : containerHeight;

          socket.log.emit('info', `Window size changed: ${containerWidth}x${containerHeight}, CarPlay: ${containerWidth}x${carplayHeight}`)

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
  }, [systemSettings.startedUp, containerRef.current]);

  return (
    <StyleSheetManager shouldForwardProp={isPropValid}>
      <AppContainer ref={containerRef}>
        <Socket />

        <ThemeProvider theme={scaledTheme}>

          <Splash />
          <Init />
          <Modal />

          {systemSettings.startedUp && ready ? (
            <>
              {<Carplay
                commandCounter={commandCounter}
                command={keyCommand}
              />}

              < Cardata />
              <Content />
            </>
          ) : (
            <></>
          )}
        </ThemeProvider>

      </AppContainer>
    </StyleSheetManager>
  );
}

export default App;
