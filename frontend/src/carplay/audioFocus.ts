export const PROJECTION_AUDIO_INTERRUPTION_EVENT = 'v-link-projection-audio-interruption'

let projectionAudioInterrupted = false

export const isProjectionAudioInterrupted = () => projectionAudioInterrupted

export const setProjectionAudioInterrupted = (active: boolean) => {
  if (projectionAudioInterrupted === active) return

  projectionAudioInterrupted = active
  window.dispatchEvent(new CustomEvent<boolean>(PROJECTION_AUDIO_INTERRUPTION_EVENT, {
    detail: active,
  }))
}
