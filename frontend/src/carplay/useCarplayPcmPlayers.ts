import { useCallback, useEffect, useRef } from 'react'
import type { AudioData } from 'node-carplay/web'
import { decodeTypeMap } from 'node-carplay/web'
import { PcmPlayer } from 'pcm-ringbuf-player'

import { useNamespaces } from '@/socket/Namespaces'
import type { AudioPlayerKey, CarPlayWorker } from './worker/types'
import { createAudioPlayerKey } from './worker/utils'
import { DEFAULT_CARPLAY_AUDIO_VOLUME } from './carplayAudioRouting'

const clampVolume = (volume: number) => Math.min(Math.max(volume, 0), 1)

export const useCarplayPcmPlayers = (worker: CarPlayWorker) => {
  const playersRef = useRef(new Map<AudioPlayerKey, PcmPlayer>())
  const requestedVolumesRef = useRef(new Map<AudioPlayerKey, number>())
  const appliedVolumesRef = useRef(new Map<AudioPlayerKey, number>())
  const volumeAnimationsRef = useRef(new Map<AudioPlayerKey, number>())
  const socket = useNamespaces()

  const getAudioPlayer = useCallback((audio: AudioData): PcmPlayer => {
    const { decodeType, audioType } = audio
    const format = decodeTypeMap[decodeType]
    if (!format) {
      throw new Error(`Unsupported CarPlay audio decode type: ${decodeType}`)
    }
    const audioKey = createAudioPlayerKey(decodeType, audioType)
    let player = playersRef.current.get(audioKey)

    if (!player) {
      player = new PcmPlayer(format.frequency, format.channel)
      console.log(`(CarPlay) Player: ${player}`)
      socket.log.emit('debug', `(CarPlay) Player: ${player}`)

      playersRef.current.set(audioKey, player)
      requestedVolumesRef.current.set(audioKey, DEFAULT_CARPLAY_AUDIO_VOLUME)
      appliedVolumesRef.current.set(audioKey, DEFAULT_CARPLAY_AUDIO_VOLUME)
      player.volume(DEFAULT_CARPLAY_AUDIO_VOLUME)
      void player.start()
    }

    // The projection worker drops its buffer references when a session restarts,
    // while this hook and its players remain mounted.
    worker.postMessage({
      type: 'audioBuffer',
      payload: {
        sab: player.getRawBuffer(),
        decodeType,
        audioType,
      },
    })

    return player
  }, [socket, worker])

  const setRequestedVolume = useCallback((key: AudioPlayerKey, volume: number) => {
    requestedVolumesRef.current.set(key, clampVolume(volume))
  }, [])

  const getRequestedVolume = useCallback((key: AudioPlayerKey) => (
    requestedVolumesRef.current.get(key) ?? DEFAULT_CARPLAY_AUDIO_VOLUME
  ), [])

  const rampPlayerVolume = useCallback((
    key: AudioPlayerKey,
    player: PcmPlayer,
    target: number,
    durationMs: number,
  ) => {
    const previousAnimation = volumeAnimationsRef.current.get(key)
    if (previousAnimation != null) cancelAnimationFrame(previousAnimation)

    const start = appliedVolumesRef.current.get(key) ?? DEFAULT_CARPLAY_AUDIO_VOLUME
    const safeTarget = clampVolume(target)
    const startedAt = performance.now()

    const applyStep = (now: number) => {
      const progress = durationMs > 0
        ? Math.min((now - startedAt) / durationMs, 1)
        : 1
      const eased = progress * progress * (3 - 2 * progress)
      const value = start + (safeTarget - start) * eased

      // PcmPlayer delays its automation by the supplied duration. The hook
      // performs the ramp, so each individual update should be immediate.
      player.volume(value, 0.001)
      appliedVolumesRef.current.set(key, value)

      if (progress < 1) {
        volumeAnimationsRef.current.set(key, requestAnimationFrame(applyStep))
      } else {
        volumeAnimationsRef.current.delete(key)
      }
    }

    volumeAnimationsRef.current.set(key, requestAnimationFrame(applyStep))
  }, [])

  const forEachPlayer = useCallback((
    callback: (key: AudioPlayerKey, player: PcmPlayer) => void,
  ) => {
    playersRef.current.forEach((player, key) => callback(key, player))
  }, [])

  useEffect(() => () => {
    volumeAnimationsRef.current.forEach((animation) => cancelAnimationFrame(animation))
    volumeAnimationsRef.current.clear()
    playersRef.current.forEach((player) => void player.stop())
    playersRef.current.clear()
    requestedVolumesRef.current.clear()
    appliedVolumesRef.current.clear()
  }, [])

  return {
    forEachPlayer,
    getAudioPlayer,
    getRequestedVolume,
    rampPlayerVolume,
    setRequestedVolume,
  }
}
