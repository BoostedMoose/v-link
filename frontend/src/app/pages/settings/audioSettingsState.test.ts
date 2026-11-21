import { describe, expect, it } from 'vitest';

import {
  DEFAULT_AUDIO_SETTINGS,
  getAudioSettingsFromAppSettings,
  withAudioSettings,
  type AudioSettingsValues,
} from './audioSettingsState';

const appSettings = (values: AudioSettingsValues = DEFAULT_AUDIO_SETTINGS) => ({
  general: { autoSave: { value: false } },
  audio: {
    title: 'Audio Settings',
    type: 'system',
    autoplayLocalMedia: { value: values.autoplayLocalMedia, label: 'Autoplay' },
    navigationVolume: { value: values.navigationVolume, label: 'Navigation' },
    callVolume: { value: values.callVolume, label: 'Calls' },
    navigationDuckingAmount: { value: values.navigationDuckingAmount, label: 'Ducking' },
    microphoneGainDb: { value: values.microphoneGainDb, label: 'Microphone' },
  },
});

describe('app.json audio settings', () => {
  it('reads audio values from the app settings schema', () => {
    const values: AudioSettingsValues = {
      navigationVolume: 61,
      callVolume: 72,
      navigationDuckingAmount: 33,
      microphoneGainDb: -4,
      autoplayLocalMedia: true,
    };

    expect(getAudioSettingsFromAppSettings(appSettings(values))).toEqual(values);
  });

  it('updates values without discarding app.json metadata or unrelated settings', () => {
    const settings = appSettings();
    const updated = withAudioSettings(settings, {
      ...DEFAULT_AUDIO_SETTINGS,
      autoplayLocalMedia: true,
    });

    expect(updated.audio.autoplayLocalMedia).toEqual({ value: true, label: 'Autoplay' });
    expect(updated.audio.navigationVolume.label).toBe('Navigation');
    expect(updated.general).toBe(settings.general);
  });
});
