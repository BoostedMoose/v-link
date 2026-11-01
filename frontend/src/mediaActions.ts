import type { MediaCommand } from '@/carplay/mediaCommands';

export type MediaAction = 'previous' | 'play' | 'pause' | 'toggle' | 'next';
export type AudioSource = 'carplay' | 'local';

export type HardwareActionRoute =
  | { target: 'local'; command: MediaAction }
  | { target: 'carplay'; command: string };

export const normalizeMediaAction = (action: string): MediaAction | null => {
  switch (action) {
    case 'prev':
    case 'previous':
      return 'previous';
    case 'play':
    case 'pause':
    case 'next':
      return action;
    case 'playOrPause':
    case 'toggle':
      return 'toggle';
    default:
      return null;
  }
};

export const toCarplayMediaCommand = (action: MediaAction): MediaCommand => {
  switch (action) {
    case 'previous':
      return 'prev';
    case 'toggle':
      return 'playOrPause';
    default:
      return action;
  }
};

export const routeHardwareAction = (
  action: string,
  audioSource: AudioSource,
  carplayVisible: boolean,
): HardwareActionRoute | null => {
  const mediaAction = normalizeMediaAction(action);
  if (mediaAction) {
    return audioSource === 'local'
      ? { target: 'local', command: mediaAction }
      : { target: 'carplay', command: toCarplayMediaCommand(mediaAction) };
  }

  return carplayVisible ? { target: 'carplay', command: action } : null;
};
