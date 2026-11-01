import { AudioCommand, type MediaData } from 'node-carplay/web'

export type ProjectionSource = 'CarPlay' | 'Android Auto' | null

export interface CarplayMediaState {
  title: string
  artist: string
  album: string
  appName: string
  durationMs: number
  positionMs: number
  playbackStatus: number
  artworkBase64: string | null
}

export type CarplayMediaPayload = NonNullable<MediaData['payload']>

export const createEmptyCarplayMedia = (): CarplayMediaState => ({
  title: '',
  artist: '',
  album: '',
  appName: '',
  durationMs: 0,
  positionMs: 0,
  playbackStatus: 0,
  artworkBase64: null,
})

export const hasCarplayMediaIdentityChanged = (
  previous: CarplayMediaState,
  next: CarplayMediaState,
) => previous.title !== next.title || previous.artist !== next.artist

export const playbackStatusFromAudioCommand = (
  currentStatus: number,
  command?: AudioCommand,
): number => {
  switch (command) {
    case AudioCommand.AudioMediaStart:
    case AudioCommand.AudioOutputStart:
      return 1
    case AudioCommand.AudioMediaStop:
    case AudioCommand.AudioOutputStop:
      return 0
    default:
      return currentStatus
  }
}

export const mergeCarplayMedia = (
  current: CarplayMediaState,
  payload: CarplayMediaPayload,
): CarplayMediaState => {
  if (payload.type === 1) {
    // The dongle may include MediaPlayStatus even though node-carplay 4.3.0
    // does not declare that optional field in its TypeScript definition.
    const media = payload.media as typeof payload.media & { MediaPlayStatus?: number }

    return {
      ...current,
      title: media.MediaSongName ?? current.title,
      artist: media.MediaArtistName ?? current.artist,
      album: media.MediaAlbumName ?? current.album,
      appName: media.MediaAPPName ?? current.appName,
      durationMs: media.MediaSongDuration ?? current.durationMs,
      positionMs: media.MediaSongPlayTime ?? current.positionMs,
      playbackStatus: media.MediaPlayStatus ?? current.playbackStatus,
    }
  }

  return {
    ...current,
    artworkBase64: payload.base64Image,
  }
}
