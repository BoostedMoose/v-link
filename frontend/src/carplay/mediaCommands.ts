import { eventEmitter } from '@/app/helper/EventEmitter';

export type MediaCommand = 'prev' | 'play' | 'pause' | 'playOrPause' | 'next';

export const CARPLAY_MEDIA_COMMAND_EVENT = 'carplayMediaCommand';

export const sendCarplayMediaCommand = (command: MediaCommand) => {
  eventEmitter.dispatchEvent(
    new CustomEvent<MediaCommand>(CARPLAY_MEDIA_COMMAND_EVENT, { detail: command }),
  );
};
