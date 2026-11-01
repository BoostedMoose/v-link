import { describe, expect, it } from 'vitest'
import {
  type ProjectionSessionState,
  transitionProjectionSession,
} from './sessionState'

const initialState = (): ProjectionSessionState => ({
  phase: 'idle',
  transport: null,
  error: null,
  dongle: false,
  phone: false,
  stream: false,
  worker: false,
  connected: false,
})

describe('projection session transitions', () => {
  it('derives compatibility flags through a normal dongle session', () => {
    const state = initialState()

    transitionProjectionSession(state, { type: 'dongleDetected' })
    expect(state).toMatchObject({ phase: 'ready', transport: 'dongle', dongle: true })

    transitionProjectionSession(state, { type: 'startRequested' })
    expect(state).toMatchObject({ phase: 'starting', phone: false, worker: false })

    transitionProjectionSession(state, { type: 'phoneConnected' })
    expect(state).toMatchObject({
      phase: 'connected',
      phone: true,
      worker: true,
      stream: false,
      connected: false,
    })

    transitionProjectionSession(state, { type: 'streamStarted' })
    expect(state).toMatchObject({ phase: 'streaming', stream: true, connected: true })
  })

  it('returns to ready when the phone leaves but the dongle remains', () => {
    const state = initialState()
    transitionProjectionSession(state, { type: 'dongleDetected' })
    transitionProjectionSession(state, { type: 'phoneConnected' })
    transitionProjectionSession(state, { type: 'streamStarted' })
    transitionProjectionSession(state, { type: 'phoneDisconnected' })

    expect(state).toMatchObject({
      phase: 'ready',
      dongle: true,
      phone: false,
      worker: false,
      stream: false,
      connected: false,
    })
  })

  it('clears the complete session when the dongle leaves', () => {
    const state = initialState()
    transitionProjectionSession(state, { type: 'dongleDetected' })
    transitionProjectionSession(state, { type: 'phoneConnected' })
    transitionProjectionSession(state, { type: 'dongleDisconnected' })

    expect(state).toEqual(initialState())
  })

  it('moves failures to one consistent non-connected state', () => {
    const state = initialState()
    transitionProjectionSession(state, { type: 'dongleDetected' })
    transitionProjectionSession(state, { type: 'phoneConnected' })
    transitionProjectionSession(state, { type: 'failed', error: 'USB stalled' })

    expect(state).toMatchObject({
      phase: 'error',
      error: 'USB stalled',
      dongle: true,
      phone: false,
      worker: false,
      stream: false,
      connected: false,
    })
  })
})
