import { useEffect } from 'react'
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { APP } from '@/store/Store'
import ProjectionRuntime, { USB_RELEASE_DELAY_MS } from './ProjectionRuntime'

const mocks = vi.hoisted(() => ({
  destroyed: vi.fn(),
  emit: vi.fn(),
}))
vi.mock('@/socket/Namespaces', () => {
  const socket = {
    log: { emit: mocks.emit },
  }
  return { useNamespaces: () => socket }
})
vi.mock('./Carplay', () => ({
  default: function Runtime({ resetDevice, onRecovery, onHealthy }: {
    resetDevice: boolean; onRecovery: () => void; onHealthy: () => void
  }) {
    useEffect(() => () => { mocks.destroyed() }, [])
    return <div data-testid="runtime" data-reset={resetDevice}>
      <button onClick={onRecovery}>Fail</button>
      <button onClick={onHealthy}>Healthy</button>
    </div>
  },
}))

beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
})
afterEach(() => { cleanup(); vi.useRealTimers() })

const resume = () => act(() => { vi.advanceTimersByTime(USB_RELEASE_DELAY_MS) })
const fail = () => act(() => { screen.getByText('Fail').click() })

describe('bounded projection recovery', () => {
  it('resets USB on the first runtime in a fresh browser', () => {
    render(<ProjectionRuntime command="" commandCounter={0} />)
    expect(screen.getByTestId('runtime').getAttribute('data-reset')).toBe('true')
  })

  it('destroys the previous runtime before creating fresh resources and preserves the app view', () => {
    APP.getState().update(state => { state.system.view = 'Settings' })
    render(<ProjectionRuntime command="" commandCounter={0} />)
    fail()
    expect(mocks.destroyed).toHaveBeenCalledOnce()
    expect(screen.queryByTestId('runtime')).toBeNull()
    expect(APP.getState().system.view).toBe('Settings')
    resume()
    expect(screen.getByTestId('runtime').getAttribute('data-reset')).toBe('true')
  })

  it('coalesces repeated failures during teardown', () => {
    render(<ProjectionRuntime command="" commandCounter={0} />)
    const button = screen.getByText('Fail')
    act(() => { button.click(); button.click() })
    resume()
    expect(mocks.destroyed).toHaveBeenCalledOnce()
  })

  it('caps failed replacement runtimes until a fresh browser starts', () => {
    render(<ProjectionRuntime command="" commandCounter={0} />)
    fail(); resume()
    fail(); resume()
    fail(); resume()
    expect(mocks.destroyed).toHaveBeenCalledTimes(2)
    expect(mocks.emit).toHaveBeenCalledWith('error', expect.stringContaining('recovery stopped'))
  })

  it('cancels replacement when the application unmounts', () => {
    const result = render(<ProjectionRuntime command="" commandCounter={0} />)
    fail()
    result.unmount()
    resume()
    expect(screen.queryByTestId('runtime')).toBeNull()
  })
})
