import { AudioCommand } from 'node-carplay/web'

import {
  duckingOutputLevel,
  type AudioSettingsValues,
} from '@/app/pages/settings/audioSettingsState'
import type { AudioPlayerKey } from './worker/types'

export interface AudioRouteState {
  media: boolean
  navigation: boolean
  call: boolean
  siri: boolean
  alert: boolean
}

export interface CarplayAudioRoutingState {
  routes: Map<AudioPlayerKey, AudioRouteState>
}

export interface VolumePolicy {
  isNavigation: boolean
  isCall: boolean
  isPriority: boolean
  isMedia: boolean
  localAudioActive: boolean
  navigationActive: boolean
}

const EMPTY_ROUTE: Readonly<AudioRouteState> = {
  media: false,
  navigation: false,
  call: false,
  siri: false,
  alert: false,
}

export const DEFAULT_CARPLAY_AUDIO_VOLUME = 1

export const audioCommandRampDuration = (command: AudioCommand) => {
  switch (command) {
    case AudioCommand.AudioNaviStart:
    case AudioCommand.AudioOutputStart:
      return 200
    case AudioCommand.AudioNaviStop:
      return 650
    case AudioCommand.AudioPhonecallStart:
    case AudioCommand.AudioPhonecallStop:
    case AudioCommand.AudioSiriStart:
    case AudioCommand.AudioSiriStop:
    case AudioCommand.AudioAlertStart:
    case AudioCommand.AudioAlertStop:
    case AudioCommand.AudioMediaStart:
    case AudioCommand.AudioMediaStop:
      return 350
    default:
      return 0
  }
}

export const audioCommandStartsPlayer = (command: AudioCommand) => {
  switch (command) {
    case AudioCommand.AudioNaviStart:
    case AudioCommand.AudioPhonecallStart:
    case AudioCommand.AudioSiriStart:
    case AudioCommand.AudioAlertStart:
    case AudioCommand.AudioMediaStart:
    case AudioCommand.AudioOutputStart:
      return true
    default:
      return false
  }
}

export const createCarplayAudioRoutingState = (): CarplayAudioRoutingState => ({
  routes: new Map(),
})

export const getAudioRoute = (
  state: CarplayAudioRoutingState,
  key: AudioPlayerKey,
): Readonly<AudioRouteState> => state.routes.get(key) ?? EMPTY_ROUTE

export const audioCommandClaimsProjectionFocus = (
  state: CarplayAudioRoutingState,
  key: AudioPlayerKey,
  command: AudioCommand,
) => (
  (command === AudioCommand.AudioMediaStart || command === AudioCommand.AudioOutputStart)
  && getAudioRoute(state, key).media
)

export const isPriorityRoute = (route: Readonly<AudioRouteState>) => (
  route.siri || route.alert
)

export const isNavigationActive = (state: CarplayAudioRoutingState) => (
  Array.from(state.routes.values()).some((route) => route.navigation)
)

export const isProjectionInterruptionActive = (state: CarplayAudioRoutingState) => (
  Array.from(state.routes.values()).some((route) => (
    route.call || route.siri || route.alert
  ))
)

const isRouteEmpty = (route: Readonly<AudioRouteState>) => (
  !route.media
  && !route.navigation
  && !route.call
  && !route.siri
  && !route.alert
)

export const reduceAudioRouteCommand = (
  state: CarplayAudioRoutingState,
  key: AudioPlayerKey,
  command: AudioCommand,
): CarplayAudioRoutingState => {
  const route = { ...getAudioRoute(state, key) }

  switch (command) {
    case AudioCommand.AudioMediaStart:
      route.media = true
      break
    case AudioCommand.AudioMediaStop:
      route.media = false
      break
    case AudioCommand.AudioOutputStart:
      if (!route.navigation && !route.call && !isPriorityRoute(route)) {
        route.media = true
      }
      break
    case AudioCommand.AudioOutputStop:
      route.media = false
      break
    case AudioCommand.AudioNaviStart:
      route.navigation = true
      break
    case AudioCommand.AudioNaviStop:
      route.navigation = false
      break
    case AudioCommand.AudioPhonecallStart:
      route.call = true
      break
    case AudioCommand.AudioPhonecallStop:
      route.call = false
      break
    case AudioCommand.AudioSiriStart:
      route.siri = true
      break
    case AudioCommand.AudioSiriStop:
      route.siri = false
      break
    case AudioCommand.AudioAlertStart:
      route.alert = true
      break
    case AudioCommand.AudioAlertStop:
      route.alert = false
      break
    default:
      return state
  }

  const routes = new Map(state.routes)
  if (isRouteEmpty(route)) {
    routes.delete(key)
  } else {
    routes.set(key, route)
  }
  return { routes }
}

export const getTargetVolume = (
  policy: VolumePolicy,
  requestedVolume: number,
  settings: Pick<AudioSettingsValues, 'navigationVolume' | 'callVolume' | 'navigationDuckingAmount'>,
) => {
  if (policy.isNavigation) return settings.navigationVolume / 100
  if (policy.isCall) return settings.callVolume / 100
  if (policy.isPriority) return DEFAULT_CARPLAY_AUDIO_VOLUME

  if (!policy.isMedia) return requestedVolume
  if (policy.localAudioActive) return 0
  if (policy.navigationActive) {
    return duckingOutputLevel(settings.navigationDuckingAmount)
  }

  return requestedVolume
}

export const getVolumePolicy = (
  state: CarplayAudioRoutingState,
  key: AudioPlayerKey,
  localAudioActive: boolean,
): VolumePolicy => {
  const route = getAudioRoute(state, key)
  return {
    isNavigation: route.navigation,
    isCall: route.call,
    isPriority: isPriorityRoute(route),
    isMedia: route.media,
    localAudioActive,
    navigationActive: isNavigationActive(state),
  }
}
