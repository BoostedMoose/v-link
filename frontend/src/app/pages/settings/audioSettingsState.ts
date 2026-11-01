import { APP } from '@/store/Store';

export interface AudioSettingsValues {
  navigationVolume: number;
  callVolume: number;
  navigationDuckingAmount: number;
  microphoneGainDb: number;
  autoplayLocalMedia: boolean;
}

export const DEFAULT_AUDIO_SETTINGS: AudioSettingsValues = {
  navigationVolume: 80,
  callVolume: 85,
  navigationDuckingAmount: 80,
  microphoneGainDb: 0,
  autoplayLocalMedia: false,
};

export const NAVIGATION_DUCKING_EVENT = 'v-link-navigation-ducking';

type AppSettings = Record<string, unknown>;

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);

const settingValue = (group: Record<string, unknown>, key: keyof AudioSettingsValues) => {
  const entry = group[key];
  return isRecord(entry) ? entry.value : undefined;
};

export const setNavigationDucking = (active: boolean) => {
  window.dispatchEvent(new CustomEvent(NAVIGATION_DUCKING_EVENT, { detail: active }));
};

export const duckingOutputLevel = (amount: number) => {
  const remaining = 1 - Math.min(Math.max(amount, 0), 100) / 100;
  return remaining * remaining;
};

export const getAudioSettingsFromAppSettings = (settings: unknown): AudioSettingsValues => {
  const appSettings = isRecord(settings) ? settings : {};
  const audio = isRecord(appSettings.audio) ? appSettings.audio : {};
  const numberValue = (key: keyof AudioSettingsValues) => {
    const value = settingValue(audio, key);
    return typeof value === 'number' && Number.isFinite(value) ? value : DEFAULT_AUDIO_SETTINGS[key] as number;
  };
  const autoplayLocalMedia = settingValue(audio, 'autoplayLocalMedia');

  return {
    navigationVolume: numberValue('navigationVolume'),
    callVolume: numberValue('callVolume'),
    navigationDuckingAmount: numberValue('navigationDuckingAmount'),
    microphoneGainDb: numberValue('microphoneGainDb'),
    autoplayLocalMedia: typeof autoplayLocalMedia === 'boolean'
      ? autoplayLocalMedia
      : DEFAULT_AUDIO_SETTINGS.autoplayLocalMedia,
  };
};

export const withAudioSettings = <Settings extends AppSettings>(
  settings: Settings,
  values: AudioSettingsValues,
): Settings => {
  const audio = isRecord(settings.audio) ? settings.audio : {};
  const entry = (key: keyof AudioSettingsValues) => ({
    ...(isRecord(audio[key]) ? audio[key] : {}),
    value: values[key],
  });

  return {
    ...settings,
    audio: {
      ...audio,
      navigationVolume: entry('navigationVolume'),
      callVolume: entry('callVolume'),
      navigationDuckingAmount: entry('navigationDuckingAmount'),
      microphoneGainDb: entry('microphoneGainDb'),
      autoplayLocalMedia: entry('autoplayLocalMedia'),
    },
  } as Settings;
};

export const getAudioSettings = () => getAudioSettingsFromAppSettings(APP.getState().settings);

export const useAudioSettings = (): AudioSettingsValues => ({
  navigationVolume: APP((state) => getAudioSettingsFromAppSettings(state.settings).navigationVolume),
  callVolume: APP((state) => getAudioSettingsFromAppSettings(state.settings).callVolume),
  navigationDuckingAmount: APP((state) => getAudioSettingsFromAppSettings(state.settings).navigationDuckingAmount),
  microphoneGainDb: APP((state) => getAudioSettingsFromAppSettings(state.settings).microphoneGainDb),
  autoplayLocalMedia: APP((state) => getAudioSettingsFromAppSettings(state.settings).autoplayLocalMedia),
});
