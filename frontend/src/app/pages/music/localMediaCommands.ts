import { eventEmitter } from '@/app/helper/EventEmitter';
import type { MediaAction } from '@/mediaActions';

export type LocalMediaCommand = MediaAction;

export const LOCAL_MEDIA_COMMAND_EVENT = 'localMediaCommand';

export const sendLocalMediaCommand = (command: LocalMediaCommand) => {
  eventEmitter.dispatchEvent(
    new CustomEvent<LocalMediaCommand>(LOCAL_MEDIA_COMMAND_EVENT, { detail: command }),
  );
};
