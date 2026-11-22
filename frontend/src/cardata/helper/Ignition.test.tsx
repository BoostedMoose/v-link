import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { APP } from '@/store/Store'
import { openModal, closeModal } from '@/app/components/Modal'
import Ignition from './Ignition'

const mocks = vi.hoisted(() => ({ emit: vi.fn() }))
vi.mock('@/socket/Namespaces', () => ({ useNamespaces: () => ({
  log: { emit: vi.fn() },
  sys: { emit: mocks.emit },
}) }))
beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { cleanup(); closeModal(); vi.useRealTimers(); vi.clearAllMocks() })

const renderIgnition = (ignition: boolean) => render(
  <Ignition
    ignition={ignition}
    autoShutdown
    shutdownDelay={10}
    messageTimeout={5}
    updateApp={APP.getState().update}
  />,
)

it('cancels the shutdown when the modal is closed with the exit button', () => {
  renderIgnition(false)
  act(() => { APP.getState().system.modal.onExit?.() })
  vi.advanceTimersByTime(10_000)
  expect(mocks.emit).not.toHaveBeenCalled()
  expect(APP.getState().system.modal.visible).toBe(false)
})

it('leaves other modals open when the ignition is on', () => {
  openModal('Other', 'body')
  renderIgnition(true)
  expect(APP.getState().system.modal.visible).toBe(true)
})
