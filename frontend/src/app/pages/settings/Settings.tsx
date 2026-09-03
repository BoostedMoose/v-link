import { useState, useEffect, useRef, ReactNode } from 'react';
import CanSettings from './CanSettings';
import AudioSettings from './AudioSettings';
import { getAudioSettingsFromAppSettings, withAudioSettings, type AudioSettingsValues } from './audioSettingsState';

import styled, { useTheme } from 'styled-components';
import ScrollContainer from 'react-indiana-drag-scroll'

import { ToggleSwitch, Select, Input, Button } from '@/theme/styles/Inputs';
import CustomSlider from '@/app/components/CustomSlider';
import { Typography } from '@/theme/styles/Typography';

import { APP, CAN, ModuleState, useThemeColor } from '@/store/Store';
import { openModal } from '@/app/components/Modal';

import { useNamespaces } from '@/socket/Namespaces';
const socket = useNamespaces();

type SettingContent = {
  label?: string;
  value: string | number | boolean;
  type?: string;
  options?: string[];
  min?: number;
  max?: number;
  step?: number;
  ui?: string;
};

type SettingsGroup = {
  title?: string;
  type?: string;
  [key: string]: SettingContent | string | undefined;
};

type Constants = {
  modules: Record<string, boolean>;
  chart_input_current: number;
  chart_input_max: number;
};

type AppSettings = {
  constants: Constants;
  [key: string]: SettingsGroup | Constants | unknown;
};

type DataStoreMap = Record<string, Record<string, { label: string }>>;
type ModuleSelectorFn = (select: (s: ModuleState) => ModuleState) => ModuleState;
type DropdownOption = string | { value: string; label: string };

const Container = styled.div`
    flex: 1;

    display: flex;
    flex-direction: column;

    height: 100%;
    width: 100%;
    gap: 15px;

    box-sizing: border-box;
    padding-left: 50px;
    padding-right: 50px;
    padding-top: 30px;
    padding-bottom: 20px;

    overscroll: hidden;
`;

const Spacer = styled.div`
    display: flex;
    justify-content: right;
    align-items: center;

    height: 100%;
    width: ${({ theme }) => theme.interaction.buttonWidth}px;

    gap: 10px;

    padding-right: 5px;
    box-sizing: border-box;
`;

const Divider = styled.div`
    flex: 1 1 0px;
    border-bottom: 1px solid ${({ theme }) => theme.colors.dark};
    margin-left: 5px;
    margin-right: 5px;
    margin-top: 5px;
`

const Element = styled.div`
    display: flex;
    justify-content: center;
    align-items: center;
    flex-direction: row;

    height: 35px;
    width: 100%;

    margin-bottom: 12px;
`


const Settings = () => {

  /* Load Types */
  const Body1 = Typography.Body1
  const Title = Typography.Title
  const Caption2 = Typography.Caption2

  /* Load Stores */
  const modules = APP((state) => state.modules)
  const settings = APP((state) => state.settings) as AppSettings;
  const appUpdate = APP((state) => state.update)
  const themeColor = useThemeColor();
  const versionNumber = APP((state) => state.system.version);
  const settingPage = APP((state) => state.system.settingPage);

  const rtiState = APP((state) => state.system.rtiState);
  const canState = APP((state) => state.system.canState);
  const adcState = APP((state) => state.system.adcState);
  const swcState = APP((state) => state.system.swcState);

  const canSettings = CAN((state) => state.settings);
  const prevCanSettingsRef = useRef(canSettings);

  const theme = useTheme();
  const rangeWidth = Number(theme.interaction.buttonWidth) * 2;


  const [save, setSave] = useState(true)
  const [reset, setReset] = useState(false)
  const [currentSettings, setCurrentSettings] = useState<AppSettings>(structuredClone(settings) as AppSettings);
  const [cameraDevices, setCameraDevices] = useState<{ deviceId: string; label: string }[]>([]);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSettingsRef = useRef<AppSettings>(currentSettings);
  const SAVE_DEBOUNCE_MS = 500;

  const setKeyStroke = APP((state) => state.setKeyStroke);
  const setSwitchPage = APP((state) => state.setSwitchPage);
  const setPauseKeyBinds = APP((state) => state.setPauseKeyBinds);


  /* Ping modules to get thread state */
  useEffect(() => {

    Object.keys(modules).forEach(module => {
      if (socket[module]) {
        socket[module].emit('ping');
      }
    });
  }, [modules]);

  useEffect(() => {
    if (!navigator?.mediaDevices?.enumerateDevices) return;

    const updateDevices = async () => {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const videoInputs = devices
          .filter((device) => device.kind === 'videoinput')
          .map((device, index) => ({
            deviceId: device.deviceId,
            label: device.label || `Camera ${index + 1}`,
          }));
        setCameraDevices(videoInputs);
      } catch {
        setCameraDevices([]);
      }
    };

    updateDevices();
    navigator.mediaDevices.addEventListener('devicechange', updateDevices);
    return () => navigator.mediaDevices.removeEventListener('devicechange', updateDevices);
  }, []);

  useEffect(() => {
    pendingSettingsRef.current = currentSettings;
  }, [currentSettings]);

  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, []);

  /* Reset container to top when settings are reset */
  useEffect(() => {
    if (reset) {
      setCurrentSettings(settings as AppSettings);
      setReset(false);

      if (scrollRef.current) {
        scrollRef.current.scrollTop = 0;
      }
    }
  }, [reset, settings]);


  useEffect(() => {
    if (prevCanSettingsRef.current === canSettings) return;
    prevCanSettingsRef.current = canSettings;
    setSave(false);
    if (autoSave) {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = setTimeout(() => {
        socket.can.emit('save', canSettings);
      }, SAVE_DEBOUNCE_MS);
    }
  }, [canSettings]);


  /* Create combined data store for dropdown */
  const dataStores: DataStoreMap = {};
  Object.entries(modules).map(([key, module]) => {
    const currentModule = (module as ModuleSelectorFn)((state) => state);
    const moduleSettings = currentModule.settings as Record<string, unknown> & {
      type?: string;
      sensors?: Record<string, { label: string; enabled?: boolean }>
    };
    if (moduleSettings.type && moduleSettings.type === 'data') {
      const activeSensors = Object.fromEntries(
        Object.entries(moduleSettings.sensors ?? {})
          .filter(([, sensor]) => sensor.enabled !== false)
      );
      Object.assign(dataStores, { [key]: activeSensors });
    }
  });

  /* Add Settings */
  const autoSave = (currentSettings?.general as Record<string, SettingContent>)?.autoSave?.value as boolean ?? false;

  const scheduleSave = (nextSettings: AppSettings) => {
    if (!autoSave) {
      setSave(false);
      return;
    }

    setSave(false);
    pendingSettingsRef.current = nextSettings;

    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    saveTimeoutRef.current = setTimeout(() => {
      saveSettings(pendingSettingsRef.current);
    }, SAVE_DEBOUNCE_MS);
  };

  const handleAudioSettingsChange = (values: AudioSettingsValues) => {
    const nextSettings = withAudioSettings(currentSettings, values);
    setCurrentSettings(nextSettings);
    scheduleSave(nextSettings);
  };

  const handleAddSetting = (key: string, currentSettings: AppSettings) => {
    if (currentSettings.constants.chart_input_current < currentSettings.constants.chart_input_max) {
      const newSetting = {
        type: "can",
        value: "rpm",
        label: `Value ${currentSettings.constants.chart_input_current + 1}`,
      };

      // Check if the key exists in the settings
      if (currentSettings[key]) {
        const updatedSettingsForKey = { ...(currentSettings[key] as SettingsGroup) };
        const newSettingId = `value_${currentSettings.constants.chart_input_current + 1}`;
        (updatedSettingsForKey as Record<string, unknown>)[newSettingId] = newSetting;

        // Update the state with the new settings
        const nextSettings: AppSettings = {
          ...currentSettings,
          constants: {
            ...currentSettings.constants,
            chart_input_current: currentSettings.constants.chart_input_current + 1,
          },
          [key]: updatedSettingsForKey,
        };
        setCurrentSettings(nextSettings);
        scheduleSave(nextSettings);
      } else {
        console.error(`Key "${key}" not found in settings.`);
      }
    }
  };

  /* Remove Settings */
  const handleRemoveSetting = (key: string, currentSettings: AppSettings) => {
    if (currentSettings.constants.chart_input_current > 1) {
      const updatedSettingsForKey = { ...(currentSettings[key] as SettingsGroup) };
      const settingIdToRemove = `value_${currentSettings.constants.chart_input_current}`;
      delete (updatedSettingsForKey as Record<string, unknown>)[settingIdToRemove];

      // Update the state with the  minus the removed one
      const nextSettings: AppSettings = {
        ...currentSettings,
        constants: {
          ...currentSettings.constants,
          chart_input_current: currentSettings.constants.chart_input_current - 1,
        },
        [key]: updatedSettingsForKey,
      };
      setCurrentSettings(nextSettings);
      scheduleSave(nextSettings);
    } else {
      console.error("Cannot remove setting, minimum limit reached.");
    }
  };




  // Change Settings
  const handleSettingChange = (selectStore: string, key: string, name: string, targetSetting: string | number | boolean, currentSettings: AppSettings) => {
    const newSettings = structuredClone(currentSettings) as AppSettings;
    let convertedValue: string | undefined;
    if (selectStore != 'app') {
      convertedValue = Object.keys(dataStores[selectStore]).find(
        (messageKey) => dataStores[selectStore][messageKey].label === targetSetting
      );
      (newSettings[key] as Record<string, Record<string, unknown>>)[name].value = convertedValue || targetSetting;
      (newSettings[key] as Record<string, Record<string, unknown>>)[name].type = selectStore;
    } else {
      (newSettings[key] as Record<string, Record<string, unknown>>)[name].value = targetSetting;
    }

    setCurrentSettings(newSettings);
    scheduleSave(newSettings);
  };

  // Clean Dashboard Entries when sensors are removed to prevent ghost entries and crashes
  function cleanDashboardEntries(settingsToClean: AppSettings, activeSensorKeys: Set<string>): { cleaned: AppSettings; didClean: boolean } {
    const cleaned = structuredClone(settingsToClean) as AppSettings;
    const dashKeys = ['dash_charts', 'dash_classic', 'dash_race', 'dash_simple', 'dash_topbar'];
    let didClean = false;

    dashKeys.forEach((dashKey) => {
      const block = cleaned[dashKey] as Record<string, SettingContent> | undefined;
      if (!block) return;
      Object.entries(block).forEach(([entryKey, entry]) => {
        if (
          entry?.value &&
          typeof entry.value === 'string' &&
          entry.value !== '' &&
          typeof entry.type === 'string' &&
          entry.type !== '' &&
          entry.type !== 'text' &&
          !activeSensorKeys.has(entry.value)
        ) {
          block[entryKey] = { ...entry, value: '', type: '' };
          didClean = true;
        }
      });
    });

    return { cleaned, didClean };
  }

  // Save Settings
  function saveSettings(settingsToSave: AppSettings = currentSettings) {
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    setSave(true);

    const activeSensorKeys = new Set(
      Object.values(dataStores).flatMap((store) => Object.keys(store))
    );

    const { cleaned, didClean } = cleanDashboardEntries(settingsToSave, activeSensorKeys);

    if (didClean) {
      setCurrentSettings(cleaned);
      pendingSettingsRef.current = cleaned;
    }

    appUpdate((state) => { state.settings = cleaned; });
    socket.app.emit('save', cleaned);
    socket.can.emit('save', canSettings);
  }

  // System Tasks
  function systemTask(request: string) {

    if (['quit', 'reboot', 'restart'].includes(request)) {
      openModal("Exiting...", "Please wait while the app is closing.", undefined, undefined)
      setTimeout(() => {
        socket.sys.emit("systemTask", request);
      }, 1000)
    } else if (request === 'reset') {
      openModal("Reset", "All Settings have been resetted.", undefined, undefined)
    } else {
      socket.sys.emit("systemTask", request);
    }

    setReset(true)
  }

  function sendForceSwitchMostMessage() {
    socket.most.emit("force_switch");
  }

  const checkUpdate = async () => {
    const githubRepo = "BoostedMoose/v-link"; // Replace with your GitHub repository

    try {
      const response = await fetch(
        `https://api.github.com/repos/${githubRepo}/releases/latest`
      );

      if (!response.ok) {
        throw new Error("Failed to fetch the latest release.");
      }

      const data = await response.json();
      const latestVersion = data.tag_name; // This is the version (e.g., "v1.2.0")


      if (latestVersion === versionNumber)
        openModal("No Updates available.", "Check back again later :)", undefined, undefined)
      else {
        openModal("New update available!", `Current: ${versionNumber} \n\n Latest: ${latestVersion}`, "UPDATE NOW", () => systemTask('update'))
      }
    } catch (error) {
      openModal("Error checking for updates:", error instanceof Error ? error.message : String(error), undefined, undefined)
    }
  }


  // Toggle Threads
  useEffect(() => {
    if (reset) {
      setCurrentSettings(settings as AppSettings)
      setReset(false)
    }
  }, [reset])

  /* Toggle Threads */
  function handleIO(_module: string, channel: { emit: (e: string) => void }) {
    channel.emit("toggle");
  }

  /* Render Settings */
  function renderSetting(key: string, settingsObj: AppSettings): ReactNode {
    // NOTES: Settings are grouped into types
    // "System" Settings control the appearance and behaviour of the app. This is the main settings file.
    // "Data" Settings provide parameters for the app and certain system settings
    // "Interface" Settings provide parameter for the behaviour of the interface modules

    // System Settings is grouped into different objects. e.g.:
    /*  {
    /*    "application": {
    /*      "label": "Application",         // Cleartext of settings block
    /*      "type": "system",               // Settings type ("system", "data", "interface")
    /*
    /*      "colorTheme": {
    /*          "label": "Color Theme",
    /*          "value": "Green",
    /*          "options": ["Green", "Red", "Blue", "White"],
    /*      },
    /*      (...)
    /*    },
    /*  },
    /*
    /* Based on the "type", either data or interface settings are provided to the main settings file.
    */

    if (!settingsObj || !settingsObj[key]) return null;

    const block = settingsObj[key] as SettingsGroup;

    if (block?.ui === 'range') {
      const { label, value, min, max, step } = block as unknown as { label: string; value: number; min: number; max: number; step: number };

      const handleRangeChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        const newValue = Number(event.target.value);
        const nextSettings: AppSettings = {
          ...settingsObj,
          [key]: {
            ...block,
            value: newValue,
          },
        };
        setCurrentSettings(nextSettings);
        if (key === 'daylight_backlight') {
          socket.app.emit('backlight:update', { daylight: newValue });
        }
        if (key === 'darkness_backlight') {
          socket.app.emit('backlight:update', { darkness: newValue });
        }
        scheduleSave(nextSettings);
      };

      const labelStyle = key === 'daylight_backlight' ? { whiteSpace: 'nowrap' as const } : undefined;

      return (
        <Element>
          <Caption2 style={labelStyle}>{label}</Caption2>
          <Divider />
          <Spacer style={{ width: `${rangeWidth}px` }}>
            <CustomSlider
              value={value}
              min={min}
              max={max}
              step={step}
              onChange={handleRangeChange}
              width="100%"
              backgroundColor={theme.colors.medium}
              defaultColor={theme.colors.theme[themeColor].default}
              activeColor={theme.colors.theme[themeColor].active}
            />
          </Spacer>
        </Element>
      );
    }

    // Get label, type, and nested options from setting block
    const { title, type, ...nestedSettings } = block;

    const nestedElements = Object.entries(nestedSettings).map(([setting, rawContent]) => {
      const content = rawContent as SettingContent;
      let value: string | number | boolean;
      let label: string | undefined;
      const dataOptions: Record<string, string> = {};

      // Get current value
      if (content.value != "") {
        if (type === "data" && content.type != null && content.type != 'text') {    // Is the setting responsible for handling data and is a data type assigned?
          label = content.label
          value = dataStores[content.type]?.[content.value as string]?.label ?? String(content.value)   // Read content from combined data store
        } else {
          label = content.label                                                     // NO?  Grab label from "system"-store
          value = content.value                                                     // NO?  Grab value from "system"-store
        }
      } else {
        label = content.label
        value = content.value
      }

      Object.keys(dataStores).forEach((storeType) => {                          // Dataoptions is mapping the sensor, e.g. "Boost" to the corresponding settingsfile, in this case "can"
        Object.keys(dataStores[storeType]).forEach((sensorKey) => {
          const sensorLabel = dataStores[storeType][sensorKey].label             // YES? Grab label from combined data store
          dataOptions[sensorLabel] = storeType                                   // YES? Grab data type from combined data store
        });
      });

      // Get options
      //Check if value is a number or boolean
      const isText = (content.type === 'text')

      const isRearcamDeviceId = key === 'reverseCam' && setting === 'deviceId';
      const rearcamDeviceOptions: DropdownOption[] | null = isRearcamDeviceId
        ? [
          { value: 'default', label: 'Default' },
          ...cameraDevices.map((device) => ({
            value: device.deviceId,
            label: device.label,
          })),
        ]
        : null;

      const dropdown: DropdownOption[] | null = (isText || typeof value === 'number' || typeof value === 'boolean' || key.includes('bindings'))
        ? null                                                                    //Yes? Return null
        : ((rearcamDeviceOptions && rearcamDeviceOptions.length > 0)
          ? rearcamDeviceOptions
          : (content.options || Object.keys(dataOptions).map((k) => k)))

      // Check for boolean setting
      const isBoolean = typeof value === 'boolean';                               // Checks if the setting is a boolean.
      const isBinding = key.includes('bindings')                                  // Checks if the setting handles bindings


      const handleChange = (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        const { name, value, type } = event.target;
        const checked = (event.target as HTMLInputElement).checked;
        const newValue = type === 'checkbox' ? checked
          : type === 'number' ? Number(value) : value;

        // Don't try to resolve a data store for text fields — always treat as plain app setting
        let selectStore: string;
        if (isText || isBoolean || typeof content.value === 'number') {
          selectStore = "app";
        } else {
          selectStore = (Object.keys(dataOptions).length > 1 && dataOptions[newValue as string])
            ? dataOptions[newValue as string]
            : "app";
        }

        const targetSetting = isBoolean ? checked : newValue;
        if (key === 'auto_backlight' && setting === 'autoOpen') {
          socket.app.emit('backlight:update', { auto_enabled: targetSetting });
        }
        handleSettingChange(selectStore, key, name, targetSetting, settingsObj);
      };


      const handleBinding = (key: string, setting: string) => {
        // Define the key press handler
        const handleKeyPress = (event: KeyboardEvent) => {
          // Close the modal first
          appUpdate((state) => {
            state.system.modal.visible = false;
          });

          const block = settings[key] as SettingsGroup | undefined;
          const entry = block?.[setting] as SettingContent | undefined;

          if (event.code === 'Escape') {
            socket.log.emit("info", "Key binding cancelled.");
          } else {
            socket.log.emit("info", `${entry?.label} bound to: ${event.code}`);
            handleSettingChange("app", key, setting, event.code, settingsObj);
          }

          document.removeEventListener('keydown', handleKeyPress); // Clean up listener

          // Resume key bindings after assignment
          setPauseKeyBinds(false);
        };

        // Set up pause key bindings before showing modal
        setPauseKeyBinds(true);

        // Add event listener for key press
        document.addEventListener('keydown', handleKeyPress);

        // Use the openModal function instead of direct state manipulation
        const block = settings[key] as SettingsGroup | undefined;
        const entry = block?.[setting] as SettingContent | undefined;
        openModal(
          entry?.label ?? '',
          'Press a key to assign or ESC to abort.',
          undefined,
          undefined
        );
      };


      return (
        <Element key={setting}>
          <Caption2>{label}</Caption2>
          <Divider />
          <Spacer>
            {dropdown
              ? (<Select
                name={setting}
                isActive={true}
                onChange={handleChange}
                value={value as string}
              >
                <option value="">
                  N/A
                </option>
                {dropdown.map((option) => {
                  const optVal = typeof option === 'string' ? option : option.value;
                  const optLabel = typeof option === 'string' ? option : option.label;
                  return (
                    <option key={optVal} value={optVal}>{optLabel}</option>
                  );
                })}
              </Select>)
              : (isBoolean
                ? (<ToggleSwitch
                  backgroundColor={theme.colors.medium}
                  defaultColor={theme.colors.theme[themeColor].default}
                  activeColor={theme.colors.theme[themeColor].active}>
                  <input type="checkbox" name={setting} checked={value as boolean} onChange={handleChange} />
                  <span className="slider"></span>
                </ToggleSwitch>)
                : isBinding
                  ? (<Button name={setting} onClick={() => { handleBinding(key, setting) }}>
                    {value as string}
                  </Button>)
                  : <Input name={setting} type={isText ? 'text' : 'number'} value={value as string | number} onChange={handleChange} />
              )}
          </Spacer>
        </Element>
      );
    });

    return (
      <>
        {title && (
          <Element>
            <Title> {title.toUpperCase()} </Title>
          </Element>
        )}
        {nestedElements}
      </>
    );
  }


  //Fixing Mouse Wheel Scrolling for IndianaScroll.
  const scrollRef = useRef<HTMLElement | null>(null);

  // Make sure wheel event is always attached after every render.
  useEffect(() => {
    const handleWheel = (event: Event) => {
      if (scrollRef.current) {
        scrollRef.current.scrollTop += (event as WheelEvent).deltaY; // Scrolls vertically
      }
    };

    const container = scrollRef.current;
    if (container) {
      container.addEventListener("wheel", handleWheel, { passive: true });
    }

    return () => {
      if (container) {
        container.removeEventListener("wheel", handleWheel);
      }
    };
  }, [settingPage]); // Make sure useEffect runs again on reset


  return (
    <Container>
      <ScrollContainer
        className="scroll-container"
        style={{ width: '100%', height: '100%' }}
        horizontal={false}
        hideScrollbars={true}
        ignoreElements='input, select'
        innerRef={scrollRef}
      >
        {settingPage === 'general' &&
          <>
            {renderSetting("general", currentSettings)}
            {renderSetting("shutdown", currentSettings)}
            {renderSetting("side_bars", currentSettings)}
          </>
        }

        {settingPage === 'dashboard' &&
          <>
            {renderSetting("dashboard", currentSettings)}
            {renderSetting("dash_topbar", currentSettings)}
            {renderSetting("dash_classic", currentSettings)}
            {renderSetting("dash_race", currentSettings)}
            {renderSetting("dash_charts", currentSettings)}

            <Element>
              <Caption2>{'Add / Remove Entries'}</Caption2>
              <Divider />
              <Spacer>
                <Button onClick={() => { handleAddSetting("dash_charts", currentSettings) }} style={{ justifyContent: 'center' }}> + </Button>
                <Button onClick={() => { handleRemoveSetting("dash_charts", currentSettings) }} style={{ justifyContent: 'center' }}> - </Button>
              </Spacer>
            </Element>

            {renderSetting("dash_simple", currentSettings)}
            <p />
          </>
        }

        {settingPage === 'keymap' &&
          <>
            {renderSetting("app_bindings", currentSettings)}
            {renderSetting("dongle_bindings", currentSettings)}
          </>
        }

        {/* TODO Fix box name showing CAN sensor config */}
        {settingPage === 'dongle' &&
          <>
            {renderSetting("dongle_config", currentSettings)}
          </>
        }

        {settingPage === 'system' &&
          <>
            <div style={{ display: 'flex', width: '100%', height: '90%', gap: '10px', justifyContent: 'center' }}>
              <div style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%', gap: '10px' }}>
                <Button onClick={() => { systemTask('quit') }} style={{ height: '100%' }}> Quit </Button>
                <Button onClick={() => { systemTask('restart') }} style={{ height: '100%' }}> Restart </Button>
                <Button onClick={() => { systemTask("rti") }} style={{ height: '100%' }}> {rtiState ? "Close RTI" : "Open RTI"} </Button>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%', gap: '10px' }}>
                <Button onClick={() => { checkUpdate() }} style={{ height: '100%' }}> Update </Button>
                <Button onClick={() => { systemTask('reboot') }} style={{ height: '100%' }}> Reboot </Button>
                <Button onClick={() => { sendForceSwitchMostMessage() }} style={{ height: '100%' }}> Switch PiMost </Button>
              </div>
            </div>
            <p />
          </>
        }

        {settingPage === 'display' &&
          <>
            {renderSetting("screen", currentSettings)}
            <Element>
              <Title>Backlight Settings</Title>
            </Element>
            {renderSetting("daylight_backlight", currentSettings)}
            {renderSetting("auto_backlight", currentSettings)}
            {renderSetting("darkness_backlight", currentSettings)}

            {settings.constants.modules.rti &&
              <Element>
                <Caption2>{`RTI ${rtiState ? '(Active)' : '(Inactive)'}`}</Caption2>
                <Divider />
                <ToggleSwitch
                  backgroundColor={theme.colors.medium}
                  defaultColor={theme.colors.theme[themeColor].default}
                  activeColor={theme.colors.theme[themeColor].active}>
                  <input type="checkbox" checked={rtiState} onChange={() => { handleIO("rti", socket.rti) }} disabled={!settings.constants.modules.rti} />
                  <span className="slider"></span>
                </ToggleSwitch>
              </Element>
            }
            <p />
          </>
        }

        {settingPage === 'audio' && (
          <AudioSettings
            values={getAudioSettingsFromAppSettings(currentSettings)}
            onChange={handleAudioSettingsChange}
          />
        )}

        {settingPage === 'rearcam' &&
          <>
            {renderSetting("reverseCam", currentSettings)}
            <p />
          </>
        }

        {settingPage === 'interface' &&
          <>
            <Element>
              <Title>Modules</Title>
            </Element>

            {settings.constants.modules.can &&
              <Element>
                <Caption2>{`CAN ${canState ? '(Active)' : '(Inactive)'}`}</Caption2>
                <Divider />
                <ToggleSwitch
                  backgroundColor={theme.colors.medium}
                  defaultColor={theme.colors.theme[themeColor].default}
                  activeColor={theme.colors.theme[themeColor].active}>
                  <input type="checkbox" checked={canState} onChange={() => { handleIO("can", socket.can) }} />
                  <span className="slider"></span>
                </ToggleSwitch>
              </Element>
            }

            {settings.constants.modules.adc &&
              <Element>
                <Caption2>{`ADC ${adcState ? '(Active)' : '(Inactive)'}`}</Caption2>
                <Divider />
                <ToggleSwitch
                  backgroundColor={theme.colors.medium}
                  defaultColor={theme.colors.theme[themeColor].default}
                  activeColor={theme.colors.theme[themeColor].active}>
                  <input type="checkbox" checked={adcState} onChange={() => { handleIO("adc", socket.adc) }} disabled={!settings.constants.modules.adc} />
                  <span className="slider"></span>
                </ToggleSwitch>
              </Element>
            }

            {settings.constants.modules.swc &&
              <Element>
                <Caption2>{`SWC ${swcState ? '(Active)' : '(Inactive)'}`}</Caption2>
                <Divider />
                <ToggleSwitch
                  backgroundColor={theme.colors.medium}
                  defaultColor={theme.colors.theme[themeColor].default}
                  activeColor={theme.colors.theme[themeColor].active}>
                  <input type="checkbox" checked={swcState} onChange={() => { handleIO("swc", socket.swc) }} disabled={!settings.constants.modules.swc} />
                  <span className="slider"></span>
                </ToggleSwitch>
              </Element>
            }
            <p />

            <Element>
              <Title>Sensors</Title>
            </Element>
            <CanSettings />
            <p />
          </>
        }

      </ScrollContainer>
      {!autoSave && (
        <Button onClick={() => { saveSettings() }}>
          {save ? 'All Settings saved.' : 'Save Settings'}
        </Button>
      )}
    </Container>
  )
};


export default Settings;
