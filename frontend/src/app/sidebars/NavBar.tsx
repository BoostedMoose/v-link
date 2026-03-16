import { APP, useThemeColor } from '@/store/Store';
import { IconNav } from '@/theme/styles/Icons';
import { GlowLarge as GlowLargeBase } from '@/theme/styles/Effects';
import styled, { css, useTheme } from 'styled-components';
import React from 'react';

const GlowLarge = GlowLargeBase as React.ComponentType<React.HTMLAttributes<HTMLDivElement> & { color?: string; opacity?: number }>;

type SideBarsSettings = { navBarHeight: { value: number }; topBarHeight: { value: number } };

interface NavbarProps {
  navBarHeight: number;
  isActive: boolean;
}

interface IndicatorProps {
  isActive: boolean;
}

interface BlobProps {
  isActive: boolean;
  isHovering: boolean;
  activeColor: string;
}

interface NavBarProps {
  isHovering: boolean;
  swipeProgress?: number;
}

const Navbar = styled.div<NavbarProps>`
  position: absolute;
  bottom: 0;
  z-index: 3;

  background-color:${({ theme }) => `${theme.colors.navbar}`};
  display: flex;
  flex-direction: row;
  justify-content: space-evenly;
  align-items: center;
  width: 100%;
  height: ${({ navBarHeight }) => `${navBarHeight}px`};
  animation: ${({ navBarHeight, theme, isActive }) => css`
    ${isActive
      ? theme.animations.getSlideDown(navBarHeight)
      : theme.animations.getSlideUp(navBarHeight)} 0.3s ease-in-out forwards
  `};
`;

const NavButton = styled.button`
    width: 100%;
    background: none;
    border: none;

    &:hover {
        cursor: pointer;
    }
`;

const Indicator = styled.div<IndicatorProps>`
    position: absolute;
    bottom: 0;
    z-index: 3;

    display: ${({ isActive }) => `${isActive ? 'none' : 'flex'}`};
    justify-content: center;
    align-items: center;

    width: 100%;
    height: 20px;
    background: none;
    border: none;
`;

const Blob = styled.div<BlobProps>`
    width: 100px;
    height: 3px;
    background: ${({ theme, activeColor, isHovering }) => isHovering ? activeColor : theme.colors.medium};

    border-radius: 2.5px;
    border: none;

    /* Add transition for background color change */
    transition: background 0.4s ease-in-out;
`;


const NavBar = ({ isHovering }: NavBarProps) => {
  const theme = useTheme();
  const themeColor = useThemeColor();

  const appUpdate     = APP((state) => state.update);
  const isActive      = APP((state) => state.system.interface.navBar);
  const content       = APP((state) => state.system.interface.content);
  const currentView   = APP((state) => state.system.view);
  const navBarHeight  = APP((state) => (state.settings.side_bars as SideBarsSettings | undefined)?.navBarHeight?.value ?? 50);

  const enabled       = APP((state) => state.settings.reverseCam as { enabled?: { value: boolean } } | undefined)?.enabled?.value;

  const viewEnabled: Partial<Record<string, boolean>> = {
    Rearcam: enabled,
  };

  const handleClick = () => {
    appUpdate((state) => { state.system.interface.navBar = true })
  }

  return (
    <>
      <Indicator isActive={isActive}>
        <GlowLarge color={theme.colors.theme[themeColor].active} opacity={isHovering ? 0.75 : 0}>
          {content && <Blob isActive={isActive} isHovering={isHovering} activeColor={theme.colors.theme[themeColor].active} onClick={handleClick}/> }
        </GlowLarge>
      </Indicator>
      <Navbar navBarHeight={navBarHeight} isActive={isActive}>
        {['Dashboard', 'Carplay', 'Rearcam', 'Settings'].filter((view) => viewEnabled[view] !== false).map((view) => (
          <div className="column" key={view} style={{ position: 'relative', width: '100%'}}>
            <NavButton onClick={() => {
              appUpdate((state) => { state.system.view = view })
            }}>
              <IconNav
                isActive={currentView === view}
                activeColor={theme.colors.theme[themeColor].active}
                defaultColor={theme.colors.medium}
                inactiveColor={theme.colors.medium}
                glowColor={theme.colors.theme[themeColor].active}>
                <use xlinkHref={`/assets/svg/buttons/${view.toLowerCase()}.svg#${view.toLowerCase()}`}></use>
              </IconNav>
            </NavButton>
          </div>
        ))}
      </Navbar>
    </>
  );
};

export default NavBar;
