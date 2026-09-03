import { describe, expect, it } from 'vitest'
import {
  createEmptyCarplayMedia,
  hasCarplayMediaIdentityChanged,
  mergeCarplayMedia,
  playbackStatusFromAudioCommand,
  type CarplayMediaPayload,
} from './mediaState'
import { AudioCommand } from 'node-carplay/web'

describe('CarPlay media state', () => {
  it('merges partial metadata without clearing existing values', () => {
    const current = {
      ...createEmptyCarplayMedia(),
      title: 'Previous title',
      artist: 'Previous artist',
      artworkBase64: 'cover',
    }
    const payload = {
      type: 1,
      media: {
        MediaSongName: 'New title',
        MediaSongPlayTime: 12_000,
        MediaPlayStatus: 1,
      },
    } as CarplayMediaPayload

    expect(mergeCarplayMedia(current, payload)).toEqual({
      ...current,
      title: 'New title',
      positionMs: 12_000,
      playbackStatus: 1,
    })
  })

  it('updates artwork without clearing metadata', () => {
    const current = { ...createEmptyCarplayMedia(), title: 'Song' }
    const payload = { type: 3, base64Image: 'new-cover' } as CarplayMediaPayload

    expect(mergeCarplayMedia(current, payload)).toEqual({
      ...current,
      artworkBase64: 'new-cover',
    })
  })

  it('only treats title or artist updates as media identity changes', () => {
    const current = {
      ...createEmptyCarplayMedia(),
      title: 'Song',
      artist: 'Artist',
      positionMs: 1_000,
    }

    expect(hasCarplayMediaIdentityChanged(current, {
      ...current,
      positionMs: 2_000,
      playbackStatus: 1,
    })).toBe(false)
    expect(hasCarplayMediaIdentityChanged(current, {
      ...current,
      title: 'Next song',
    })).toBe(true)
    expect(hasCarplayMediaIdentityChanged(current, {
      ...current,
      artist: 'Next artist',
    })).toBe(true)
  })

  it('derives playback state from media audio commands', () => {
    expect(playbackStatusFromAudioCommand(0, AudioCommand.AudioMediaStart)).toBe(1)
    expect(playbackStatusFromAudioCommand(1, AudioCommand.AudioMediaStop)).toBe(0)
    expect(playbackStatusFromAudioCommand(0, AudioCommand.AudioOutputStart)).toBe(1)
    expect(playbackStatusFromAudioCommand(1, AudioCommand.AudioOutputStop)).toBe(0)
    expect(playbackStatusFromAudioCommand(1, AudioCommand.AudioNaviStart)).toBe(1)
  })
})
