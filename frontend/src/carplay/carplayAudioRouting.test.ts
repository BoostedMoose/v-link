import { AudioCommand } from 'node-carplay/web'
import { describe, expect, it } from 'vitest'

import {
  audioCommandClaimsProjectionFocus,
  createCarplayAudioRoutingState,
  getAudioRoute,
  getTargetVolume,
  getVolumePolicy,
  isNavigationActive,
  isProjectionInterruptionActive,
  reduceAudioRouteCommand,
} from './carplayAudioRouting'
import type { AudioPlayerKey } from './worker/types'

const mediaKey = '44100_2_1' as AudioPlayerKey
const navigationKey = '24000_1_2' as AudioPlayerKey
const settings = {
  navigationVolume: 80,
  callVolume: 85,
  navigationDuckingAmount: 80,
}

const transition = (
  commands: AudioCommand[],
  key = mediaKey,
) => commands.reduce(
  (state, command) => reduceAudioRouteCommand(state, key, command),
  createCarplayAudioRoutingState(),
)

describe('CarPlay audio routing', () => {
  it('restores a shared route to media after navigation stops', () => {
    const state = transition([
      AudioCommand.AudioMediaStart,
      AudioCommand.AudioNaviStart,
      AudioCommand.AudioNaviStop,
    ])

    expect(getAudioRoute(state, mediaKey)).toMatchObject({
      media: true,
      navigation: false,
    })
    expect(getTargetVolume(getVolumePolicy(state, mediaKey, false), 0.7, settings)).toBe(0.7)
  })

  it('clears call, Siri, and alert roles with their matching stop commands', () => {
    const started = transition([
      AudioCommand.AudioPhonecallStart,
      AudioCommand.AudioSiriStart,
      AudioCommand.AudioAlertStart,
    ])
    const siriStopped = reduceAudioRouteCommand(started, mediaKey, AudioCommand.AudioSiriStop)

    expect(getAudioRoute(siriStopped, mediaKey)).toMatchObject({
      call: true,
      siri: false,
      alert: true,
    })

    const callStopped = reduceAudioRouteCommand(siriStopped, mediaKey, AudioCommand.AudioPhonecallStop)
    const allStopped = reduceAudioRouteCommand(callStopped, mediaKey, AudioCommand.AudioAlertStop)
    expect(allStopped.routes.has(mediaKey)).toBe(false)
  })

  it('keeps navigation active until every navigation route has stopped', () => {
    let state = createCarplayAudioRoutingState()
    state = reduceAudioRouteCommand(state, mediaKey, AudioCommand.AudioNaviStart)
    state = reduceAudioRouteCommand(state, navigationKey, AudioCommand.AudioNaviStart)
    state = reduceAudioRouteCommand(state, mediaKey, AudioCommand.AudioNaviStop)

    expect(isNavigationActive(state)).toBe(true)

    state = reduceAudioRouteCommand(state, navigationKey, AudioCommand.AudioNaviStop)
    expect(isNavigationActive(state)).toBe(false)
  })

  it('classifies output as media once a transient navigation route stops', () => {
    const state = transition([
      AudioCommand.AudioNaviStart,
      AudioCommand.AudioNaviStop,
      AudioCommand.AudioOutputStart,
    ])

    expect(getAudioRoute(state, mediaKey).media).toBe(true)
  })

  it('claims projection focus for both media start command variants', () => {
    const mediaStarted = transition([AudioCommand.AudioMediaStart])
    const outputStarted = transition([AudioCommand.AudioOutputStart])
    const navigationStarted = transition([
      AudioCommand.AudioNaviStart,
      AudioCommand.AudioOutputStart,
    ])

    expect(audioCommandClaimsProjectionFocus(
      mediaStarted,
      mediaKey,
      AudioCommand.AudioMediaStart,
    )).toBe(true)
    expect(audioCommandClaimsProjectionFocus(
      outputStarted,
      mediaKey,
      AudioCommand.AudioOutputStart,
    )).toBe(true)
    expect(audioCommandClaimsProjectionFocus(
      navigationStarted,
      mediaKey,
      AudioCommand.AudioOutputStart,
    )).toBe(false)
  })

  it('tracks calls, Siri, and alerts as local-media interruptions', () => {
    let state = createCarplayAudioRoutingState()
    state = reduceAudioRouteCommand(state, mediaKey, AudioCommand.AudioPhonecallStart)
    state = reduceAudioRouteCommand(state, navigationKey, AudioCommand.AudioSiriStart)
    expect(isProjectionInterruptionActive(state)).toBe(true)

    state = reduceAudioRouteCommand(state, mediaKey, AudioCommand.AudioPhonecallStop)
    expect(isProjectionInterruptionActive(state)).toBe(true)

    state = reduceAudioRouteCommand(state, navigationKey, AudioCommand.AudioSiriStop)
    expect(isProjectionInterruptionActive(state)).toBe(false)

    state = reduceAudioRouteCommand(state, mediaKey, AudioCommand.AudioAlertStart)
    expect(isProjectionInterruptionActive(state)).toBe(true)
    state = reduceAudioRouteCommand(state, mediaKey, AudioCommand.AudioAlertStop)
    expect(isProjectionInterruptionActive(state)).toBe(false)
  })
})

describe('CarPlay target-volume policy', () => {
  it('makes route priority explicit', () => {
    const basePolicy = {
      isNavigation: false,
      isCall: false,
      isPriority: false,
      isMedia: true,
      localAudioActive: true,
      navigationActive: true,
    }

    expect(getTargetVolume({ ...basePolicy, isNavigation: true }, 0.6, settings)).toBe(0.8)
    expect(getTargetVolume({ ...basePolicy, isCall: true }, 0.6, settings)).toBe(0.85)
    expect(getTargetVolume({ ...basePolicy, isPriority: true }, 0.6, settings)).toBe(1)
    expect(getTargetVolume(basePolicy, 0.6, settings)).toBe(0)
  })

  it('ducks media that starts while navigation is already active', () => {
    let state = createCarplayAudioRoutingState()
    state = reduceAudioRouteCommand(state, navigationKey, AudioCommand.AudioNaviStart)
    state = reduceAudioRouteCommand(state, mediaKey, AudioCommand.AudioMediaStart)

    expect(getTargetVolume(getVolumePolicy(state, mediaKey, false), 1, settings)).toBeCloseTo(0.04)
  })

  it('passes through the dongle volume for an unclassified route', () => {
    const state = createCarplayAudioRoutingState()
    expect(getTargetVolume(getVolumePolicy(state, mediaKey, false), 0.63, settings)).toBe(0.63)
  })
})
