import { useState, useMemo, Fragment } from 'react';
import styled, { useTheme } from 'styled-components';

import { ToggleSwitch } from '@/theme/styles/Inputs';
import { Typography } from '@/theme/styles/Typography';

import { CAN, APP, useThemeColor, DATA } from '@/store/Store';
import { useNamespaces } from '@/socket/Namespaces';

const socket = useNamespaces();

// Types
interface CanInterface {
  enabled: boolean;
  channel: string;
  bitrate: number;
  bustype: string;
  is_extended: boolean;
  wait_for_ecu: boolean;
}

interface CanSensor {
  label: string;
  unit?: string;
  req_id: string;
  rep_id: string;
  priority: number;
  enabled: boolean;
  interface: string;
  parameter: string[];
}

interface CanSignalSensor {
  key: string;
  label: string;
  interface: string;
  enabled: boolean;
  can_id: string;
  byte_index: number;
  bit_index?: number;
  mask?: string | number;
  shift?: number;
  invert?: boolean;
  scale?: string;
}

export interface CanConfig {
  interfaces: CanInterface[];
  sensors: Record<string, CanSensor>;
  signal_sensors: CanSignalSensor[];
}

// Styled components
const Divider = styled.div`
  flex: 1 1 0px;
  border-bottom: 1px solid ${({ theme }) => theme.colors.dark};
  margin-left: 5px;
  margin-right: 5px;
  margin-top: 5px;
`;

const Element = styled.div`
  display: flex;
  justify-content: center;
  align-items: center;
  flex-direction: row;
  height: 35px;
  width: 100%;
  margin-bottom: 12px;
`;

const Spacer = styled.div`
  display: flex;
  justify-content: flex-end;
  align-items: center;
  height: 100%;
  width: ${({ theme }) => theme.interaction.buttonWidth}px;
  padding-right: 5px;
  box-sizing: border-box;
`;

const CollapsibleHeader = styled.div`
  display: flex;
  align-items: center;
  cursor: pointer;
  user-select: none;
  height: 35px;
  width: 100%;
  margin-bottom: 20px;
  &:active { opacity: 0.7; }
`;

const Chevron = styled.span`
  color: ${({ theme }) => theme.colors.medium};
  font-size: ${({ theme }) => theme.typography.caption2.fontSize};
  padding-left: 8px;
  flex-shrink: 0;
`;

const SensorTable = styled.table`
  width: 100%;
  border-collapse: collapse;
  margin-bottom: 16px;
`;

const PrioritySelect = styled.select`
  background: transparent;
  border: 1px solid ${({ theme }) => theme.colors.dark};
  border-radius: 4px;
  color: ${({ theme }) => theme.colors.light};
  font-family: ${({ theme }) => theme.typography.caption1.fontFamily};
  font-size: ${({ theme }) => theme.typography.caption1.fontSize};
  padding: 2px 4px;
  cursor: pointer;
  outline: none;
  width: 44px;
  text-align: center;

  &:focus {
    border-color: ${({ theme }) => theme.colors.medium};
  }

  option {
    background: ${({ theme }) => theme.colors.dark};
    color: ${({ theme }) => theme.colors.light};
  }
`;

const Th = styled.th<{ sortable?: boolean; active?: boolean }>`
  color: ${({ theme, active }) => active ? theme.colors.light : theme.colors.medium};
  font-family: ${({ theme }) => theme.typography.caption2.fontFamily};
  font-size: ${({ theme }) => theme.typography.caption2.fontSize};
  font-weight: 600;
  text-align: left;
  padding: 3px 6px 5px 6px;
  border-bottom: 1px solid ${({ theme }) => theme.colors.dark};
  white-space: nowrap;
  cursor: ${({ sortable }) => sortable ? 'pointer' : 'default'};
  user-select: ${({ sortable }) => sortable ? 'none' : 'auto'};
  &:active { opacity: ${({ sortable }) => sortable ? 0.7 : 1}; }

  &:last-child {
    text-align: right;
    padding-right: 12px;
  }
`;

const SortIndicator = styled.span`
  padding-left: 3px;
  font-size: 9px;
`;

const Td = styled.td`
  color: ${({ theme }) => theme.colors.light};
  font-family: ${({ theme }) => theme.typography.caption1.fontFamily};
  font-size: ${({ theme }) => theme.typography.caption1.fontSize};
  padding: 10px 6px;
  vertical-align: middle;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 120px;
`;

const TdControl = styled.td`
  padding: 10px 6px;
  vertical-align: middle;
  white-space: nowrap;

  // Match the header alignment
  text-align: right;
  width: 1%; /* Keeps the 'shrink-wrap' behavior */
  }
`;

const Tr = styled.tr`
  border-bottom: 1px solid ${({ theme }) => theme.colors.dark};
  &:last-child { border-bottom: none; }
`;

type SortCol = 'label' | 'unit' | 'priority' | 'enabled';

const CanSettings = () => {
  const Title = Typography.Title;
  const Caption2 = Typography.Caption2;

  const canSettings = CAN((state) => state.settings) as unknown as CanConfig;
  const canUpdate = CAN((state) => state.update);
  const canState = APP((state) => state.system.canState);
  const themeColor = useThemeColor();
  const theme = useTheme();

  const [modulesOpen, setModulesOpen] = useState(true);
  const [sensorsOpen, setSensorsOpen] = useState(true);
  const [signalOpen, setSignalOpen] = useState(true);
  const [sortCol, setSortCol] = useState<SortCol | null>('label');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  if (!canSettings || !canSettings.sensors) {
    return (
      <Element>
        <Caption2>CAN settings not available.</Caption2>
      </Element>
    );
  }

  const interfaces = canSettings.interfaces ?? [];
  const sensors = canSettings.sensors ?? {};
  const signalSensors = canSettings.signal_sensors ?? [];

  const p1CycleMs = DATA((state) => state.polling["1"]);
  const p2CycleMs = DATA((state) => state.polling["2"]);
  const p3CycleMs = DATA((state) => state.polling["3"]);

  const toggleSensor = (sensorKey: string) => {
    const updated = structuredClone(canSettings);
    updated.sensors[sensorKey].enabled = !updated.sensors[sensorKey].enabled;
    canUpdate((state) => { state.settings = updated as unknown as Record<string, unknown>; });
    // No socket.can.emit here anymore
  };

  const changePriority = (sensorKey: string, priority: number) => {
    const updated = structuredClone(canSettings);
    updated.sensors[sensorKey].priority = priority;
    canUpdate((state) => { state.settings = updated as unknown as Record<string, unknown>; });
  };

  const toggleSignalSensor = (index: number) => {
    const updated = structuredClone(canSettings);
    updated.signal_sensors[index].enabled = !updated.signal_sensors[index].enabled;
    canUpdate((state) => { state.settings = updated as unknown as Record<string, unknown>; });
    // No socket.can.emit here anymore
  };

  const handleSort = (col: SortCol) => {
    if (sortCol === col) {
      if (sortDir === 'asc') setSortDir('desc');
      else setSortCol(null);
    } else {
      setSortCol(col);
      setSortDir('asc');
    }
  };

  const sortIndicator = (col: SortCol) => {
    if (sortCol !== col) return null;
    return <SortIndicator>{sortDir === 'asc' ? '▲' : '▼'}</SortIndicator>;
  };

  const sortedSensors = Object.entries(sensors).sort(([, a], [, b]) => {
    if (!sortCol) return 0;

    let aVal: any;
    let bVal: any;

    // Logic for the new "enabled" column
    if (sortCol === 'enabled') {
      aVal = a.enabled ? 1 : 0;
      bVal = b.enabled ? 1 : 0;
    } else if (sortCol === 'priority') {
      aVal = a.priority;
      bVal = b.priority;
    } else {
      aVal = a[sortCol] ?? '';
      bVal = b[sortCol] ?? '';
    }

    if (typeof aVal === 'number' && typeof bVal === 'number') {
      return sortDir === 'asc' ? aVal - bVal : bVal - aVal;
    }

    return sortDir === 'asc'
      ? String(aVal).localeCompare(String(bVal))
      : String(bVal).localeCompare(String(aVal));
  });

  const renderToggle = (sensorKey: string, sensor: CanSensor) => (
    <ToggleSwitch
      backgroundColor={theme.colors.medium}
      defaultColor={theme.colors.theme[themeColor].default}
      activeColor={theme.colors.theme[themeColor].active}
    >
      <input type="checkbox" checked={sensor.enabled} onChange={() => toggleSensor(sensorKey)} />
      <span className="slider"></span>
    </ToggleSwitch>
  );

  const renderStatus = (enabled: boolean) => (
    <Caption2
      style={{
        color: enabled
          ? theme.colors.theme[themeColor].active
          : theme.colors.medium,
      }}
    >
      {enabled ? 'Enabled' : 'Disabled'}
    </Caption2>
  );

  return (
    <>
      {/* Module state toggle */}
      {/*
      <CollapsibleHeader onClick={() => setModulesOpen((o) => !o)}>
        <Title>Modules</Title>
        <Divider />
        <Chevron>{modulesOpen ? '▼' : '▶'}</Chevron>
      </CollapsibleHeader>
      {modulesOpen && (
        <>
          <Element>
            <Caption2>{`CAN Bus ${canState ? '(Active)' : '(Inactive)'}`}</Caption2>
            <Divider />
            <Spacer>
              <ToggleSwitch
                backgroundColor={theme.colors.medium}
                defaultColor={theme.colors.theme[themeColor].default}
                activeColor={theme.colors.theme[themeColor].active}
              >
                <input
                  type="checkbox"
                  checked={canState}
                  onChange={() => socket.can.emit('toggle')}
                />
                <span className="slider"></span>
              </ToggleSwitch>
            </Spacer>
          </Element>
          {interfaces.map((iface, i) => (
            <Element key={i} style={{ paddingLeft: '5rem', boxSizing: 'border-box' }}>
              <Caption2>{`${iface.channel} — ${iface.bitrate ? iface.bitrate / 1000 : '?'} kbps — ${iface.bustype}`}</Caption2>
              <Divider />
              <Spacer>
                <Caption2
                  style={{
                    color: iface.enabled
                      ? theme.colors.theme[themeColor].active
                      : theme.colors.medium,
                  }}
                >
                  {iface.enabled ? 'Enabled' : 'Disabled'}
                </Caption2>
              </Spacer>
            </Element>
          ))}
        </>
      )}
        */}
      {/* Sensors — sortable flat list (collapsible) */}
      <CollapsibleHeader onClick={() => setSensorsOpen((o) => !o)}>
        <Title>Diagnostic</Title>
        <Divider />
        <Chevron>{sensorsOpen ? '▼' : '▶'}</Chevron>
      </CollapsibleHeader>
      {[1, 2, 3].map((prio) => {
        const value = [p1CycleMs, p2CycleMs, p3CycleMs][prio - 1];
        return (
          <Element key={`p${prio}_cycle_ms`}>
            <Caption2>{`Priority ${prio}`}</Caption2>
            <Divider />
            <Spacer>
              <Caption2 style={{ color: value !== undefined ? theme.colors.light : theme.colors.medium }}>
                {value !== undefined ? `${value} ms` : '—'}
              </Caption2>
            </Spacer>
          </Element>
        );
      })}
      {sensorsOpen && (
        <SensorTable>
          <thead>
            <tr>
              <Th sortable active={sortCol === 'label'} onClick={() => handleSort('label')}>
                NAME{sortIndicator('label')}
              </Th>
              <Th sortable active={sortCol === 'unit'} onClick={() => handleSort('unit')}>
                UNIT{sortIndicator('unit')}
              </Th>
              <Th sortable active={sortCol === 'priority'} onClick={() => handleSort('priority')}>
                PRIO{sortIndicator('priority')}
              </Th>
              <Th sortable active={sortCol === 'enabled'} onClick={() => handleSort('enabled')}>
                STATUS{sortIndicator('enabled')}
              </Th>
            </tr>
          </thead>
          <tbody>
            {sortedSensors.map(([key, sensor]) => (
              <Tr key={key}>
                <Td>{sensor.label}</Td>
                <Td>{sensor.unit ?? '—'}</Td>
                <Td>
                  <PrioritySelect
                    value={sensor.priority}
                    onChange={(e) => changePriority(key, Number(e.target.value))}
                  >
                    <option value={1}>1</option>
                    <option value={2}>2</option>
                    <option value={3}>3</option>
                  </PrioritySelect>
                </Td>
                <TdControl>{renderToggle(key, sensor)}</TdControl>
                {/*<TdControl>{renderStatus(sensor.enabled)}</TdControl>*/}
              </Tr>
            ))}
          </tbody>
        </SensorTable>
      )}

      {/* Signal Sensors (collapsible) */}
      <CollapsibleHeader onClick={() => setSignalOpen((o) => !o)}>
        <Title>Signals</Title>
        <Divider />
        <Chevron>{signalOpen ? '▼' : '▶'}</Chevron>
      </CollapsibleHeader>
      {signalOpen && (
        <SensorTable>
          <thead>
            <tr>
              <Th>NAME</Th>
              <Th>INTERFACE</Th>
              <Th>CAN ID</Th>
              <Th>BYTE</Th>
              <Th>FIELD</Th>
              <Th style={{ width: '1%' }}></Th>
            </tr>
          </thead>
          <tbody>
            {signalSensors.map((signal, i) => (
              <Tr key={signal.key || i}>
                <Td>{signal.label || signal.key}</Td>
                <Td>{signal.interface}</Td>
                <Td>{signal.can_id}</Td>
                <Td>{signal.byte_index}</Td>
                <Td>{signal.mask != null ? `${signal.mask} >> ${signal.shift ?? 0}` : signal.bit_index}</Td>
                <TdControl>
                  <ToggleSwitch
                    backgroundColor={theme.colors.medium}
                    defaultColor={theme.colors.theme[themeColor].default}
                    activeColor={theme.colors.theme[themeColor].active}
                  >
                    <input
                      type="checkbox"
                      checked={signal.enabled}
                      onChange={() => toggleSignalSensor(i)}
                    />
                    <span className="slider"></span>
                  </ToggleSwitch>
                </TdControl>
                {/*<TdControl>{renderStatus(signal.enabled)}</TdControl>*/}
              </Tr>
            ))}
          </tbody>
        </SensorTable>
      )}
    </>
  );
};

export default CanSettings;
