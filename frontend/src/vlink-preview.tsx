import React, { useEffect } from 'react';
import ReactDOM from 'react-dom/client';
import isPropValid from '@emotion/is-prop-valid';
import { StyleSheetManager, ThemeProvider } from 'styled-components';

import appSettings from '../../backend/config/app.json';
import Content from '@/app/Content';
import { Modal } from '@/app/components/Modal';
import Carplay from '@/carplay/Carplay';
import { APP } from '@/store/Store';
import { theme } from '@/theme/Theme';
import { LocalMediaProvider } from '@/app/pages/music/LocalMediaProvider';

import '@/App.css';
import '@/theme/fonts.module.css';

APP.setState((state) => ({
  ...state,
  modules: {},
  settings: appSettings,
  system: {
    ...state.system,
    configLoaded: true,
    initialized: true,
    startedUp: true,
    view: 'Dashboard',
    settingPage: 'general',
    windowSize: {
      width: window.innerWidth,
      height: window.innerHeight,
    },
    carplaySize: {
      width: window.innerWidth,
      height: window.innerHeight,
    },
  },
}));

const Preview = () => {
  useEffect(() => {
    const updateSize = () => {
      APP.getState().update((state) => {
        state.system.windowSize.width = window.innerWidth;
        state.system.windowSize.height = window.innerHeight;
        state.system.carplaySize.width = window.innerWidth;
        state.system.carplaySize.height = window.innerHeight;
      });
    };

    window.addEventListener('resize', updateSize);
    return () => window.removeEventListener('resize', updateSize);
  }, []);

  return (
    <StyleSheetManager shouldForwardProp={isPropValid}>
      <ThemeProvider theme={theme}>
        <LocalMediaProvider>
        <main
          style={{
            position: 'fixed',
            inset: 0,
            overflow: 'hidden',
            background: 'linear-gradient(180deg, #0D0D0D, #1C1C1C)',
          }}
        >
          <Carplay command="" commandCounter={0} />
          <Modal />
          <Content />
        </main>
        </LocalMediaProvider>
      </ThemeProvider>
    </StyleSheetManager>
  );
};

ReactDOM.createRoot(document.getElementById('root')!).render(<Preview />);
