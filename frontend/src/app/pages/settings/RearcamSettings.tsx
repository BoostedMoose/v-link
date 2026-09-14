import { Fragment, useEffect, useState } from 'react';
import styled, { useTheme } from 'styled-components';

import { Input, Select, ToggleSwitch } from '@/theme/styles/Inputs';
import { Typography } from '@/theme/styles/Typography';
import { useThemeColor } from '@/store/Store';

// Rear camera configuration model
type RearcamSetting = {
  label?: string;
  value: string | number | boolean;
  options?: string[];
  min?: number;
  max?: number;
  step?: number;
};

export type RearcamSettingsGroup = {
  title?: string;
  type?: string;
  [key: string]: RearcamSetting | string | undefined;
};

type Props = {
  settings?: RearcamSettingsGroup;
  onChange: (settings: RearcamSettingsGroup) => void;
};

type CameraDevice = { deviceId: string; label: string };
type DropdownOption = string | { value: string; label: string };

// Layout components shared by all rear camera controls
const Divider = styled.div`
  flex: 1 1 0px;
  border-bottom: 1px solid ${({ theme }) => theme.colors.dark};
  margin: 5px 5px 0;
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
  gap: 10px;
  padding-right: 5px;
  box-sizing: border-box;
`;

const SectionDescription = styled(Typography.Body1)`
  width: 100%;
  margin: 4px 0 14px;
  opacity: 0.7;
`;

// Custom guide dimensions only apply when the user selects Custom mode.
const customGuidelineSettings = new Set([
  'guidelineNearWidth',
  'guidelineFarWidth',
  'guidelineLength',
  'guidelineVerticalPosition',
  'guidelineOpacity',
  'guidelineLineThickness',
]);

// These settings always have a valid default, so they do not need an N/A option.
const optionsWithoutEmptyChoice = new Set([
  'guidelineMode',
  'videoResolution',
  'videoFps',
]);

const RearcamSettings = ({ settings, onChange }: Props) => {
  const theme = useTheme();
  const themeColor = useThemeColor();
  const [cameraDevices, setCameraDevices] = useState<CameraDevice[]>([]);

  // Camera device discovery
  useEffect(() => {
    if (!navigator?.mediaDevices?.enumerateDevices) return;

    const updateDevices = async () => {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const inputs = devices.filter((device) => device.kind === 'videoinput');

        // Count repeated browser labels so identical capture devices remain distinguishable.
        const labelCounts = inputs.reduce<Record<string, number>>((counts, device) => {
          const label = device.label.trim();
          if (label) counts[label] = (counts[label] ?? 0) + 1;
          return counts;
        }, {});
        const labelIndexes: Record<string, number> = {};

        setCameraDevices(inputs.map((device, index) => {
          const baseLabel = device.label.trim();

          // Browsers may hide labels until camera permission has been granted.
          if (!baseLabel) {
            return { deviceId: device.deviceId, label: `Camera ${index + 1}` };
          }

          labelIndexes[baseLabel] = (labelIndexes[baseLabel] ?? 0) + 1;
          return {
            deviceId: device.deviceId,
            label: labelCounts[baseLabel] > 1
              ? `${baseLabel} (${labelIndexes[baseLabel]})`
              : baseLabel,
          };
        }));
      } catch {
        setCameraDevices([]);
      }
    };

    updateDevices();

    // Keep the selector synchronized when a USB camera is connected or removed.
    navigator.mediaDevices.addEventListener('devicechange', updateDevices);
    return () => navigator.mediaDevices.removeEventListener('devicechange', updateDevices);
  }, []);

  if (!settings) return null;

  const { title } = settings;
  const settingEntries = Object.entries(settings).filter(
    ([name]) => name !== 'title' && name !== 'type'
  );
  const guidelineMode = (settings.guidelineMode as RearcamSetting | undefined)?.value ?? 'Standard';

  // Update only the rear camera block; the parent owns global state and persistence.
  const updateSetting = (name: string, value: string | number | boolean) => {
    const nextSettings = structuredClone(settings);
    (nextSettings[name] as RearcamSetting).value = value;
    onChange(nextSettings);
  };

  return (
    <>
      {title && (
        <Element>
          <Typography.Title>{title.toUpperCase()}</Typography.Title>
        </Element>
      )}

      {settingEntries.map(([name, rawSetting]) => {
        const setting = rawSetting as RearcamSetting;

        // Preset and disabled guide modes do not expose custom geometry controls.
        if (guidelineMode !== 'Custom' && customGuidelineSettings.has(name)) return null;

        const value = setting.value;
        const isBoolean = typeof value === 'boolean';
        const isNumber = typeof value === 'number';
        const isDeviceId = name === 'deviceId';

        // Preserve a saved device ID even when that camera is currently disconnected.
        const selectedDeviceMissing = isDeviceId
          && typeof value === 'string'
          && value !== ''
          && value !== 'default'
          && !cameraDevices.some((device) => device.deviceId === value);
        const options: DropdownOption[] | null = isBoolean || isNumber
          ? null
          : isDeviceId
            ? [
              { value: 'default', label: 'Default' },
              ...(selectedDeviceMissing
                ? [{ value, label: 'Saved camera (not currently available)' }]
                : []),
              ...cameraDevices.map((device) => ({
                value: device.deviceId,
                label: device.label,
              })),
            ]
            : (setting.options ?? []);

        const handleChange = (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
          const target = event.target;
          const nextValue = target.type === 'checkbox'
            ? (target as HTMLInputElement).checked
            : target.type === 'number'
              ? Number(target.value)
              : target.value;
          updateSetting(name, nextValue);
        };

        // Selects handle text options, toggles handle booleans, and inputs handle numbers.
        return (
          <Fragment key={name}>
            {name === 'guidelineMode' && (
              <SectionDescription>
                Adjust the parking guides to match your vehicle and camera position.
              </SectionDescription>
            )}
            <Element>
              <Typography.Caption2>{setting.label}</Typography.Caption2>
              <Divider />
              <Spacer>
                {options ? (
                  <Select name={name} isActive={true} onChange={handleChange} value={value as string}>
                    {!optionsWithoutEmptyChoice.has(name) && <option value="">N/A</option>}
                    {options.map((option) => {
                      const optionValue = typeof option === 'string' ? option : option.value;
                      const optionLabel = typeof option === 'string' ? option : option.label;
                      return <option key={optionValue} value={optionValue}>{optionLabel}</option>;
                    })}
                  </Select>
                ) : isBoolean ? (
                  <ToggleSwitch
                    backgroundColor={theme.colors.medium}
                    defaultColor={theme.colors.theme[themeColor].default}
                    activeColor={theme.colors.theme[themeColor].active}
                  >
                    <input type="checkbox" name={name} checked={value} onChange={handleChange} />
                    <span className="slider" />
                  </ToggleSwitch>
                ) : (
                  <Input
                    name={name}
                    type="number"
                    value={value as number}
                    min={setting.min}
                    max={setting.max}
                    step={setting.step}
                    onChange={handleChange}
                  />
                )}
              </Spacer>
            </Element>
          </Fragment>
        );
      })}
    </>
  );
};

export default RearcamSettings;
