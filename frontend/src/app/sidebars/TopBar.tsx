import { useState, useEffect, useMemo } from "react";
import { APP, DATA, ModuleState, useThemeColor } from '@/store/Store';
import styled, { css, useTheme } from 'styled-components';

import { IconSmall, CustomIcon } from '@/theme/styles/Icons';
import { Caption1 } from '@/theme/styles/Typography';

type SideBarsSettings = { topBar: { value: boolean }; topBarHeight: { value: number } };
type DashTopbarSettings = { value: { value: string; type: string } };
type SensorConfig = { app_id?: string; limit_start?: number };

interface TopbarProps {
  height: number;
  isActive: boolean;
}

interface ScrollerContentProps {
  active: boolean;
}

const Topbar = styled.div<TopbarProps>`
  position: absolute;
  top: 0;
  z-index: 3;

  background: ${({ theme }) => theme.colors.gradients.gradient1};

  height: ${({ height }) => `${height}px`};
  animation: ${({ height, theme, isActive }) => css`
    ${isActive
      ? theme.animations.getSlideDown(-height)
      : theme.animations.getSlideUp(-height)} 0.3s ease-in-out forwards
  `};
  width: 100%;
  display: flex;
  flex-direction: row;
  justify-content: center;
  align-items: center;
  box-sizing: border-box;
  padding: 5px 20px;
  gap: 10px;

  overflow: hidden;
`;

const Left = styled.div`
  display: flex;
  flex-direction: row;
  justify-content: left;
  align-items: center;
  width: 100%;
  height: 100%;
`;

const Middle = styled.div`
  display: flex;
  flex-direction: row;
  justify-content: center;
  align-items: center;
  width: 100%;
  height: 100%;
`;

const Right = styled.div`
  display: flex;
  flex-direction: row;
  justify-content: right;
  align-items: center;
  width: 100%;
  height: 100%;
  gap: 10px;
`;

const Scroller = styled.div`
  position: relative;
  display: flex;
  flex-direction: column;

  width: 100%;
  height: 30px;

  overflow: hidden;
`;

const ScrollerContent = styled.div<ScrollerContentProps>`
  position: absolute;

  display: flex;
  justify-content: flex-start;
  align-items: center;

  width: 100%;
  height: 30px; /* Each child has a fixed height of 30px */
  gap: 10px;

  top: ${({ active }) => (active ? "0" : "30px")};
  transition: top 0.3s ease-in-out;
`;

const TopBar = () => {
  const theme = useTheme();
  const themeColor = useThemeColor();

  const sideBars = APP(state => state.settings.side_bars) as SideBarsSettings | undefined;
  const topBarActive = sideBars?.topBar?.value ?? true;
  const topBarHeight = sideBars?.topBarHeight?.value ?? 40;
  const dashSettings = APP(state => state.settings.dash_topbar) as DashTopbarSettings | undefined;
  const view = APP(state => state.system.view);
  const content = APP(state => state.system.interface.content);
  const phone = APP((state) => state.system.carplay.phone);
  const wifiState = APP(state => state.system.wifiState);
  const modules = APP(state => state.modules);
  const data = DATA(state => state.data);


  const valueName = dashSettings?.value?.value ?? '';
  const valueType = dashSettings?.value?.type ?? '';

  const sensor: SensorConfig =
    valueType && valueName && modules[valueType]
      ? ((modules[valueType] as (select: (s: ModuleState) => unknown) => unknown)(
          (state: ModuleState) => (state.settings.sensors as Record<string, unknown> | undefined)?.[valueName]
        ) as SensorConfig | undefined) ?? {}
      : {};

  const valueID    = sensor.app_id ?? "err";
  const valueData  = data[valueName] ?? "N/A";
  const valueLimit = sensor.limit_start ?? Infinity;

  const [time, setDate] = useState(new Date());

  useEffect(() => {
    const timer1 = setInterval(() => setDate(new Date()), 60000);
    return () => clearInterval(timer1);
  }, []);

  const formattedTime = useMemo(
    () => time.toLocaleTimeString('sv-SV', { hour: '2-digit', minute: '2-digit' }),
    [time]
  );

  return (
    <Topbar
      isActive={
        view !== 'Carplay' || topBarActive || !phone
      }
      height={topBarHeight}
    >
      <Left>
        <Scroller>
          <ScrollerContent active={content}>
            <Caption1>{formattedTime}</Caption1>
          </ScrollerContent>
          <ScrollerContent active={!content}>
            <CustomIcon
              stroke={3}
              size={14}
              isActive={(valueData as number) > valueLimit}
              activeColor={theme.colors.theme[themeColor].highlightDark}
              defaultColor={theme.colors.light}
              inactiveColor={theme.colors.medium}
              glowColor={theme.colors.theme[themeColor].default}
            >
              {sensor.app_id &&
              <use xlinkHref={`/assets/svg/icons/data/${valueID}.svg#${valueID}`}></use>
              }
            </CustomIcon>
            <Caption1>{valueData as string}</Caption1>
          </ScrollerContent>
        </Scroller>
      </Left>
      <Middle>
        <svg viewBox="0 0 350.8 48.95" xmlns="http://www.w3.org/2000/svg">
          <use xlinkHref="/assets/svg/logos/typo.svg#volvo"></use>
        </svg>
      </Middle>
      <Right>
        <IconSmall isActive={phone}>
          <use xlinkHref="/assets/svg/icons/interface/phone.svg#phone" />
        </IconSmall>
        <IconSmall isActive={wifiState}>
          <use xlinkHref="/assets/svg/icons/interface/wifi.svg#wifi" />
        </IconSmall>
      </Right>
    </Topbar>
  );
};

export default TopBar;
