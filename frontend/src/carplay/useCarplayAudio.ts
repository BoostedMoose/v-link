import { useCallback, useEffect, useRef } from 'react'
import { AudioCommand, type AudioData } from 'node-carplay/web'

import { setNavigationDucking, useAudioSettings } from '@/app/pages/settings/audioSettingsState'
import { useNamespaces } from '@/socket/Namespaces'
import { APP } from '@/store/Store'
import {
  audioCommandClaimsProjectionFocus,
  audioCommandRampDuration,
  audioCommandStartsPlayer,
  createCarplayAudioRoutingState,
  DEFAULT_CARPLAY_AUDIO_VOLUME,
  getAudioRoute,
  getTargetVolume,
  getVolumePolicy,
  isNavigationActive,
  isProjectionInterruptionActive,
  reduceAudioRouteCommand,
} from './carplayAudioRouting'
import { setProjectionAudioInterrupted } from './audioFocus'
import { useCarplayMicrophone } from './useCarplayMicrophone'
import { useCarplayPcmPlayers } from './useCarplayPcmPlayers'
import type { AudioPlayerKey, CarPlayWorker } from './worker/types'
import { createAudioPlayerKey } from './worker/utils'

const useCarplayAudio = (
  worker: CarPlayWorker,
  microphonePort: MessagePort,
) => {
  const routingRef = useRef(createCarplayAudioRoutingState())
  const localAudioActive = APP((state) => state.system.audioSource === 'local')
  const {
    callVolume,
    microphoneGainDb,
    navigationDuckingAmount,
    navigationVolume,
  } = useAudioSettings()
  const socket = useNamespaces()
  const {
    forEachPlayer,
    getAudioPlayer,
    getRequestedVolume,
    rampPlayerVolume,
    setRequestedVolume,
  } = useCarplayPcmPlayers(worker)
  const { startRecording, stopRecording } = useCarplayMicrophone(
    microphonePort,
    microphoneGainDb,
  )

  const targetVolumeFor = useCallback((key: AudioPlayerKey) => {
    const policy = getVolumePolicy(
      routingRef.current,
      key,
      APP.getState().system.audioSource === 'local',
    )
    return getTargetVolume(
      policy,
      getRequestedVolume(key),
      { callVolume, navigationDuckingAmount, navigationVolume },
    )
  }, [
    callVolume,
    getRequestedVolume,
    navigationDuckingAmount,
    navigationVolume,
  ])

  const reconcilePlayerVolumes = useCallback((durationMs: number) => {
    forEachPlayer((key, player) => {
      rampPlayerVolume(key, player, targetVolumeFor(key), durationMs)
    })
  }, [forEachPlayer, rampPlayerVolume, targetVolumeFor])

  const processVolumeMessage = useCallback((audio: AudioData) => {
    const key = createAudioPlayerKey(audio.decodeType, audio.audioType)
    const player = getAudioPlayer(audio)
    setRequestedVolume(key, audio.volume)
    rampPlayerVolume(
      key,
      player,
      targetVolumeFor(key),
      Math.max((audio.volumeDuration ?? 0) * 1000, 0),
    )
  }, [getAudioPlayer, rampPlayerVolume, setRequestedVolume, targetVolumeFor])

  const processAudioCommand = useCallback((audio: AudioData, command: AudioCommand) => {
    const key = createAudioPlayerKey(audio.decodeType, audio.audioType)
    const previousRouting = routingRef.current
    const navigationWasActive = isNavigationActive(previousRouting)
    const interruptionWasActive = isProjectionInterruptionActive(previousRouting)
    const navigationSharesMediaRoute = command === AudioCommand.AudioNaviStart
      && getAudioRoute(previousRouting, key).media

    const routeMessage = `(CarPlay) Audio route: command=${AudioCommand[command]} audioType=${audio.audioType} decodeType=${audio.decodeType} key=${key}`
    console.info(routeMessage)
    socket.log.emit('debug', routeMessage)

    routingRef.current = reduceAudioRouteCommand(previousRouting, key, command)

    if (audioCommandClaimsProjectionFocus(routingRef.current, key, command)) {
      APP.getState().update((state) => {
        state.system.audioSource = 'carplay'
      })
    }

    if (audioCommandStartsPlayer(command)) {
      getAudioPlayer(audio)
    }
    if (command === AudioCommand.AudioMediaStart || command === AudioCommand.AudioOutputStart) {
      setRequestedVolume(key, DEFAULT_CARPLAY_AUDIO_VOLUME)
    }

    if (navigationSharesMediaRoute) {
      const message = `(CarPlay) Navigation and media share PCM route ${key}; projected-media ducking is controlled by the phone`
      console.warn(message)
      socket.log.emit('info', message)
    }

    const navigationIsActive = isNavigationActive(routingRef.current)
    if (navigationWasActive !== navigationIsActive) {
      setNavigationDucking(navigationIsActive)
    }

    const interruptionIsActive = isProjectionInterruptionActive(routingRef.current)
    if (interruptionWasActive !== interruptionIsActive) {
      setProjectionAudioInterrupted(interruptionIsActive)
    }

    reconcilePlayerVolumes(audioCommandRampDuration(command))
  }, [getAudioPlayer, reconcilePlayerVolumes, setRequestedVolume, socket])

  const processAudio = useCallback((audio: AudioData) => {
    if (audio.volumeDuration != null) {
      processVolumeMessage(audio)
      return
    }
    if (audio.command != null) {
      processAudioCommand(audio, audio.command)
    }
  }, [processAudioCommand, processVolumeMessage])

  const resetAudioRouting = useCallback(() => {
    const navigationWasActive = isNavigationActive(routingRef.current)
    const interruptionWasActive = isProjectionInterruptionActive(routingRef.current)
    routingRef.current = createCarplayAudioRoutingState()
    if (navigationWasActive) setNavigationDucking(false)
    if (interruptionWasActive) setProjectionAudioInterrupted(false)
    reconcilePlayerVolumes(200)
  }, [reconcilePlayerVolumes])

  useEffect(() => {
    reconcilePlayerVolumes(200)
  }, [localAudioActive, reconcilePlayerVolumes])

  useEffect(() => {
    if (isNavigationActive(routingRef.current)) {
      // Local media reads the latest amount when it receives this event.
      setNavigationDucking(true)
    }
  }, [navigationDuckingAmount])

  useEffect(() => () => {
    if (isNavigationActive(routingRef.current)) setNavigationDucking(false)
    if (isProjectionInterruptionActive(routingRef.current)) {
      setProjectionAudioInterrupted(false)
    }
  }, [])

  return {
    getAudioPlayer,
    processAudio,
    resetAudioRouting,
    startRecording,
    stopRecording,
  }
}

export default useCarplayAudio
