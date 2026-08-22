import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import styled, { useTheme } from 'styled-components';

import { openModal } from '@/app/components/Modal';
import { APP, useThemeColor } from '@/store/Store';
import { useNamespaces } from '@/socket/Namespaces';

const Container = styled.div`
  width: 100%;
  height: 100%;
  box-sizing: border-box;
  padding: 8px;
  overflow-y: auto;
`;

const Grid = styled.div`
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  grid-auto-rows: minmax(62px, 1fr);
  gap: 8px;
  width: 100%;
  min-height: 100%;

  @media (max-width: 360px) {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
`;

const Tile = styled.button<{ $accent: string; $danger?: boolean; $selected: boolean }>`
  min-width: 0;
  min-height: 62px;
  border: ${({ $selected }) => $selected ? '3px' : '1px'} solid ${({ theme, $danger, $accent }) => $danger ? theme.colors.theme.red.default : $accent};
  border-radius: 8px;
  background: ${({ theme, $selected }) => $selected ? theme.colors.dark : theme.colors.button};
  box-shadow: ${({ $selected, $accent }) => $selected ? `inset 0 0 0 1px ${$accent}, 0 0 8px ${$accent}` : 'none'};
  color: ${({ theme }) => theme.colors.light};
  font-family: ${({ theme }) => theme.typography.button.fontFamily};
  font-size: 12px;
  font-weight: ${({ theme }) => theme.fontWeights.semiBold};
  line-height: 1.15;
  padding: 8px 5px;
  touch-action: manipulation;
  outline: none;

  &:active {
    background: ${({ theme }) => theme.colors.dark};
    transform: scale(0.98);
  }
`;

type SystemTask = 'quit' | 'restart' | 'reboot';
type AppBindings = { left?: { value: string }; right?: { value: string } };
type DongleBindings = { selectDown?: { value: string } };

type CompactAction = {
  id: string;
  label: string;
  danger?: boolean;
  run: () => void;
};

const CompactSettings = () => {
  const socket = useNamespaces();
  const theme = useTheme();
  const appUpdate = APP((state) => state.update);
  const keyStroke = APP((state) => state.keyStroke);
  const appBindings = APP((state) => state.settings.app_bindings as AppBindings | undefined);
  const dongleBindings = APP((state) => state.settings.dongle_bindings as DongleBindings | undefined);
  const rtiEnabled = APP((state) =>
    (state.settings.constants as { modules?: { rti?: boolean } } | undefined)?.modules?.rti ?? false
  );
  const rtiState = APP((state) => state.system.rtiState);
  const themeColor = useThemeColor();
  const [selectedIndex, setSelectedIndex] = useState(0);

  const navigate = useCallback((view: 'Dashboard' | 'Carplay') => {
    appUpdate((state) => {
      state.system.view = view;
    });
  }, [appUpdate]);

  const runSystemTask = useCallback((task: SystemTask) => {
    const messages: Record<SystemTask, string> = {
      quit: 'Closing V-Link...',
      restart: 'Restarting V-Link...',
      reboot: 'Rebooting the system...',
    };
    openModal(messages[task], 'Please wait.', undefined, undefined);
    setTimeout(() => socket.sys.emit('systemTask', task), 750);
  }, [socket.sys]);

  const accent = theme.colors.theme[themeColor].default;

  const actions = useMemo<CompactAction[]>(() => {
    const items: CompactAction[] = [
      { id: 'dashboard', label: 'DASHBOARD', run: () => navigate('Dashboard') },
      { id: 'carplay', label: 'CARPLAY', run: () => navigate('Carplay') },
      { id: 'restart', label: 'RESTART V-LINK', run: () => runSystemTask('restart') },
      { id: 'quit', label: 'QUIT V-LINK', danger: true, run: () => runSystemTask('quit') },
      { id: 'reboot', label: 'REBOOT PI', danger: true, run: () => runSystemTask('reboot') },
    ];

    if (rtiEnabled) {
      items.push({
        id: 'rti',
        label: rtiState ? 'CLOSE RTI' : 'OPEN RTI',
        run: () => socket.sys.emit('systemTask', 'rti'),
      });
    }
    return items;
  }, [navigate, rtiEnabled, rtiState, runSystemTask, socket.sys]);
  const actionsRef = useRef(actions);
  const selectedIndexRef = useRef(selectedIndex);
  actionsRef.current = actions;
  selectedIndexRef.current = selectedIndex;

  useEffect(() => {
    setSelectedIndex((current) => Math.min(current, actions.length - 1));
  }, [actions.length]);

  useEffect(() => {
    if (!keyStroke || actionsRef.current.length === 0) return;

    if (keyStroke === appBindings?.left?.value) {
      setSelectedIndex((current) => (current - 1 + actionsRef.current.length) % actionsRef.current.length);
      return;
    }
    if (keyStroke === appBindings?.right?.value) {
      setSelectedIndex((current) => (current + 1) % actionsRef.current.length);
      return;
    }

    const isConfirm = keyStroke === 'Enter' ||
      keyStroke === 'NumpadEnter' ||
      keyStroke === dongleBindings?.selectDown?.value;
    if (isConfirm) actionsRef.current[selectedIndexRef.current]?.run();
  }, [appBindings?.left?.value, appBindings?.right?.value, dongleBindings?.selectDown?.value, keyStroke]);

  return (
    <Container aria-label="Compact settings">
      <Grid>
        {actions.map((action, index) => (
          <Tile
            key={action.id}
            $accent={accent}
            $danger={action.danger}
            $selected={index === selectedIndex}
            aria-current={index === selectedIndex ? 'true' : undefined}
            tabIndex={index === selectedIndex ? 0 : -1}
            onFocus={() => setSelectedIndex(index)}
            onPointerDown={() => setSelectedIndex(index)}
            onClick={action.run}
          >
            {action.label}
          </Tile>
        ))}
      </Grid>
    </Container>
  );
};

export default CompactSettings;
