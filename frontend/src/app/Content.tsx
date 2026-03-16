import { useState, useEffect, useRef } from 'react';
import React from 'react';
import styled, { css } from 'styled-components';
import { Fade as FadeBase } from '@/theme/styles/Effects';
const Fade = FadeBase as React.ComponentType<{ className?: string; fadeLength?: number; children?: React.ReactNode }>;

import { APP } from '@/store/Store';

import Dashboard from './pages/dashboard/Dashboard';
import Carplay from './pages/carplay/Carplay';
import Rearcam from './pages/rearcam/Rearcam';
import Settings from './pages/settings/Settings';
import NavBar from '@/app/sidebars/NavBar';
import SideBar from '@/app/sidebars/SideBar';
import TopBar from '@/app/sidebars/TopBar';
import { io } from "socket.io-client";
import { useNamespaces } from '@/socket/Namespaces';

type SideBarsSettings = { topBarHeight: { value: number }; navBarHeight: { value: number } };
type InterfaceSettings = { carplay: boolean; navBar: boolean; content: boolean };
type AppBindings = { switch: { value: string } };

interface MainContainerProps {
  height: number;
  width: number;
  interfaceSettings: InterfaceSettings;
  view: string;
  sidebarSettings: SideBarsSettings;
  contentPadding: number;
}

interface CardProps {
  currentView: string;
  carplayVisible: boolean;
  minHeight: number;
  maxHeight: number;
  collapseLength: number;
  stream: boolean;
}

interface NavBlockerProps {
  sidebarSettings: SideBarsSettings;
  contentPadding: number;
  isActive: boolean;
  collapseLength: number;
  minHeight: number;
  maxHeight: number;
}

const MainContainer = styled.div<MainContainerProps>`
  position: absolute;
  top: 0;
  left: 0;
  z-index: 2;
  height: ${({ height }) => `${height}px`};
  width: ${({ width }) => `${width}px`};

  pointer-events: ${({ interfaceSettings, view }) => (interfaceSettings.carplay && view === 'Carplay' ? 'none' : 'auto')};

  display: flex;
  flex-direction: row;
  align-items: flex-end;
  justify-content: flex-start;

  box-sizing: border-box;
  padding-top: ${({ sidebarSettings }) => `${sidebarSettings.topBarHeight.value}px`};
  padding-left: ${({ contentPadding }) => `${contentPadding}px`};
  padding-right: ${({ contentPadding }) => `${contentPadding}px`};
  padding-bottom: ${({ contentPadding }) => `${contentPadding}px`};
  background: none;
`;

const Card = styled.div<CardProps>`
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: center;
  overflow: hidden;

  animation: ${({ theme, currentView, carplayVisible, minHeight, maxHeight, collapseLength, stream }) => {
    const delay = stream ? 0 : 2;
    if (currentView === 'Carplay' && carplayVisible) {
      return css`
        ${theme.animations.getVerticalCollapse(minHeight, maxHeight)} ${collapseLength}s ease-in-out ${delay}s forwards,
        fadeOut ${collapseLength}s ease-in-out ${delay}s forwards;
        padding: 0;
      `;
    } else {
      return css`
        ${theme.animations.getVerticalExpand(minHeight, maxHeight)} ${collapseLength}s ease-in-out forwards,
        fadeIn ${collapseLength}s ease-in-out forwards;
      `;
    }
  }};
  transition: none;
  transform-origin: top;

  @keyframes fadeOut {
    from { opacity: 1;}
    to   { opacity: 0;}
  }

  @keyframes fadeIn {
    from { opacity: 0; }
    to   { opacity: 1; }
  }
`;

const Page = styled.div`
  position: relative;  
  flex: 1;
  display: flex;
  flex-direction: column;
  border-radius: 7px;
  background: ${({ theme }) => theme.colors.gradients.gradient1};
  overflow: hidden;
`;

const NavBlocker = styled.div<NavBlockerProps>`
  width: 100%;
  height: ${({ sidebarSettings, contentPadding, isActive }) =>
    isActive
      ? `${sidebarSettings.navBarHeight.value - contentPadding}px`
      : '0'};
  animation: ${({ theme, isActive, collapseLength, minHeight, maxHeight }) => css`
    ${isActive
      ? theme.animations.getVerticalExpand(minHeight, maxHeight)
      : theme.animations.getVerticalCollapse(minHeight, maxHeight)} ${collapseLength}s ease-in-out forwards;
  `};
  background: none;
  transition: height 0.3s ease-in-out;
`;

const Content = () => {
  const viewMap = { Dashboard, Carplay, Rearcam, Settings };

  const appUpdate         = APP((state) => state.update);
  const keyStroke         = APP((state) => state.keyStroke);
  const switchPage        = APP((state) => state.switchPage);
  const pauseKeyBinds     = APP((state) => state.pauseKeyBinds);

  const startedUp         = APP((state) => state.system.startedUp);
  const sidebarSettings   = APP((state) => state.settings.side_bars as SideBarsSettings | undefined);
  const interfaceSettings = APP((state) => state.system.interface);
  const carplaySettings   = APP((state) => state.system.carplay);
  const appBindings       = APP((state) => state.settings.app_bindings as AppBindings | undefined);
  const contentPadding    = APP((state) => (state.settings.general as { contentPadding: { value: number } } | undefined)?.contentPadding?.value ?? 0);
  const view              = APP((state) => state.system.view);

  const socket = useNamespaces();


  const reverse           = APP((state) => state.system.reverse);
  const reverseDelay      = APP((state) => (state.settings.reverseCam as { delay: { value: number } } | undefined)?.delay?.value ?? 2);
  const rearcamEnabled    = APP((state) => (state.settings.reverseCam as { enabled?: { value: boolean } } | undefined)?.enabled?.value);

  const cardPadding = 20;
  const windowSize = { width: window.innerWidth, height: window.innerHeight };

  const fadeLength = 200; //ms
  const collapseLength = 400; //ms
  const [fadePage, setFadePage] = useState('fade-in');
  const [currentView, setCurrentView] = useState(view);

  /* Swipe / Navbar states */
  const [swipeStartY, setSwipeStartY] = useState<number | null>(null);
  const [swipeDistance, setSwipeDistance] = useState(0);
  const [isHovering, setIsHovering] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reverse refs + timer (to exit from rearcam)
  const previousView = useRef<string | null>(null);
  const reverseNavigated = useRef(false);
  const exitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* Socket connection for reverse camera */
  useEffect(() => {
    const sysChannel = io("ws://localhost:4001/sys", { transports: ["websocket"] });

    const onReverse = (active: boolean) => {
      socket.log.emit(`[Frontend] Reverse: ${active}`);
      appUpdate((state) => {
        state.system.reverse = active;
      });
    };

    sysChannel.on("reverse", onReverse);

    return () => {
      sysChannel.off("reverse", onReverse);
      sysChannel.close();
    };
  }, [appUpdate]);

  /* Reverse camera logic */
  useEffect(() => {
    // Open reverse: cancel timer and show reverse 
    if (reverse) {
      if (exitTimerRef.current) {
        clearTimeout(exitTimerRef.current);
        exitTimerRef.current = null;
      }
      if (view !== 'Rearcam') {
        previousView.current = view;
        reverseNavigated.current = true;
        appUpdate((state) => {
          state.system.view = 'Rearcam';
        });
      }
      return;
    }

    // Exit: wait before return
    if (view === 'Rearcam' && reverseNavigated.current && exitTimerRef.current === null) {
      exitTimerRef.current = setTimeout(() => {
        appUpdate((state) => {
          state.system.view = previousView.current || 'Dashboard';
        });
        reverseNavigated.current = false;
        previousView.current = null;
        exitTimerRef.current = null;
      }, (reverseDelay * 1000)); // REAR TIMER
    }

    return () => {
      if (exitTimerRef.current) {
        clearTimeout(exitTimerRef.current);
        exitTimerRef.current = null;
      }
    };
  }, [reverse, view, appUpdate]);

  /* Handle view changes and fade */
  useEffect(() => {
    if (view === 'Carplay' && interfaceSettings.carplay) {
      setFadePage('fade-out');
      setTimeout(() => {
        setCurrentView(view);
        setFadePage('hidden');
        appUpdate((state) => {
          state.system.interface.content = false;
          state.system.interface.navBar = false;
        });
      }, fadeLength);
      return;
    }

    // FAST-PATH for RearCamera, instant change
    if (view === 'Rearcam' && currentView !== 'Rearcam') {
      setCurrentView('Rearcam');
      setFadePage('fade-in');
      appUpdate((state) => {
        state.system.interface.content = true;
        state.system.interface.navBar = true;
      });
      return;
    }

    if (view === currentView && !interfaceSettings.carplay) {
      setFadePage('fade-in');
      appUpdate((state) => {
        state.system.interface.content = true;
        state.system.interface.navBar = true;
      });
    } else if (view !== currentView) {
      setFadePage('fade-out');
      setTimeout(() => {
        setCurrentView(view);
        setFadePage('fade-in');
        appUpdate((state) => {
          state.system.interface.content = true;
          state.system.interface.navBar = true;
        });
      }, fadeLength);
    }
  }, [view, interfaceSettings.carplay, currentView, appUpdate, fadeLength]);

  /* Carplay connection effect */
  useEffect(() => {
    // Primary: both connected (stream confirmed) and worker (plugged) are true
    // Fallback: worker alone is true, meaning the session is active even if the render
    // worker never fired streamStarted (e.g. SPS NALU not yet seen or renderer error)
    if (carplaySettings.worker) {
      appUpdate((state) => { state.system.interface.carplay = true; });
    } else {
      appUpdate((state) => { state.system.interface.carplay = false; });
    }
  }, [carplaySettings, appUpdate]);

  /* Auto-hide NavBar */
  useEffect(() => {
    if (view === 'Settings') {
      appUpdate((state) => { state.system.interface.navBar = true; });
      if (timerRef.current) clearTimeout(timerRef.current);
      return;
    }

    if (interfaceSettings.navBar) {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        appUpdate((state) => { state.system.interface.navBar = false; });
      }, 4000);
    }

    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [view, interfaceSettings.navBar, appUpdate]);

  /* Swipe detection handlers */
  const handlePointerDown = (event: React.MouseEvent | React.TouchEvent) => {
    if (view === 'Settings') return;

    const e = event as any;
    const clientY: number = e.clientY || e.touches?.[0]?.clientY;
    setSwipeStartY(clientY);

    // Trigger navbar if click is in lower 10% of screen
    if (clientY > window.innerHeight * 0.9) {
      appUpdate((state) => { state.system.interface.navBar = true; });
    }
  };

  const handlePointerMove = (event: React.MouseEvent | React.TouchEvent) => {
    if (swipeStartY === null) return;
    const e = event as any;
    const currentY: number = e.clientY || e.touches?.[0]?.clientY;
    const distance = swipeStartY - currentY; // swipe up = positive
    setSwipeDistance(distance);
    setIsHovering(distance > 0); // visual feedback
  };

  const handlePointerUp = () => {
    const threshold = 100; // pixels to trigger navbar
    if (swipeDistance > threshold) {
      appUpdate((state) => { state.system.interface.navBar = true; });
    }
    setSwipeStartY(null);
    setSwipeDistance(0);
    setIsHovering(false);
  };

  /* Mouse hover detection for visual feedback */
  useEffect(() => {
    const handleMouseMove = (event: MouseEvent) => {
      const deadZone = 85; 
      setIsHovering(event.clientY > window.innerHeight * (deadZone / 100));
    };
    window.addEventListener('mousemove', handleMouseMove);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
    };
  }, []);

  const renderView = () => {
    const vm = viewMap as Record<string, React.ComponentType>;
    const key = vm[currentView] ? currentView : 'Dashboard';
    const Component = vm[key];
    if (!Component) {
      console.error(`Component for view "${currentView}" is undefined.`);
      return null;
    }
    return <Component />;
  };

  useEffect(() => {
    if (appBindings?.switch?.value) {
      appUpdate((state) => {
        state.system.switch = appBindings!.switch.value;
      });
    }
  }, [appBindings, appUpdate]);

  const viewEnabled: Partial<Record<string, boolean>> = {
    Rearcam: rearcamEnabled,
  };

  const cycleView = () => {
    const viewKeys = Object.keys(viewMap).filter((v) => viewEnabled[v] !== false);
    let currentIndex = viewKeys.indexOf(view);
    currentIndex = (currentIndex + 1) % viewKeys.length;
    appUpdate((state) => { state.system.view = viewKeys[currentIndex]; });
  };

  // Listen for key strokes to switch views
  useEffect(() => {
    if ( !pauseKeyBinds && keyStroke === switchPage ) {
      console.log(pauseKeyBinds, keyStroke, switchPage)
      cycleView();
    }
  }, [keyStroke, pauseKeyBinds, switchPage]);

  return (
    <>
      {startedUp && (
        <>
          {<TopBar />}
          <NavBar isHovering={isHovering} swipeProgress={Math.min(swipeDistance / 100, 1)} />
          <MainContainer
            sidebarSettings={sidebarSettings ?? { topBarHeight: { value: 0 }, navBarHeight: { value: 0 } }}
            interfaceSettings={interfaceSettings as InterfaceSettings}
            view={view}
            contentPadding={contentPadding}
            height={windowSize.height}
            width={windowSize.width}
            onMouseDown={handlePointerDown}
            onMouseMove={handlePointerMove}
            onMouseUp={handlePointerUp}
            onTouchStart={handlePointerDown}
            onTouchMove={handlePointerMove}
            onTouchEnd={handlePointerUp}
          >
            <SideBar collapseLength={collapseLength} />
            <Card
              stream={carplaySettings.connected}
              currentView={view}
              carplayVisible={interfaceSettings.carplay}
              maxHeight={windowSize.height - (sidebarSettings?.topBarHeight?.value ?? 0) - cardPadding}
              minHeight={0}
              collapseLength={collapseLength / 1000}
            >
              <Page>
                <Fade className={fadePage} fadeLength={fadeLength / 1000}>
                  {renderView()}
                </Fade>
                <NavBlocker
                  sidebarSettings={sidebarSettings ?? { topBarHeight: { value: 0 }, navBarHeight: { value: 0 } }}
                  contentPadding={contentPadding}
                  isActive={interfaceSettings.navBar}
                  collapseLength={collapseLength / 1000}
                  minHeight={0}
                  maxHeight={(sidebarSettings?.navBarHeight?.value ?? 0) - contentPadding}
                />
              </Page>
            </Card>
          </MainContainer>
        </>
      )}
    </>
  );
};

export default Content;