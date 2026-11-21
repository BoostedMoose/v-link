export type ProjectionTransport = 'dongle' | 'native-aa' | 'native-carplay' | null

export type ProjectionPhase =
  | 'idle'
  | 'ready'
  | 'starting'
  | 'connected'
  | 'streaming'
  | 'error'

export type ProjectionSessionEvent =
  | { type: 'dongleDetected' }
  | { type: 'dongleDisconnected' }
  | { type: 'startRequested' }
  | { type: 'phoneConnected' }
  | { type: 'streamStarted' }
  | { type: 'phoneDisconnected' }
  | { type: 'failed'; error?: string }

/**
 * Projection lifecycle state. The boolean fields are retained for older UI
 * components, but are always derived here rather than updated independently.
 */
export interface ProjectionSessionState {
  phase: ProjectionPhase
  transport: ProjectionTransport
  error: string | null
  dongle: boolean
  phone: boolean
  stream: boolean
  worker: boolean
  connected: boolean
}

const applyDerivedFields = (state: ProjectionSessionState) => {
  state.phone = state.phase === 'connected' || state.phase === 'streaming'
  state.worker = state.phone
  state.stream = state.phase === 'streaming'
  // Historically `connected` means that video has been confirmed, not merely
  // that a phone/session is connected.
  state.connected = state.stream
}

export const transitionProjectionSession = (
  state: ProjectionSessionState,
  event: ProjectionSessionEvent,
) => {
  switch (event.type) {
    case 'dongleDetected':
      state.dongle = true
      state.transport = 'dongle'
      state.error = null
      if (state.phase === 'idle' || state.phase === 'error') state.phase = 'ready'
      break
    case 'startRequested':
      if (state.dongle) {
        state.phase = 'starting'
        state.transport = 'dongle'
        state.error = null
      }
      break
    case 'phoneConnected':
      state.phase = 'connected'
      state.error = null
      break
    case 'streamStarted':
      state.phase = 'streaming'
      state.error = null
      break
    case 'phoneDisconnected':
      state.phase = state.dongle ? 'ready' : 'idle'
      state.error = null
      break
    case 'failed':
      state.phase = 'error'
      state.error = event.error ?? 'Projection session failed'
      break
    case 'dongleDisconnected':
      state.phase = 'idle'
      state.transport = null
      state.error = null
      state.dongle = false
      break
  }

  applyDerivedFields(state)
}
