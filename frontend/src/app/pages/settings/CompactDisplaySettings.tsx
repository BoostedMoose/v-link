import { useCallback, useEffect, useRef } from 'react';
import styled, { useTheme } from 'styled-components';

import { APP, useThemeColor } from '@/store/Store';
import { useNamespaces } from '@/socket/Namespaces';

type RangeSetting = {
  value: number;
  min?: number;
  max?: number;
};

type ToggleSetting = {
  autoOpen?: { value?: boolean };
};

type AppBindings = { left?: { value: string }; right?: { value: string } };
type DongleBindings = {
  selectDown?: { value: string };
  back?: { value: string };
};

type CompactDisplaySettingsProps = {
  onBack: () => void;
};

const Container = styled.div`
  display: grid;
  grid-template-rows: auto 1fr auto;
  gap: 8px;
  width: 100%;
  height: 100%;
  box-sizing: border-box;
  padding: 8px;
  color: ${({ theme }) => theme.colors.light};
`;

const Header = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 28px;
  font-family: ${({ theme }) => theme.typography.title.fontFamily};
  font-size: 15px;
  font-weight: ${({ theme }) => theme.fontWeights.semiBold};
`;

const Mode = styled.span<{ $automatic: boolean; $accent: string }>`
  color: ${({ $automatic, $accent, theme }) => $automatic ? $accent : theme.colors.medium};
  font-family: ${({ theme }) => theme.typography.caption1.fontFamily};
  font-size: 10px;
  text-transform: uppercase;
`;

const BrightnessControl = styled.div`
  display: grid;
  grid-template-columns: 64px minmax(0, 1fr) 64px;
  align-items: stretch;
  gap: 8px;
  min-height: 0;
`;

const ControlButton = styled.button<{ $accent: string }>`
  border: 1px solid ${({ $accent }) => $accent};
  border-radius: 8px;
  background: ${({ theme }) => theme.colors.button};
  color: ${({ theme }) => theme.colors.light};
  font-family: ${({ theme }) => theme.typography.button.fontFamily};
  font-size: 30px;
  outline: none;
  touch-action: manipulation;

  &:active {
    background: ${({ theme }) => theme.colors.dark};
    transform: scale(0.97);
  }

  &:disabled {
    border-color: ${({ theme }) => theme.colors.medium};
    color: ${({ theme }) => theme.colors.medium};
  }
`;

const LevelPanel = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-width: 0;
  gap: 5px;
  border-radius: 8px;
  background: ${({ theme }) => theme.colors.dark};
`;

const BrightnessIcon = styled.svg<{ $accent: string }>`
  width: 34px;
  height: 34px;
  fill: none;
  stroke: ${({ $accent }) => $accent};
  stroke-width: 2.5px;
  stroke-linecap: round;
  stroke-linejoin: round;
`;

const Level = styled.div`
  font-family: ${({ theme }) => theme.typography.display1.fontFamily};
  font-size: 21px;
  font-weight: ${({ theme }) => theme.fontWeights.bold};
  line-height: 1;
`;

const LevelLabel = styled.div`
  color: ${({ theme }) => theme.colors.medium};
  font-family: ${({ theme }) => theme.typography.caption1.fontFamily};
  font-size: 9px;
  font-weight: ${({ theme }) => theme.fontWeights.semiBold};
  line-height: 1;
`;

const Segments = styled.div`
  display: grid;
  grid-template-columns: repeat(16, minmax(2px, 1fr));
  gap: 2px;
  width: min(150px, 90%);
  height: 7px;
`;

const Segment = styled.span<{ $active: boolean; $accent: string }>`
  border-radius: 1px;
  background: ${({ $active, $accent, theme }) => $active ? $accent : theme.colors.medium};
`;

const Footer = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  min-height: 38px;
`;

const FooterButton = styled.button<{ $accent: string; $active?: boolean }>`
  border: 1px solid ${({ $accent, $active, theme }) => $active ? $accent : theme.colors.medium};
  border-radius: 8px;
  background: ${({ theme }) => theme.colors.button};
  color: ${({ theme }) => theme.colors.light};
  font-family: ${({ theme }) => theme.typography.button.fontFamily};
  font-size: 11px;
  font-weight: ${({ theme }) => theme.fontWeights.semiBold};
  outline: none;
  touch-action: manipulation;

  &:active {
    background: ${({ theme }) => theme.colors.dark};
  }
`;

const SAVE_DEBOUNCE_MS = 500;

const CompactDisplaySettings = ({ onBack }: CompactDisplaySettingsProps) => {
  const socket = useNamespaces();
  const theme = useTheme();
  const themeColor = useThemeColor();
  const accent = theme.colors.theme[themeColor].active;
  const appUpdate = APP((state) => state.update);
  const settings = APP((state) => state.settings);
  const keyStroke = APP((state) => state.keyStroke);
  const appBindings = APP((state) => state.settings.app_bindings as AppBindings | undefined);
  const dongleBindings = APP((state) => state.settings.dongle_bindings as DongleBindings | undefined);

  const manualSetting = settings.manual_backlight as RangeSetting | undefined;
  const autoSetting = settings.auto_backlight as ToggleSetting | undefined;
  const min = manualSetting?.min ?? 1;
  const max = manualSetting?.max ?? 16;
  const level = Math.max(min, Math.min(max, Number(manualSetting?.value) || min));
  const automatic = autoSetting?.autoOpen?.value ?? true;

  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSaveRef = useRef<Record<string, unknown> | null>(null);
  const acceptingKeysRef = useRef(!keyStroke);
  const keyHandledRef = useRef(false);

  const flushSave = useCallback(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = null;
    if (pendingSaveRef.current) {
      socket.app.emit('save', pendingSaveRef.current);
      pendingSaveRef.current = null;
    }
  }, [socket.app]);

  const queueSave = useCallback((nextSettings: Record<string, unknown>) => {
    pendingSaveRef.current = nextSettings;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(flushSave, SAVE_DEBOUNCE_MS);
  }, [flushSave]);

  useEffect(() => flushSave, [flushSave]);

  const updateBacklight = useCallback((nextLevel: number, nextAutomatic: boolean) => {
    const nextSettings = structuredClone(APP.getState().settings);
    const manual = nextSettings.manual_backlight as RangeSetting | undefined;
    const auto = nextSettings.auto_backlight as ToggleSetting | undefined;
    if (!manual || !auto?.autoOpen) return;

    manual.value = nextLevel;
    auto.autoOpen.value = nextAutomatic;
    appUpdate((state) => { state.settings = nextSettings; });
    socket.app.emit('backlight:update', {
      manual: nextLevel,
      auto_enabled: nextAutomatic,
    });
    queueSave(nextSettings);
  }, [appUpdate, queueSave, socket.app]);

  const adjust = useCallback((delta: number) => {
    const nextLevel = Math.max(min, Math.min(max, level + delta));
    updateBacklight(nextLevel, false);
  }, [level, max, min, updateBacklight]);

  const toggleAutomatic = useCallback(() => {
    updateBacklight(level, !automatic);
  }, [automatic, level, updateBacklight]);

  useEffect(() => {
    if (!keyStroke) {
      acceptingKeysRef.current = true;
      keyHandledRef.current = false;
      return;
    }
    if (!acceptingKeysRef.current) return;
    if (keyHandledRef.current) return;
    keyHandledRef.current = true;
    if (keyStroke === appBindings?.left?.value) {
      adjust(-1);
      return;
    }
    if (keyStroke === appBindings?.right?.value) {
      adjust(1);
      return;
    }
    if (keyStroke === dongleBindings?.back?.value) {
      flushSave();
      onBack();
      return;
    }
    if (keyStroke === 'Enter' || keyStroke === 'NumpadEnter' || keyStroke === dongleBindings?.selectDown?.value) {
      toggleAutomatic();
    }
  }, [adjust, appBindings?.left?.value, appBindings?.right?.value, dongleBindings?.back?.value, dongleBindings?.selectDown?.value, flushSave, keyStroke, onBack, toggleAutomatic]);

  return (
    <Container aria-label="Compact display settings">
      <Header>
        <span>DISPLAY BRIGHTNESS</span>
        <Mode $automatic={automatic} $accent={accent}>
          {automatic ? 'Automatic · LS CAN' : 'Manual'}
        </Mode>
      </Header>

      <BrightnessControl>
        <ControlButton
          $accent={accent}
          aria-label="Decrease brightness"
          disabled={level <= min && !automatic}
          onClick={() => adjust(-1)}
        >
          −
        </ControlButton>
        <LevelPanel aria-live="polite">
          <BrightnessIcon $accent={accent} aria-hidden="true">
            <use href="/assets/svg/buttons/brightness.svg#brightness" />
          </BrightnessIcon>
          <LevelLabel>FIXED LEVEL</LevelLabel>
          <Level>LEVEL {level} / {max}</Level>
          <Segments aria-hidden="true">
            {Array.from({ length: max }, (_, index) => (
              <Segment key={index} $active={index < level} $accent={accent} />
            ))}
          </Segments>
        </LevelPanel>
        <ControlButton
          $accent={accent}
          aria-label="Increase brightness"
          disabled={level >= max && !automatic}
          onClick={() => adjust(1)}
        >
          +
        </ControlButton>
      </BrightnessControl>

      <Footer>
        <FooterButton $accent={accent} onClick={() => { flushSave(); onBack(); }}>
          BACK
        </FooterButton>
        <FooterButton $accent={accent} $active={automatic} onClick={toggleAutomatic}>
          {automatic ? 'AUTOMATIC: ON' : 'AUTOMATIC: OFF'}
        </FooterButton>
      </Footer>
    </Container>
  );
};

export default CompactDisplaySettings;
