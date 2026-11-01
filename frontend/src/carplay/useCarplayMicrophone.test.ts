import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { decibelsToGain, useCarplayMicrophone } from './useCarplayMicrophone'

vi.mock('@/socket/Namespaces', () => ({
  useNamespaces: () => ({ log: { emit: vi.fn() } }),
}))

const setGetUserMedia = (getUserMedia: ReturnType<typeof vi.fn>) => {
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia },
  })
}

describe('CarPlay microphone gain', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('converts decibels to linear gain', () => {
    expect(decibelsToGain(0)).toBe(1)
    expect(decibelsToGain(-20)).toBeCloseTo(0.1)
    expect(decibelsToGain(2)).toBeCloseTo(1.2589, 4)
  })

  it('stops a microphone stream that resolves after unmount', async () => {
    let resolveStream!: (stream: MediaStream) => void
    const pendingStream = new Promise<MediaStream>((resolve) => {
      resolveStream = resolve
    })
    const stopTrack = vi.fn()
    const stream = { getTracks: () => [{ stop: stopTrack }] } as unknown as MediaStream
    setGetUserMedia(vi.fn(() => pendingStream))

    const { unmount } = renderHook(() => useCarplayMicrophone({} as MessagePort, 0))
    unmount()

    await act(async () => {
      resolveStream(stream)
      await pendingStream
    })

    expect(stopTrack).toHaveBeenCalledOnce()
  })
})
